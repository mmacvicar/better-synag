from __future__ import annotations

from app import db


async def test_active_target_roundtrip(isolated_db_path):
    await db.init_db()
    await db.upsert_active_target("manual", {"ch1": 1, "ch2": 2, "ch3": 3, "ch4": 4}, None)

    got = await db.get_active_target()
    assert got is not None
    assert got["mode"] == "manual"
    assert got["intensity"] == {"ch1": 1, "ch2": 2, "ch3": 3, "ch4": 4}
    assert got["program"] is None


async def test_preset_crud(isolated_db_path):
    await db.init_db()
    pid = await db.create_preset(
        "reef-day",
        "auto",
        {
            "intensity": None,
            "program": {
                "points": [
                    {"index": 1, "hour": 8, "minute": 0, "ch1": 10, "ch2": 10, "ch3": 10, "ch4": 10}
                ]
            },
        },
    )
    assert isinstance(pid, int)

    listed = await db.list_presets()
    assert len(listed) == 1
    assert listed[0]["id"] == pid
    assert listed[0]["name"] == "reef-day"

    preset = await db.get_preset(pid)
    assert preset is not None
    assert preset["mode"] == "auto"
    assert preset["program"]["points"][0]["hour"] == 8

    assert await db.rename_preset(pid, "reef-evening")
    renamed = await db.get_preset(pid)
    assert renamed is not None
    assert renamed["name"] == "reef-evening"

    assert await db.delete_preset(pid)
    assert await db.get_preset(pid) is None


async def test_validation_runs_roundtrip(isolated_db_path):
    await db.init_db()
    await db.insert_validation_run("ok", {"status": "ok"})
    await db.insert_validation_run("mismatch", {"status": "mismatch", "reason": "x"})

    latest = await db.latest_validation_run()
    assert latest is not None
    assert latest["status"] == "mismatch"
    assert latest["details"]["reason"] == "x"


async def test_validation_polling_config_roundtrip(isolated_db_path):
    await db.init_db()

    default_cfg = await db.get_validation_polling_config()
    assert "enabled" in default_cfg
    assert "interval_minutes" in default_cfg

    saved = await db.set_validation_polling_config(False, 7)
    assert saved == {"enabled": False, "interval_minutes": 7}

    loaded = await db.get_validation_polling_config()
    assert loaded == {"enabled": False, "interval_minutes": 7}
