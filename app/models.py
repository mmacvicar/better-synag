from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Mode = Literal["manual", "auto"]


class Intensity(BaseModel):
    ch1: int = Field(ge=0, le=100)
    ch2: int = Field(ge=0, le=100)
    ch3: int = Field(ge=0, le=100)
    ch4: int = Field(ge=0, le=100)


class ProgramPoint(BaseModel):
    index: int = Field(ge=1)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    ch1: int = Field(ge=0, le=100)
    ch2: int = Field(ge=0, le=100)
    ch3: int = Field(ge=0, le=100)
    ch4: int = Field(ge=0, le=100)


class Program(BaseModel):
    points: list[ProgramPoint]


class DeviceState(BaseModel):
    mode: Mode
    intensity: Intensity | None = None
    program: Program | None = None


class ModeSetRequest(BaseModel):
    mode: Mode


class IntensitySetRequest(Intensity):
    pass


class ProgramSetRequest(Program):
    pass


class PresetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    mode: Mode
    intensity: Intensity | None = None
    program: Program | None = None


class PresetRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PresetRecord(BaseModel):
    id: int
    name: str
    mode: Mode
    intensity: Intensity | None = None
    program: Program | None = None
    created_at: str


class ValidationPollingConfig(BaseModel):
    enabled: bool
    interval_minutes: int = Field(ge=1, le=1440)


class ValidationPollingConfigRequest(ValidationPollingConfig):
    pass


class HealthzResponse(BaseModel):
    status: Literal["ok", "degraded"]
    db: str
    icv6: str


class ModeSetResponse(BaseModel):
    status: Literal["ok"]
    mode: Mode


class GenericOkResponse(BaseModel):
    status: Literal["ok"]


class ProgramSetResponse(BaseModel):
    status: Literal["ok"]
    ack: int


class PresetCreateResponse(BaseModel):
    status: Literal["ok"]
    id: int


class PresetApplyResponse(BaseModel):
    status: Literal["ok"]
    loaded: dict[str, Any]


class PresetDeleteResponse(BaseModel):
    status: Literal["ok"]


class PresetListResponse(BaseModel):
    presets: list[PresetRecord]


class ValidationRunRecord(BaseModel):
    id: int
    checked_at: str
    status: str
    details: dict[str, Any]


class ValidationRunResult(BaseModel):
    status: str
    reason: str | None = None
    mode: Mode | None = None
    expected: dict[str, Any] | None = None
    reported: dict[str, Any] | None = None
    error: str | None = None
    error_type: str | None = None


class DeviceProgramSyncResponse(BaseModel):
    status: Literal["ok"]
    message: str
