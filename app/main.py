from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal, cast

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app import db
from app.config import settings
from app.errors import AppError
from app.logging_config import configure_logging
from app.models import (
    DeviceState,
    GenericOkResponse,
    HealthzResponse,
    Intensity,
    IntensitySetRequest,
    ModeSetRequest,
    ModeSetResponse,
    PresetApplyResponse,
    PresetCreateRequest,
    PresetCreateResponse,
    PresetDeleteResponse,
    PresetRecord,
    PresetRenameRequest,
    Program,
    ProgramSetRequest,
    ProgramSetResponse,
    ValidationPollingConfig,
    ValidationPollingConfigRequest,
    ValidationRunRecord,
    ValidationRunResult,
)
from app.services.device_service import DeviceService
from app.services.icv6_client import ICV6Client
from app.services.preset_service import PresetService
from app.services.validation_service import ValidationService
from app.services.validator import ProgramValidator

configure_logging()
logger = logging.getLogger(__name__)

client = ICV6Client(settings.icv6_host, settings.icv6_port, settings.icv6_device_id)
validator = ProgramValidator(client)
device_service = DeviceService(client)
preset_service = PresetService()
validation_service = ValidationService(validator)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    validator.start()
    logger.info("application started")
    try:
        yield
    finally:
        await validator.stop()
        logger.info("application stopped")


app = FastAPI(title="ICV6 Portal", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unexpected error")
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    presets = await db.list_presets()
    latest_validation = await db.latest_validation_run()
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "presets": presets,
            "validation": latest_validation,
            "host": settings.icv6_host,
            "device_id": settings.icv6_device_id,
        },
    )


@app.get("/healthz", response_model=HealthzResponse)
async def healthz() -> HealthzResponse:
    result: dict[str, str] = {"status": "ok", "db": "ok", "icv6": "ok"}
    try:
        await db.latest_validation_run()
    except Exception as exc:  # noqa: BLE001
        result["status"] = "degraded"
        result["db"] = f"error:{exc}"

    try:
        await client.query_mode()
    except Exception as exc:  # noqa: BLE001
        result["status"] = "degraded"
        result["icv6"] = f"error:{exc}"

    return HealthzResponse(
        status=cast(Literal["ok", "degraded"], result["status"]),
        db=result["db"],
        icv6=result["icv6"],
    )


@app.get("/api/state", response_model=DeviceState)
async def get_state() -> DeviceState:
    return await device_service.get_state()


@app.post("/api/mode", response_model=ModeSetResponse)
async def set_mode(payload: ModeSetRequest) -> ModeSetResponse:
    mode = await device_service.set_mode(payload.mode)
    return ModeSetResponse(status="ok", mode=cast(Literal["manual", "auto"], mode))


@app.post("/api/manual/intensity", response_model=GenericOkResponse)
async def set_manual_intensity(payload: IntensitySetRequest) -> GenericOkResponse:
    intensity = Intensity(**payload.model_dump())
    await device_service.set_manual_intensity(intensity)
    return GenericOkResponse(status="ok")


@app.post("/api/program", response_model=ProgramSetResponse)
async def set_program(payload: ProgramSetRequest) -> ProgramSetResponse:
    program = Program(**payload.model_dump())
    ack = await device_service.set_program(program)
    return ProgramSetResponse(status="ok", ack=ack)


@app.get("/api/presets", response_model=list[PresetRecord])
async def list_presets() -> list[PresetRecord]:
    presets = await preset_service.list_presets()
    return [PresetRecord(**p) for p in presets]


@app.post("/api/presets", response_model=PresetCreateResponse)
async def create_preset(payload: PresetCreateRequest) -> PresetCreateResponse:
    preset_id = await preset_service.create_preset(payload)
    return PresetCreateResponse(status="ok", id=preset_id)


@app.post("/api/presets/{preset_id}/apply", response_model=PresetApplyResponse)
async def apply_preset(preset_id: int) -> PresetApplyResponse:
    preset = await preset_service.apply_preset(preset_id)
    return PresetApplyResponse(status="ok", loaded=preset)


@app.patch("/api/presets/{preset_id}", response_model=GenericOkResponse)
async def rename_preset(preset_id: int, payload: PresetRenameRequest) -> GenericOkResponse:
    await preset_service.rename_preset(preset_id, payload.name)
    return GenericOkResponse(status="ok")


@app.delete("/api/presets/{preset_id}", response_model=PresetDeleteResponse)
async def delete_preset(preset_id: int) -> PresetDeleteResponse:
    await preset_service.delete_preset(preset_id)
    return PresetDeleteResponse(status="ok")


@app.post("/api/validation/run", response_model=ValidationRunResult)
async def run_validation_now() -> ValidationRunResult:
    return ValidationRunResult(**(await validation_service.run_now()))


@app.get("/api/validation/latest", response_model=ValidationRunRecord | None)
async def get_latest_validation() -> ValidationRunRecord | None:
    latest = await validation_service.latest()
    return ValidationRunRecord(**latest) if latest else None


@app.get("/api/validation/polling", response_model=ValidationPollingConfig)
async def get_validation_polling_config() -> ValidationPollingConfig:
    return ValidationPollingConfig(**(await validation_service.get_polling_config()))


@app.post("/api/validation/polling", response_model=ValidationPollingConfig)
async def set_validation_polling_config(
    payload: ValidationPollingConfigRequest,
) -> ValidationPollingConfig:
    return ValidationPollingConfig(**(await validation_service.set_polling_config(payload)))
