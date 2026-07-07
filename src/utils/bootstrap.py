"""First-run bootstrap so a fresh clone runs with no data present.

Creates the local data directories and, when there is no ``config/`` yet, seeds
it from the shipped ``config.example/`` templates. Idempotent and safe to call
on every launch. Paths are resolved relative to ``root`` (the project root,
which the app also treats as the working directory).
"""

from __future__ import annotations

import shutil
from pathlib import Path

DATA_DIRS = ("data/raw", "data/backups", "data/stocks_cache", "data/processed")


def ensure_data_dirs(root: Path | str = ".") -> None:
    """Create the data directories the app writes into (no-op if they exist)."""
    root = Path(root)
    for d in DATA_DIRS:
        (root / d).mkdir(parents=True, exist_ok=True)


def ensure_config(root: Path | str = ".", template: str = "config.example") -> bool:
    """Seed ``config/`` from the templates when it doesn't exist.

    Returns True if a fresh ``config/`` was created, False if one already
    existed (or no templates are present to copy).
    """
    root = Path(root)
    config = root / "config"
    if config.exists():
        return False
    tmpl = root / template
    if not tmpl.exists():
        config.mkdir(parents=True, exist_ok=True)
        return False
    shutil.copytree(tmpl, config)
    # the template's own README is not part of a live config
    (config / "README.md").unlink(missing_ok=True)
    return True


def bootstrap(root: Path | str = ".") -> None:
    """Ensure data dirs and a config/ exist, then migrate any legacy xlsx
    ledger to SQLite. Call once on launch."""
    ensure_data_dirs(root)
    ensure_config(root)
    # Lazy import: migration needs pandas, plain dir/config setup does not.
    from src.io.migrate import migrate_legacy_xlsx
    migrate_legacy_xlsx(root)
