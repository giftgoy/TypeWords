"""GitHub 云端备份：把学习状态推送到私有仓库，支持一键恢复。

设计约束：
- 只在服务端持有 token，浏览器永远拿不到 PAT。
- 本地 SQLite 是唯一真源，GitHub 只做异地备份 + 新设备冷启动恢复。
- 只同步学习状态（词库进度 / FSRS / 错词 / 设置），不同步音频与自建词库正文。
"""

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SYNC_KEYS = ("typing-word-dict", "typing-word-setting")
MAX_PAYLOAD_BYTES = 5 * 1024 * 1024


class GithubSync:
    def __init__(self, storage):
        self.storage = storage
        self.api = os.environ.get("GITHUB_API", "https://api.github.com").rstrip("/")
        self.repo = os.environ.get("GITHUB_REPO", "").strip()
        self.token = os.environ.get("GITHUB_TOKEN", "").strip()
        self.branch = os.environ.get("GITHUB_BRANCH", "main").strip() or "main"
        self.path = os.environ.get("GITHUB_PATH", "typewords/progress.json").strip()
        self.snapshot_dir = os.environ.get("GITHUB_SNAPSHOT_DIR", "typewords/daily").strip()
        self.auto_push = os.environ.get("GITHUB_AUTO_PUSH", "1").strip().lower() not in ("0", "false", "no", "off")
        self.last_at = None
        self.last_error = None
        self.last_sha = None
        self.last_snapshot = None
        self._timer = None
        self._lock = threading.Lock()

    # ---------- 对外状态 ----------
    @property
    def configured(self):
        return bool(self.repo and self.token)

    def status(self):
        return {
            "configured": self.configured,
            "repo": self.repo or None,
            "branch": self.branch,
            "path": self.path,
            "snapshotDir": self.snapshot_dir,
            "autoPush": self.auto_push,
            "lastSyncAt": self.last_at,
            "lastError": self.last_error,
            "lastSnapshot": self.last_snapshot,
        }

    # ---------- 自动防抖推送 ----------
    def schedule(self):
        if not self.configured or not self.auto_push:
            return
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(5.0, self._push_safely)
            self._timer.daemon = True
            self._timer.start()

    def _push_safely(self):
        try:
            self.push()
        except Exception as error:  # 备份失败绝不能影响本地保存
            self.last_error = f"{type(error).__name__}: {error}"

    # ---------- 导出 ----------
    def export_payload(self):
        snapshot = self.storage.snapshot()
        items = {}
        for key in SYNC_KEYS:
            row = snapshot["entries"].get(key)
            if row:
                items[key] = row["value"]
        trimmed = self._trim(items)
        return {
            "format": "typewords-github-sync-v1",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "revision": snapshot["revision"],
            "items": trimmed,
        }

    def _trim(self, items):
        """自建词库 / 文章正文太大，按需裁掉，只保留学习进度相关字段。"""
        if len(json.dumps(items, ensure_ascii=False)) <= MAX_PAYLOAD_BYTES:
            return items
        dict_row = items.get("typing-word-dict")
        if not dict_row or dict_row.get("type") != "value":
            return items
        try:
            data = json.loads(dict_row["value"])
        except (TypeError, ValueError):
            return items
        word = data.get("val", {}).get("word") or {}
        for book in word.get("bookList") or []:
            if book.get("custom"):
                book["words"] = []
        for book in (data.get("val", {}).get("article") or {}).get("bookList") or []:
            if book.get("custom"):
                book["articles"] = []
        items["typing-word-dict"] = {"type": "value", "value": json.dumps(data, ensure_ascii=False)}
        return items

    # ---------- GitHub Contents API ----------
    def _request(self, method, url, body=None):
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=payload, method=method)
        request.add_header("Authorization", "Bearer " + self.token)
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("User-Agent", "typewords-data-sync")
        request.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}

    def _file_url(self, path):
        return f"{self.api}/repos/{self.repo}/contents/{urllib.parse.quote(path)}"

    def _read_remote(self, path):
        try:
            data = self._request("GET", self._file_url(path) + f"?ref={urllib.parse.quote(self.branch)}")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None, None
            raise
        content = base64.b64decode(data.get("content", "")).decode("utf-8")
        return content, data.get("sha")

    def _write_remote(self, path, text, message):
        _, sha = self._read_remote(path)
        body = {
            "message": message,
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "branch": self.branch,
        }
        if sha:
            body["sha"] = sha
        try:
            result = self._request("PUT", self._file_url(path), body)
        except urllib.error.HTTPError as error:
            # 空仓库 / 分支尚未创建时，GitHub 会拒绝带 branch 的首次写入，退回不带 branch 再试一次
            if error.code in (409, 422) and not sha:
                body.pop("branch", None)
                result = self._request("PUT", self._file_url(path), body)
            else:
                raise
        return (result.get("content") or {}).get("sha")

    def push(self):
        if not self.configured:
            raise RuntimeError("未配置 GITHUB_REPO / GITHUB_TOKEN")
        # 网络抖动（URLError / 超时）重试一次，仍然失败才向上抛
        last_error = None
        for attempt in range(2):
            try:
                return self._push_once()
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                last_error = error
                if attempt == 0:
                    time.sleep(1.5)
        raise last_error

    def _push_once(self):
        payload = self.export_payload()
        text = json.dumps(payload, ensure_ascii=False, indent=1)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        self.last_sha = self._write_remote(self.path, text, f"typewords: sync learning state {stamp}")
        # 每日快照：同一天只写一次
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.last_snapshot != day:
            self._write_remote(f"{self.snapshot_dir}/{day}.json", text, f"typewords: daily snapshot {day}")
            self.last_snapshot = day
        self.last_at = datetime.now(timezone.utc).isoformat()
        self.last_error = None
        return {"sha": self.last_sha, "snapshot": self.last_snapshot, "exportedAt": self.last_at}

    def pull(self):
        if not self.configured:
            raise RuntimeError("未配置 GITHUB_REPO / GITHUB_TOKEN")
        text, _ = self._read_remote(self.path)
        if text is None:
            raise RuntimeError("云端还没有备份文件")
        payload = json.loads(text)
        if payload.get("format") != "typewords-github-sync-v1":
            raise RuntimeError("云端文件格式不匹配")
        items = payload.get("items") or {}
        current = self.storage.snapshot()
        snapshot = self.storage.restore(items, current["revision"])
        self.last_at = datetime.now(timezone.utc).isoformat()
        self.last_error = None
        return {"revision": snapshot["revision"], "items": len(items), "exportedAt": payload.get("exported_at")}
