from __future__ import annotations

import asyncio
import logging
from typing import Any

from app import db
from app.services.icv6_client import ICV6Client

logger = logging.getLogger(__name__)


class ProgramValidator:
    def __init__(self, client: ICV6Client) -> None:
        self.client = client
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="program-validator")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            await self._task
        self._task = None

    async def run_once(self) -> dict[str, Any]:
        target = await db.get_active_target()
        if not target or not target.get("program"):
            result: dict[str, Any] = {"status": "skipped", "reason": "no_active_program"}
            await db.insert_validation_run("skipped", result)
            return result

        current_mode = await self.client.query_mode()
        if current_mode != "auto":
            result = {
                "status": "skipped",
                "reason": "device_not_in_auto_mode",
                "mode": current_mode,
            }
            await db.insert_validation_run("skipped", result)
            return result

        reported_program = await self.client.query_program()
        reported = {"points": [p.model_dump() for p in reported_program.points]}
        expected = target["program"]
        matches = reported == expected
        result = {
            "status": "ok" if matches else "mismatch",
            "expected": expected,
            "reported": reported,
        }
        await db.insert_validation_run("ok" if matches else "mismatch", result)
        return result

    async def _run(self) -> None:
        while not self._stop.is_set():
            config = await db.get_validation_polling_config()
            enabled = bool(config.get("enabled", True))
            interval_minutes = max(1, int(config.get("interval_minutes", 1)))
            try:
                if enabled:
                    await self.run_once()
                else:
                    logger.debug("validation polling disabled")
            except Exception as exc:  # noqa: BLE001
                logger.exception("validation loop error")
                await db.insert_validation_run(
                    "error",
                    {"error": str(exc), "error_type": type(exc).__name__, "error_repr": repr(exc)},
                )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval_minutes * 60)
            except TimeoutError:
                pass
