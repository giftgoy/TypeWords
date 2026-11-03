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
CONFIG_FILE = os.environ.get("GITHUB_CONFIG_FILE", "/data/github.json")


class GithubSync:
    def __init__(self, storage):
        self.storage = storage
        self.api = os.environ.get("GITHUB_API", "https://api.github.com").rstrip("/")
        self.env_defaults = {
            "repo": os.environ.get("GITHUB_REPO", "").strip(),
            "token": os.environ.get("GITHUB_TOKEN", "").strip(),
            "branch": os.environ.get("GITHUB_BRANCH", "main").strip() or "main",
            "path": os.environ.get("GITHUB_PATH", "typewords/progress.json").strip(),
            "snapshotDir": os.environ.get("GITHUB_SNAPSHOT_DIR", "typewords/daily").strip(),
            "autoPush": os.environ.get("GITHUB_AUTO_PUSH", "1").strip().lower() not in ("0", "false", "no", "off"),
        }
        self.config = dict(self.env_defaults)
        self.source = "env" if self.env_defaults["repo"] and self.env_defaults["token"] else "none"
        self.config_path = CONFIG_FILE
        self._load_config_file()
        self.last_at = None
        self.last_error = None
        self.last_sha = None
        self.last_snapshot = None
        self._timer = None
        self._lock = threading.Lock()

    # ---------- 配置读写（网页里填的配置优先级高于环境变量） ----------
    def _load_config_file(self):
        try:
            with open(self.config_path, "r", encoding="utf-8") as handle:
                saved = json.load(handle)
        except (FileNotFoundError, ValueError, OSError):
            return
        if isinstance(saved, dict):
            self.config = {**self.env_defaults, **saved}
            self.source = "file"
            if not self.config.get("branch"):
                self.config["branch"] = "main"

    def save_config(self, incoming):
        next_config = dict(self.config)
        for key in ("repo", "token", "branch", "path", "snapshotDir"):
            value = incoming.get(key)
            if isinstance(value, str) and value.strip():
                next_config[key] = value.strip()
        if "autoPush" in incoming:
            next_config["autoPush"] = bool(incoming["autoPush"])
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        fd = os.open(self.config_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(next_config, handle, ensure_ascii=False, indent=1)
        self.config = next_config
        self.source = "file"
        self.last_error = None
        return self.status()

    def clear_config(self):
        try:
            os.remove(self.config_path)
        except FileNotFoundError:
            pass
        self.config = dict(self.env_defaults)
        self.source = "env" if self.env_defaults["repo"] and self.env_defaults["token"] else "none"
        return self.status()

    @property
    def repo(self):
        return self.config.get("repo", "")

    @property
    def token(self):
        return self.config.get("token", "")

    @property
    def branch(self):
        return self.config.get("branch", "main")

    @property
    def path(self):
        return self.config.get("path", "typewords/progress.json")

    @property
    def snapshot_dir(self):
        return self.config.get("snapshotDir", "typewords/daily")

    @property
    def auto_push(self):
        return bool(self.config.get("autoPush", True))

    # ---------- 对外状态 ----------
    @property
    def configured(self):
        return bool(self.repo and self.token)

    def status(self):
        token = self.token
        return {
            "configured": self.configured,
            "repo": self.repo or None,
            "branch": self.branch,
            "path": self.path,
            "snapshotDir": self.snapshot_dir,
            "autoPush": self.auto_push,
            "source": self.source,
            "hasToken": bool(token),
            "tokenHint": ("****" + token[-4:]) if len(token) >= 8 else ("****" if token else ""),
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
