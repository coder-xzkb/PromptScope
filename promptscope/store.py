"""Local SQLite store. Images and experiments are never committed to source."""
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "images").mkdir(exist_ok=True)
        self.db = self.root / "experiments.sqlite3"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT PRIMARY KEY, payload TEXT)")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.db, timeout=30)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def put(self, kind, payload):
        payload = {"id": uuid.uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat(), **payload}
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO records VALUES (?, ?, ?)",
                       (kind, payload["id"], json.dumps(payload, ensure_ascii=False, allow_nan=False)))
        return payload

    def get(self, kind, identifier):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM records WHERE kind=? AND id=?", (kind, identifier)).fetchone()
        if not row:
            raise KeyError(identifier)
        return json.loads(row[0])

    def list(self, kind):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC", (kind,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def cached(self, cache_key):
        return next((r for r in self.list("run") if r.get("cache_key") == cache_key), None)
