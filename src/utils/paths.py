"""Filesystem layout for both source runs and frozen (PyInstaller) builds.

The app resolves every path relative to the current working directory
(``load_config("config")`` reads ``./config``, ``./data`` holds the ledger, …).
That makes a frozen build easy: run it from a **per-user writable folder**
seeded once from a **bundled** ``config.example``.

Two questions this module answers:

* Where are the read-only files that ship *inside* the executable?
  → :func:`resource_path` (``sys._MEIPASS`` when frozen, project root otherwise).
* Where should the app read/write live data?
  → :func:`app_data_dir` (a per-user OS-appropriate folder when frozen; the
  project root when running from source, preserving the current dev workflow).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "MoneyTracker"

# Project root when running from source: money_tracker/ (two parents up from
# src/utils/paths.py). Used as both the resource root and the data root in dev.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def is_frozen() -> bool:
    """True when running inside a PyInstaller (or similar) bundle."""
    return getattr(sys, "frozen", False)


def resource_path(rel: str | os.PathLike[str] = "") -> Path:
    """Absolute path to a read-only file that ships with the app.

    Frozen: rooted at PyInstaller's extraction dir (``sys._MEIPASS``).
    Source: rooted at the project root. ``rel=""`` returns the root itself.
    """
    base = Path(getattr(sys, "_MEIPASS", _PROJECT_ROOT)) if is_frozen() else _PROJECT_ROOT
    return base / rel if str(rel) else base


def app_data_dir() -> Path:
    """Per-user, writable directory for live config + data.

    * Source run → the project root, so `python run_app.py` keeps writing
      ``./config`` and ``./data`` exactly as before (dev workflow unchanged).
    * Frozen run → an OS-appropriate application-data folder, created if
      needed, so the read-only bundle never has to be written to:

      - macOS   → ``~/Library/Application Support/MoneyTracker``
      - Windows → ``%APPDATA%\\MoneyTracker``
      - Linux   → ``$XDG_DATA_HOME/money-tracker`` (default ``~/.local/share``)

    An explicit ``MT_DATA_DIR`` override wins on every platform (useful for
    portable installs and tests).
    """
    override = os.getenv("MT_DATA_DIR", "").strip()
    if override:
        d = Path(override).expanduser()
    elif not is_frozen():
        return _PROJECT_ROOT
    elif sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / APP_NAME
    elif os.name == "nt":
        base = os.getenv("APPDATA") or (Path.home() / "AppData" / "Roaming")
        d = Path(base) / APP_NAME
    else:  # Linux / other POSIX
        base = os.getenv("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
        d = Path(base) / "money-tracker"
    d.mkdir(parents=True, exist_ok=True)
    return d
