from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import aiosqlite

from app.config import settings

MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            mode TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS active_target (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mode TEXT NOT NULL,
            intensity_json TEXT,
            program_json TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS validation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checked_at TEXT NOT NULL,
            status TEXT NOT NULL,
            details_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """,
    ),
]


def _connect() -> aiosqlite.Connection:
    return aiosqlite.connect(settings.database_path)


async def _ensure_migration_table(conn: aiosqlite.Connection) -> None:
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """)


async def _applied_versions(conn: aiosqlite.Connection) -> set[int]:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT version FROM schema_migrations")
    rows = await cur.fetchall()
    return {int(row["version"]) for row in rows}


async def init_db() -> None:
    async with _connect() as conn:
        await _ensure_migration_table(conn)
        applied = await _applied_versions(conn)
        for version, sql in MIGRATIONS:
            if version in applied:
                continue
            await conn.executescript(sql)
            await conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (version, datetime.now(UTC).isoformat()),
            )
        await conn.commit()


async def upsert_active_target(mode: str, intensity: dict | None, program: dict | None) -> None:
    now = datetime.now(UTC).isoformat()
    async with _connect() as conn:
        await conn.execute(
            """
            INSERT INTO active_target (id, mode, intensity_json, program_json, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              mode=excluded.mode,
              intensity_json=excluded.intensity_json,
              program_json=excluded.program_json,
              updated_at=excluded.updated_at
            """,
            (
                mode,
                json.dumps(intensity) if intensity is not None else None,
                json.dumps(program) if program is not None else None,
                now,
            ),
        )
        await conn.commit()


async def get_active_target() -> dict[str, Any] | None:
    async with _connect() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM active_target WHERE id = 1")
        row = await cur.fetchone()
        if not row:
            return None
        return {
            "mode": row["mode"],
            "intensity": json.loads(row["intensity_json"]) if row["intensity_json"] else None,
            "program": json.loads(row["program_json"]) if row["program_json"] else None,
            "updated_at": row["updated_at"],
        }


async def create_preset(name: str, mode: str, payload: dict[str, Any]) -> int:
    now = datetime.now(UTC).isoformat()
    async with _connect() as conn:
        cur = await conn.execute(
            "INSERT INTO presets (name, mode, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (name, mode, json.dumps(payload), now),
        )
        await conn.commit()
        if cur.lastrowid is None:
            raise RuntimeError("failed to persist preset")
        return int(cur.lastrowid)


async def list_presets() -> list[dict[str, Any]]:
    async with _connect() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM presets ORDER BY id DESC")
        rows = await cur.fetchall()
        out = []
        for row in rows:
            payload = json.loads(row["payload_json"])
            out.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "mode": row["mode"],
                    "intensity": payload.get("intensity"),
                    "program": payload.get("program"),
                    "created_at": row["created_at"],
                }
            )
        return out


async def get_preset(preset_id: int) -> dict[str, Any] | None:
    async with _connect() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM presets WHERE id = ?", (preset_id,))
        row = await cur.fetchone()
        if not row:
            return None
        payload = json.loads(row["payload_json"])
        return {
            "id": row["id"],
            "name": row["name"],
            "mode": row["mode"],
            "intensity": payload.get("intensity"),
            "program": payload.get("program"),
            "created_at": row["created_at"],
        }


async def rename_preset(preset_id: int, new_name: str) -> bool:
    async with _connect() as conn:
        cur = await conn.execute("UPDATE presets SET name = ? WHERE id = ?", (new_name, preset_id))
        await conn.commit()
        return cur.rowcount > 0


async def delete_preset(preset_id: int) -> bool:
    async with _connect() as conn:
        cur = await conn.execute("DELETE FROM presets WHERE id = ?", (preset_id,))
        await conn.commit()
        return cur.rowcount > 0


async def insert_validation_run(status: str, details: dict[str, Any]) -> None:
    now = datetime.now(UTC).isoformat()
    async with _connect() as conn:
        await conn.execute(
            "INSERT INTO validation_runs (checked_at, status, details_json) VALUES (?, ?, ?)",
            (now, status, json.dumps(details)),
        )
        await conn.commit()


async def latest_validation_run() -> dict[str, Any] | None:
    async with _connect() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM validation_runs ORDER BY id DESC LIMIT 1")
        row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "checked_at": row["checked_at"],
            "status": row["status"],
            "details": json.loads(row["details_json"]),
        }


async def set_setting(key: str, value: str) -> None:
    async with _connect() as conn:
        await conn.execute(
            """
            INSERT INTO app_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            (key, value),
        )
        await conn.commit()


async def get_setting(key: str) -> str | None:
    async with _connect() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row["value"] if row else None


async def get_validation_polling_config() -> dict[str, Any]:
    raw_enabled = await get_setting("validation_polling_enabled")
    raw_interval_seconds = await get_setting("validation_polling_interval_seconds")
    enabled = True if raw_enabled is None else raw_enabled == "1"
    try:
        interval_seconds = (
            settings.validation_interval_seconds
            if raw_interval_seconds is None
            else max(60, int(raw_interval_seconds))
        )
    except ValueError:
        interval_seconds = settings.validation_interval_seconds
    return {
        "enabled": enabled,
        "interval_minutes": max(1, interval_seconds // 60),
    }


async def set_validation_polling_config(enabled: bool, interval_minutes: int) -> dict[str, Any]:
    minutes = max(1, int(interval_minutes))
    await set_setting("validation_polling_enabled", "1" if enabled else "0")
    await set_setting("validation_polling_interval_seconds", str(minutes * 60))
    return {
        "enabled": bool(enabled),
        "interval_minutes": minutes,
    }
