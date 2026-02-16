from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.models import Intensity, Program, ProgramPoint


def _program() -> Program:
    return Program(points=[ProgramPoint(index=1, hour=8, minute=0, ch1=0, ch2=0, ch3=0, ch4=0)])


def _disable_validator_lifecycle(main_module, monkeypatch):
    monkeypatch.setattr(main_module.validator, "start", lambda: None)

    async def _stop():
        return None

    monkeypatch.setattr(main_module.validator, "stop", _stop)


def test_healthz_ok(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    monkeypatch.setattr(main_module.client, "query_mode", AsyncMock(return_value="manual"))

    with TestClient(main_module.app) as tc:
        res = tc.get("/healthz")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["db"] == "ok"
        assert body["icv6"] == "ok"


def test_state_manual_and_auto(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    with TestClient(main_module.app) as tc:
        monkeypatch.setattr(main_module.client, "query_mode", AsyncMock(return_value="manual"))
        monkeypatch.setattr(
            main_module.client,
            "query_intensity",
            AsyncMock(return_value=Intensity(ch1=10, ch2=20, ch3=30, ch4=40)),
        )
        res_manual = tc.get("/api/state")
        assert res_manual.status_code == 200
        assert res_manual.json()["mode"] == "manual"
        assert res_manual.json()["intensity"]["ch3"] == 30

        monkeypatch.setattr(main_module.client, "query_mode", AsyncMock(return_value="auto"))
        monkeypatch.setattr(main_module.client, "query_program", AsyncMock(return_value=_program()))
        res_auto = tc.get("/api/state")
        assert res_auto.status_code == 200
        assert res_auto.json()["mode"] == "auto"
        assert len(res_auto.json()["program"]["points"]) == 1


def test_set_mode_and_manual_intensity(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    monkeypatch.setattr(main_module.client, "set_mode", AsyncMock(return_value=None))
    monkeypatch.setattr(main_module.client, "set_intensity", AsyncMock(return_value=None))

    with TestClient(main_module.app) as tc:
        m = tc.post("/api/mode", json={"mode": "manual"})
        assert m.status_code == 200
        assert m.json()["mode"] == "manual"

        i = tc.post("/api/manual/intensity", json={"ch1": 1, "ch2": 2, "ch3": 3, "ch4": 4})
        assert i.status_code == 200
        assert i.json()["status"] == "ok"


def test_program_and_validation_endpoints(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    monkeypatch.setattr(main_module.client, "set_program", AsyncMock(return_value=1))
    monkeypatch.setattr(main_module.validator, "run_once", AsyncMock(return_value={"status": "ok"}))

    with TestClient(main_module.app) as tc:
        p = tc.post(
            "/api/program",
            json={
                "points": [
                    {"index": 1, "hour": 8, "minute": 0, "ch1": 1, "ch2": 2, "ch3": 3, "ch4": 4}
                ]
            },
        )
        assert p.status_code == 200
        assert p.json()["ack"] == 1

        v = tc.post("/api/validation/run")
        assert v.status_code == 200
        assert v.json()["status"] == "ok"

        cfg_get = tc.get("/api/validation/polling")
        assert cfg_get.status_code == 200
        assert "enabled" in cfg_get.json()
        assert "interval_minutes" in cfg_get.json()

        cfg_set = tc.post("/api/validation/polling", json={"enabled": False, "interval_minutes": 9})
        assert cfg_set.status_code == 200
        assert cfg_set.json() == {"enabled": False, "interval_minutes": 9}


def test_preset_crud_and_apply(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    with TestClient(main_module.app) as tc:
        bad_manual = tc.post("/api/presets", json={"name": "x", "mode": "manual"})
        assert bad_manual.status_code == 400

        bad_auto = tc.post("/api/presets", json={"name": "x2", "mode": "auto"})
        assert bad_auto.status_code == 400

        create = tc.post(
            "/api/presets",
            json={
                "name": "reef-auto",
                "mode": "auto",
                "program": {
                    "points": [
                        {"index": 1, "hour": 8, "minute": 0, "ch1": 0, "ch2": 0, "ch3": 0, "ch4": 0}
                    ]
                },
            },
        )
        assert create.status_code == 200
        pid = create.json()["id"]

        listed = tc.get("/api/presets")
        assert listed.status_code == 200
        assert any(p["id"] == pid for p in listed.json())

        apply_res = tc.post(f"/api/presets/{pid}/apply")
        assert apply_res.status_code == 200
        assert apply_res.json()["loaded"]["mode"] == "auto"

        rename_res = tc.patch(f"/api/presets/{pid}", json={"name": "reef-auto-2"})
        assert rename_res.status_code == 200

        delete_res = tc.delete(f"/api/presets/{pid}")
        assert delete_res.status_code == 200

        missing_apply = tc.post(f"/api/presets/{pid}/apply")
        assert missing_apply.status_code == 404


def test_duplicate_preset_name_returns_400(main_module, monkeypatch):
    _disable_validator_lifecycle(main_module, monkeypatch)
    with TestClient(main_module.app) as tc:
        body = {
            "name": "reef-dupe",
            "mode": "manual",
            "intensity": {"ch1": 1, "ch2": 2, "ch3": 3, "ch4": 4},
        }
        first = tc.post("/api/presets", json=body)
        assert first.status_code == 200

        second = tc.post("/api/presets", json=body)
        assert second.status_code == 400
        assert "already exists" in second.json()["detail"]
