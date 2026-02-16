from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.models import Intensity, Program, ProgramPoint

MAGIC_DD = bytes.fromhex("ddeeff")
MAGIC_FF = bytes.fromhex("ffeeddcc")


@dataclass
class ParsedFrame:
    raw: bytes
    cmd_group: int
    cmd_id: int
    args: bytes
    device_id: str


class ICV6Client:
    def __init__(self, host: str, port: int, device_id: str, timeout: float = 2.0) -> None:
        self.host = host
        self.port = port
        self.device_id = device_id
        self.timeout = timeout

    async def query_mode(self) -> str:
        response = await self._request(0x0F, 0x01, b"", expect_group=0x5F, expect_id=0x01)
        if not response.args:
            raise RuntimeError("mode response missing args")
        return "manual" if response.args[0] == 0x01 else "auto"

    async def set_mode(self, mode: str) -> None:
        mode_byte = 0x01 if mode == "manual" else 0x02
        await self._request(0x0F, 0x02, bytes([mode_byte]), expect_group=0x5F, expect_id=0x02)

    async def query_intensity(self) -> Intensity:
        response = await self._request(0x0F, 0x0D, b"", expect_group=0x5F, expect_id=0x0D)
        if len(response.args) < 4:
            raise RuntimeError("intensity response too short")
        return Intensity(
            ch1=response.args[0], ch2=response.args[1], ch3=response.args[2], ch4=response.args[3]
        )

    async def set_intensity(self, intensity: Intensity) -> None:
        args = bytes([intensity.ch1, intensity.ch2, intensity.ch3, intensity.ch4])
        await self._request(0x0F, 0x0C, args, expect_group=0x5F, expect_id=0x0C)

    async def set_preview_intensity(self, intensity: Intensity) -> None:
        args = bytes([intensity.ch1, intensity.ch2, intensity.ch3, intensity.ch4])
        await self._request(0x0F, 0x0B, args, expect_group=0x5F, expect_id=0x0B)

    async def query_program(self) -> Program:
        response = await self._request(0x0F, 0x0F, b"", expect_group=0x5F, expect_id=0x0F)
        return self._decode_program_args(response.args)

    async def set_program(self, program: Program) -> int:
        args = self._encode_program_args(program)
        response = await self._request(0x0F, 0x0E, args, expect_group=0x5F, expect_id=0x0E)
        if not response.args:
            return 0
        return response.args[0]

    async def _request(
        self, cmd_group: int, cmd_id: int, args: bytes, expect_group: int, expect_id: int
    ) -> ParsedFrame:
        frame = self._build_frame(cmd_group, cmd_id, args)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), timeout=self.timeout
        )
        try:
            writer.write(frame)
            await writer.drain()
            parsed = await asyncio.wait_for(
                self._read_expected(reader, expect_group, expect_id), timeout=self.timeout
            )
            return parsed
        finally:
            writer.close()
            await writer.wait_closed()

    async def _read_expected(
        self, reader: asyncio.StreamReader, expect_group: int, expect_id: int
    ) -> ParsedFrame:
        buf = bytearray()
        while True:
            chunk = await reader.read(4096)
            if not chunk:
                raise RuntimeError("connection closed before expected response")
            buf.extend(chunk)

            while True:
                if len(buf) < 5:
                    break

                # Skip keepalive family if it appears.
                if buf[:4] == MAGIC_FF:
                    if len(buf) < 9:
                        break
                    del buf[:9]
                    continue

                start = bytes(buf).find(MAGIC_DD)
                if start < 0:
                    buf.clear()
                    break
                if start > 0:
                    del buf[:start]
                    if len(buf) < 5:
                        break

                frame_len = buf[4]
                total_len = 5 + frame_len
                if len(buf) < total_len:
                    break

                raw = bytes(buf[:total_len])
                del buf[:total_len]

                parsed = self._parse_dd_frame(raw)
                if parsed.cmd_group == expect_group and parsed.cmd_id == expect_id:
                    return parsed

    def _build_frame(self, cmd_group: int, cmd_id: int, args: bytes) -> bytes:
        if len(self.device_id) != 11:
            raise ValueError(f"device id must be 11 chars on wire, got {self.device_id}")

        body = (
            bytes([0xFF]) + self.device_id.encode("ascii") + bytes([0x01, cmd_group, cmd_id]) + args
        )
        len_field = len(body) + 1
        checksum = (len_field + sum(body)) & 0xFF
        return MAGIC_DD + bytes([0x00, len_field]) + body + bytes([checksum])

    def _parse_dd_frame(self, raw: bytes) -> ParsedFrame:
        if len(raw) < 21 or raw[:3] != MAGIC_DD:
            raise RuntimeError("invalid frame header")

        expected_len = 5 + raw[4]
        if len(raw) != expected_len:
            raise RuntimeError("invalid frame length")

        body = raw[5:-1]
        checksum = raw[-1]
        calc = (raw[4] + sum(body)) & 0xFF
        if checksum != calc:
            raise RuntimeError("bad checksum")

        cmd_group = raw[18]
        cmd_id = raw[19]
        args = raw[20:-1]
        device_id = raw[6:17].decode("ascii", errors="replace")
        return ParsedFrame(
            raw=raw, cmd_group=cmd_group, cmd_id=cmd_id, args=args, device_id=device_id
        )

    def _decode_program_args(self, args: bytes) -> Program:
        if not args:
            return Program(points=[])
        count = args[0]
        body = args[1:]
        if len(body) != count * 7:
            raise RuntimeError("invalid program payload")

        points: list[ProgramPoint] = []
        for i in range(count):
            rec = body[i * 7 : (i + 1) * 7]
            points.append(
                ProgramPoint(
                    index=rec[0],
                    hour=rec[1],
                    minute=rec[2],
                    ch1=rec[3],
                    ch2=rec[4],
                    ch3=rec[5],
                    ch4=rec[6],
                )
            )
        return Program(points=points)

    def _encode_program_args(self, program: Program) -> bytes:
        points_sorted = sorted(program.points, key=lambda p: p.index)
        out = bytearray([len(points_sorted)])
        for p in points_sorted:
            out.extend([p.index, p.hour, p.minute, p.ch1, p.ch2, p.ch3, p.ch4])
        return bytes(out)
