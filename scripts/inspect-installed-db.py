"""Read-only integrity summary for an installed Yanyi SQLite database."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def scalar(connection: sqlite3.Connection, query: str) -> object:
    row = connection.execute(query).fetchone()
    return row[0] if row else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    database = args.database.resolve(strict=True)
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        summary = {
            "integrity": scalar(connection, "PRAGMA integrity_check"),
            "userVersion": scalar(connection, "PRAGMA user_version"),
            "journalMode": scalar(connection, "PRAGMA journal_mode"),
            "foreignKeys": scalar(connection, "PRAGMA foreign_keys"),
            "tables": scalar(
                connection,
                "SELECT count(1) FROM sqlite_master WHERE type = 'table'",
            ),
            "topLevelDomains": scalar(
                connection,
                "SELECT count(1) FROM glossary_domains WHERE kind = 'top_level'",
            ),
            "builtInWebsiteRules": scalar(
                connection,
                "SELECT count(1) FROM website_rules WHERE is_builtin = 1",
            ),
            "taskPresets": scalar(connection, "SELECT count(1) FROM task_presets"),
        }
    finally:
        connection.close()
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
