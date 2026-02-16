from __future__ import annotations

import sqlite3

from app import db
from app.errors import NotFoundError, ValidationError
from app.models import PresetCreateRequest


class PresetService:
    async def list_presets(self) -> list[dict]:
        return await db.list_presets()

    async def create_preset(self, payload: PresetCreateRequest) -> int:
        if payload.mode == "manual" and not payload.intensity:
            raise ValidationError("manual preset requires intensity")
        if payload.mode == "auto" and not payload.program:
            raise ValidationError("auto preset requires program")

        try:
            return await db.create_preset(
                payload.name,
                payload.mode,
                {
                    "intensity": payload.intensity.model_dump() if payload.intensity else None,
                    "program": payload.program.model_dump() if payload.program else None,
                },
            )
        except sqlite3.IntegrityError as exc:
            raise ValidationError("preset name already exists") from exc

    async def apply_preset(self, preset_id: int) -> dict:
        preset = await db.get_preset(preset_id)
        if not preset:
            raise NotFoundError("preset not found")
        return preset

    async def rename_preset(self, preset_id: int, name: str) -> None:
        if not await db.rename_preset(preset_id, name):
            raise NotFoundError("preset not found")

    async def delete_preset(self, preset_id: int) -> None:
        if not await db.delete_preset(preset_id):
            raise NotFoundError("preset not found")
