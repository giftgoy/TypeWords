import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


class Conflict(Exception):
    pass


class Storage:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS archives (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, label TEXT NOT NULL, items TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL);
            """)
            db.execute("INSERT OR IGNORE INTO meta VALUES ('id', ?)", (str(uuid.uuid4()),))
            db.execute("INSERT OR IGNORE INTO meta VALUES ('initialized', '0')")
            db.execute("INSERT OR IGNORE INTO meta VALUES ('revision', '0')")

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def snapshot(self, db=None):
        if db is None:
            with self.connect() as connection:
                return self.snapshot(connection)
        meta = dict(db.execute("SELECT key, value FROM meta"))
        return {
            "id": meta["id"], "initialized": meta["initialized"] == "1", "revision": int(meta["revision"]),
            "entries": {key: {"value": json.loads(value), "revision": revision}
                        for key, value, revision in db.execute("SELECT key, value, revision FROM entries")},
        }

    def write(self, db, changes):
        for key, value in changes.items():
            db.execute("INSERT INTO history (key, value, revision) SELECT key, value, revision FROM entries WHERE key=?", (key,))
            db.execute("DELETE FROM history WHERE key=? AND id NOT IN (SELECT id FROM history WHERE key=? ORDER BY id DESC LIMIT 10)", (key, key))
            db.execute("INSERT INTO entries VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET value=excluded.value, revision=entries.revision+1",
                       (key, json.dumps(value, ensure_ascii=False)))
        db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
        if "typing-word-dict" in changes or "typing-word-setting" in changes:
            db.execute("UPDATE meta SET value='1' WHERE key='initialized'")

    def initialize(self, items):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not self.snapshot(db)["initialized"] and items:
                self.write(db, items)
            return self.snapshot(db)

    def update(self, changes, revisions, store_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.snapshot(db)
            if store_id != current["id"]:
                raise Conflict("存储实例已变化，请备份当前副本后重新载入。")
            if "typewords-growth-v1" in changes and changes["typewords-growth-v1"] != current["entries"].get("typewords-growth-v1", {}).get("value"):
                raise Conflict("成长证据需要由成长任务接口保存，不能被普通缓存覆盖。")
            for key in changes:
                if revisions.get(key) != current["entries"].get(key, {}).get("revision", 0):
                    if current["entries"].get(key, {}).get("value") != changes[key]:
                        raise Conflict("另一浏览器已更新数据，当前副本已保留，请重新载入。")
            self.write(db, changes)
            updated = self.snapshot(db)
            return {key: updated["entries"][key]["revision"] for key in changes}

    def archive(self, items, label, db=None):
        if db is None:
            with self.connect() as connection:
                return self.archive(items, label, connection)
        return db.execute("INSERT INTO archives (created_at, label, items) VALUES (?, ?, ?)",
                          (datetime.now(timezone.utc).isoformat(), label, json.dumps(items, ensure_ascii=False))).lastrowid

    def list_archives(self):
        with self.connect() as db:
            return [{"id": row[0], "created_at": row[1], "label": row[2]}
                    for row in db.execute("SELECT id, created_at, label FROM archives ORDER BY id DESC")]

    def get_archive(self, archive_id):
        with self.connect() as db:
            row = db.execute("SELECT items FROM archives WHERE id=?", (archive_id,)).fetchone()
            return json.loads(row[0]) if row else None

    def restore(self, items, expected_revision):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.snapshot(db)
            if current["revision"] != expected_revision:
                raise Conflict("服务器数据已变化，请刷新后再恢复。")
            self.archive({key: row["value"] for key, row in current["entries"].items()}, "恢复操作前的自动备份", db)
            changes = {key: {"type": "deleted"} for key in current["entries"] if key not in items}
            self.write(db, {**changes, **items})
            return self.snapshot(db)
