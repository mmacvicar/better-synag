from __future__ import annotations

from app import db
from app.models import Program, ProgramPoint
from app.services.validator import ProgramValidator


class FakeClient:
    def __init__(self, mode: str, program: Program):
        self._mode = mode
        self._program = program

    async def query_mode(self) -> str:
        return self._mode

    async def query_program(self) -> Program:
        return self._program


async def test_validator_skips_without_target(isolated_db_path):
    await db.init_db()
    validator = ProgramValidator(FakeClient("auto", Program(points=[])))
    result = await validator.run_once()
    assert result["status"] == "skipped"
    assert result["reason"] == "no_active_program"


async def test_validator_skips_when_not_auto(isolated_db_path):
    await db.init_db()
    await db.upsert_active_target("auto", None, {"points": []})
    validator = ProgramValidator(FakeClient("manual", Program(points=[])))

    result = await validator.run_once()
    assert result["status"] == "skipped"
    assert result["reason"] == "device_not_in_auto_mode"


async def test_validator_ok_and_mismatch(isolated_db_path):
    await db.init_db()
    expected = {
        "points": [
            {"index": 1, "hour": 8, "minute": 0, "ch1": 0, "ch2": 0, "ch3": 0, "ch4": 0},
            {"index": 2, "hour": 12, "minute": 0, "ch1": 50, "ch2": 60, "ch3": 70, "ch4": 80},
        ]
    }
    await db.upsert_active_target("auto", None, expected)

    same = Program(
        points=[
            ProgramPoint(index=1, hour=8, minute=0, ch1=0, ch2=0, ch3=0, ch4=0),
            ProgramPoint(index=2, hour=12, minute=0, ch1=50, ch2=60, ch3=70, ch4=80),
        ]
    )
    validator = ProgramValidator(FakeClient("auto", same))
    ok = await validator.run_once()
    assert ok["status"] == "ok"

    diff = Program(
        points=[
            ProgramPoint(index=1, hour=8, minute=0, ch1=1, ch2=0, ch3=0, ch4=0),
            ProgramPoint(index=2, hour=12, minute=0, ch1=50, ch2=60, ch3=70, ch4=80),
        ]
    )
    validator_mismatch = ProgramValidator(FakeClient("auto", diff))
    mismatch = await validator_mismatch.run_once()
    assert mismatch["status"] == "mismatch"


async def test_validator_start_stop_idempotent(isolated_db_path, monkeypatch):
    await db.init_db()
    await db.set_validation_polling_config(False, 1)
    validator = ProgramValidator(FakeClient("auto", Program(points=[])))

    validator.start()
    first_task = validator._task
    validator.start()
    assert validator._task is first_task

    await validator.stop()
    assert validator._task is None
