from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config, db


@pytest.fixture()
def isolated_db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(config.settings, "database_path", str(db_path), raising=False)
    monkeypatch.setattr(db.settings, "database_path", str(db_path), raising=False)
    return db_path


@pytest.fixture()
def main_module(isolated_db_path: Path, monkeypatch: pytest.MonkeyPatch):
    import app.main as main

    monkeypatch.setattr(main.settings, "database_path", str(isolated_db_path), raising=False)
    monkeypatch.setattr(main.db.settings, "database_path", str(isolated_db_path), raising=False)
    return importlib.reload(main)
