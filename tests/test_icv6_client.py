from __future__ import annotations

import pytest

from app.models import Program, ProgramPoint
from app.services.icv6_client import ICV6Client, ParsedFrame


def test_build_and_parse_frame_roundtrip():
    client = ICV6Client("127.0.0.1", 80, "R5S2A000188")
    frame = client._build_frame(0x0F, 0x02, bytes([0x01]))
    parsed = client._parse_dd_frame(frame)

    assert parsed.cmd_group == 0x0F
    assert parsed.cmd_id == 0x02
    assert parsed.args == bytes([0x01])
    assert parsed.device_id == "R5S2A000188"


def test_program_encode_decode_roundtrip():
    client = ICV6Client("127.0.0.1", 80, "R5S2A000188")
    program = Program(
        points=[
            ProgramPoint(index=2, hour=10, minute=30, ch1=50, ch2=40, ch3=30, ch4=20),
            ProgramPoint(index=1, hour=8, minute=0, ch1=0, ch2=0, ch3=0, ch4=0),
        ]
    )

    encoded = client._encode_program_args(program)
    decoded = client._decode_program_args(encoded)

    assert [p.index for p in decoded.points] == [1, 2]
    assert decoded.points[1].hour == 10
    assert decoded.points[1].ch4 == 20


def test_decode_program_invalid_payload_raises():
    client = ICV6Client("127.0.0.1", 80, "R5S2A000188")
    with pytest.raises(RuntimeError, match="invalid program payload"):
        client._decode_program_args(bytes([2, 1, 8, 0, 1, 2, 3, 4]))  # count=2 but only 1 record


@pytest.mark.asyncio
async def test_query_mode_manual_and_auto(monkeypatch: pytest.MonkeyPatch):
    client = ICV6Client("127.0.0.1", 80, "R5S2A000188")

    async def fake_request_manual(*_args, **_kwargs):
        return ParsedFrame(
            raw=b"", cmd_group=0x5F, cmd_id=0x01, args=bytes([0x01]), device_id="R5S2A000188"
        )

    async def fake_request_auto(*_args, **_kwargs):
        return ParsedFrame(
            raw=b"", cmd_group=0x5F, cmd_id=0x01, args=bytes([0x02]), device_id="R5S2A000188"
        )

    monkeypatch.setattr(client, "_request", fake_request_manual)
    assert await client.query_mode() == "manual"

    monkeypatch.setattr(client, "_request", fake_request_auto)
    assert await client.query_mode() == "auto"
