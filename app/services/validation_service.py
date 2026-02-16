from __future__ import annotations

from app import db
from app.models import ValidationPollingConfigRequest
from app.services.validator import ProgramValidator


class ValidationService:
    def __init__(self, validator: ProgramValidator) -> None:
        self.validator = validator

    async def run_now(self) -> dict:
        return await self.validator.run_once()

    async def latest(self) -> dict | None:
        return await db.latest_validation_run()

    async def get_polling_config(self) -> dict:
        return await db.get_validation_polling_config()

    async def set_polling_config(self, payload: ValidationPollingConfigRequest) -> dict:
        return await db.set_validation_polling_config(payload.enabled, payload.interval_minutes)
