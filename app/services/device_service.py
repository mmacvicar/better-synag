from __future__ import annotations

import logging

from app import db
from app.errors import DeviceCommunicationError
from app.models import DeviceState, Intensity, Program
from app.services.icv6_client import ICV6Client

logger = logging.getLogger(__name__)


class DeviceService:
    def __init__(self, client: ICV6Client) -> None:
        self.client = client

    async def get_state(self) -> DeviceState:
        try:
            mode = await self.client.query_mode()
            if mode == "manual":
                intensity = await self.client.query_intensity()
                return DeviceState(mode="manual", intensity=intensity, program=None)
            program = await self.client.query_program()
            return DeviceState(mode="auto", intensity=None, program=program)
        except Exception as exc:  # noqa: BLE001
            logger.exception("failed to fetch device state")
            raise DeviceCommunicationError(f"failed to query device state: {exc}") from exc

    async def set_mode(self, mode: str) -> str:
        try:
            await self.client.set_mode(mode)
        except Exception as exc:  # noqa: BLE001
            logger.exception("failed to set mode", extra={"mode": mode})
            raise DeviceCommunicationError(f"failed to set mode: {exc}") from exc

        target = await db.get_active_target()
        intensity = target["intensity"] if target else None
        program = target["program"] if target else None
        await db.upsert_active_target(mode, intensity, program)
        return mode

    async def set_manual_intensity(self, intensity: Intensity) -> None:
        try:
            await self.client.set_intensity(intensity)
        except Exception as exc:  # noqa: BLE001
            logger.exception("failed to set manual intensity")
            raise DeviceCommunicationError(f"failed to set intensity: {exc}") from exc
        await db.upsert_active_target("manual", intensity.model_dump(), None)

    async def set_program(self, program: Program) -> int:
        try:
            ack = await self.client.set_program(program)
        except Exception as exc:  # noqa: BLE001
            logger.exception("failed to set program")
            raise DeviceCommunicationError(f"failed to upload program: {exc}") from exc
        await db.upsert_active_target("auto", None, program.model_dump())
        return ack
