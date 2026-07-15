"""Packaging helpers for the frozen desktop build.

Everything here is filesystem/OS logic with no Dash or network, so tests
monkeypatch ``sys.frozen`` / ``sys._MEIPASS`` and platform, and write into
``tmp_path`` — never a real Desktop or app-data folder.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from src.utils import paths, shortcut
from src.utils.bootstrap import ensure_config


# ── paths.resource_path / is_frozen ────────────────────────────────────────────

def test_resource_path_from_source_is_project_root():
    # From source, resources resolve under the project root (repo layout).
    assert (paths.resource_path("config.example")).is_dir()
    assert (paths.resource_path("requirements.txt")).is_file()


def test_resource_path_when_frozen(monkeypatch, tmp_path):
    meipass = tmp_path / "bundle"
    (meipass / "config.example").mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(meipass), raising=False)
    assert paths.is_frozen() is True
    assert paths.resource_path("config.example") == meipass / "config.example"
    assert paths.resource_path() == meipass


# ── paths.app_data_dir ──────────────────────────────────────────────────────────

def test_app_data_dir_source_is_project_root(monkeypatch):
    monkeypatch.delenv("MT_DATA_DIR", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    assert paths.app_data_dir() == paths._PROJECT_ROOT


def test_app_data_dir_env_override_wins(monkeypatch, tmp_path):
    target = tmp_path / "mydata"
    monkeypatch.setenv("MT_DATA_DIR", str(target))
    d = paths.app_data_dir()
    assert d == target and d.is_dir()  # created on demand


@pytest.mark.parametrize("platform,osname,expected_tail", [
    ("darwin", "posix", ("Library", "Application Support", "MoneyTracker")),
    ("linux", "posix", (".local", "share", "money-tracker")),
])
def test_app_data_dir_frozen_per_platform(monkeypatch, tmp_path, platform, osname, expected_tail):
    monkeypatch.delenv("MT_DATA_DIR", raising=False)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "platform", platform)
    monkeypatch.setattr(paths.os, "name", osname)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    d = paths.app_data_dir()
    assert d.parts[-len(expected_tail):] == expected_tail
    assert d.is_dir()


# ── bootstrap seeding from an absolute (bundled) template ───────────────────────

def test_ensure_config_seeds_from_absolute_template(tmp_path):
    template = tmp_path / "bundle" / "config.example"
    template.mkdir(parents=True)
    (template / "settings.toml").write_text("[general]\napp_name='X'\n", encoding="utf-8")
    (template / "README.md").write_text("template readme", encoding="utf-8")

    root = tmp_path / "appdata"
    root.mkdir()
    created = ensure_config(root, template=template)  # absolute path
    assert created is True
    assert (root / "config" / "settings.toml").is_file()
    # the template's own README is not copied into a live config
    assert not (root / "config" / "README.md").exists()

    # Idempotent: a second call is a no-op.
    assert ensure_config(root, template=template) is False


# ── shortcut creation (no real Desktop writes) ─────────────────────────────────

def test_create_shortcut_linux_writes_desktop_entry(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(shortcut.os, "name", "posix")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(sys, "executable", "/opt/MoneyTracker/MoneyTracker")

    assert shortcut.create_desktop_shortcut(icon="money-tracker") is True
    entry = tmp_path / ".local" / "share" / "applications" / "money-tracker.desktop"
    assert entry.is_file()
    text = entry.read_text()
    assert "Exec=\"/opt/MoneyTracker/MoneyTracker\"" in text
    assert "Name=Money Tracker" in text


def test_create_shortcut_macos_is_noop_success(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(shortcut.os, "name", "posix")
    assert shortcut.create_desktop_shortcut() is True
