"""Full backup & restore — one zip of everything personal.

A backup archive contains ``config/`` (settings, accounts, categories, goals,
budget, paper-trading accounts, import profiles, …) and ``data/raw/`` (the
SQLite ledger), plus a ``MANIFEST.json``. That is the complete personal state
of the app — market caches are regenerable and the automatic per-write
backups in ``data/backups/`` are deliberately excluded (a backup of backups
just bloats the archive).

Restore is staged and safe:
  1. the archive is validated and extracted to a temp dir (zip-slip guarded);
  2. a **pre-restore snapshot** zip of the current state is written to
     ``data/backups/full_pre_restore_<stamp>.zip`` (outside the replaced
     dirs, so it survives);
  3. ``config/`` and ``data/raw/`` are swapped for the archive's copies; on
     any failure mid-swap the originals are put back.
"""

from __future__ import annotations

import io
import json
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

BACKUP_DIRS = ("config", "data/raw")
MANIFEST_NAME = "MANIFEST.json"
_SKIP_FILES = {".DS_Store", "Thumbs.db"}


def _data_dir(root: Path) -> Path:
    # data_dir from settings, defaulting to "data" (same rule as the store).
    try:
        import tomllib
        with open(root / "config" / "settings.toml", "rb") as f:
            return root / tomllib.load(f).get("general", {}).get("data_dir", "data")
    except (OSError, ValueError):
        return root / "data"


def _iter_backup_files(root: Path):
    for top in BACKUP_DIRS:
        base = root / top
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file() and p.name not in _SKIP_FILES:
                yield p, p.relative_to(root).as_posix()


def create_backup_bytes(root: Path | str = ".") -> tuple[bytes, str]:
    """Zip config/ + data/raw/ (+ manifest). Returns (bytes, filename)."""
    root = Path(root)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    buf = io.BytesIO()
    names = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, arcname in _iter_backup_files(root):
            zf.write(path, arcname)
            names.append(arcname)
        manifest = {
            "app": "Money Tracker",
            "kind": "full-backup",
            "version": 1,
            "created": datetime.now().isoformat(timespec="seconds"),
            "files": len(names),
        }
        zf.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))
    return buf.getvalue(), f"money_tracker_backup_{stamp}.zip"


def inspect_backup(content: bytes) -> dict:
    """Validate an uploaded archive without touching anything.

    Returns {"ok": bool, "error": str|None, "manifest": dict|None,
             "files": int, "has_ledger": bool, "has_config": bool}.
    """
    result = {"ok": False, "error": None, "manifest": None,
              "files": 0, "has_ledger": False, "has_config": False}
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        result["error"] = "Not a zip archive."
        return result
    with zf:
        names = zf.namelist()
        for n in names:
            # zip-slip / absolute-path guard
            if n.startswith("/") or ".." in Path(n).parts:
                result["error"] = f"Archive contains an unsafe path: {n!r}"
                return result
        members = [n for n in names
                   if n.startswith(("config/", "data/raw/")) and not n.endswith("/")]
        result["files"] = len(members)
        result["has_ledger"] = any(n == "data/raw/ledger.db" for n in members)
        result["has_config"] = any(n.startswith("config/") for n in members)
        if MANIFEST_NAME in names:
            try:
                result["manifest"] = json.loads(zf.read(MANIFEST_NAME))
            except (json.JSONDecodeError, KeyError):
                pass
        if not members:
            result["error"] = ("No config/ or data/raw/ entries found — this "
                               "doesn't look like a Money Tracker backup.")
            return result
    result["ok"] = True
    return result


def snapshot_current(root: Path | str = ".") -> Path:
    """Write a full-backup zip of the current state into data/backups/."""
    root = Path(root)
    content, _ = create_backup_bytes(root)
    backups = _data_dir(root) / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = backups / f"full_pre_restore_{stamp}.zip"
    dest.write_bytes(content)
    return dest


def restore_backup_zip(content: bytes, root: Path | str = ".") -> dict:
    """Replace config/ and data/raw/ with the archive's copies.

    A pre-restore snapshot is taken first. The swap is staged: originals are
    moved aside and put back if anything fails. Returns
    {"restored": [dirs], "snapshot": path, "files": n}.
    """
    root = Path(root)
    info = inspect_backup(content)
    if not info["ok"]:
        raise ValueError(info["error"])

    stage = Path(tempfile.mkdtemp(prefix="mt_restore_"))
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for n in zf.namelist():
                if n.startswith(("config/", "data/raw/")) and not n.endswith("/"):
                    zf.extract(n, stage)

        snapshot = snapshot_current(root)

        restored, moved = [], []
        try:
            for top in BACKUP_DIRS:
                src = stage / top
                if not src.exists():
                    continue  # archive without that dir — leave current as-is
                live = root / top
                aside = root / (top.replace("/", "_") + ".pre_restore")
                if aside.exists():
                    shutil.rmtree(aside)
                if live.exists():
                    live.rename(aside)
                    moved.append((live, aside))
                live.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(live))
                restored.append(top)
        except BaseException:
            # put the originals back before re-raising
            for live, aside in moved:
                if not live.exists() and aside.exists():
                    aside.rename(live)
            raise
        for _, aside in moved:
            if aside.exists():
                shutil.rmtree(aside)
        return {"restored": restored, "snapshot": str(snapshot),
                "files": info["files"]}
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def list_auto_backups(root: Path | str = ".") -> list[dict]:
    """Inventory of data/backups/ for the browser table, newest first."""
    backups = _data_dir(Path(root)) / "backups"
    if not backups.exists():
        return []
    kinds = (("ledger_*.db", "Ledger (auto, before each write)", True),
             ("full_pre_restore_*.zip", "Full snapshot (before a restore)", False),
             ("transactions_legacy_*.xlsx", "Legacy ledger archive", False),
             ("transactions_*.xlsx", "Legacy auto backup", False))
    seen, items = set(), []
    for pattern, label, restorable in kinds:
        for p in backups.glob(pattern):
            if p.name in seen:
                continue
            seen.add(p.name)
            items.append({"name": p.name, "kind": label,
                          "restorable": restorable,
                          "size": p.stat().st_size,
                          "mtime": datetime.fromtimestamp(p.stat().st_mtime)})
    return sorted(items, key=lambda d: d["mtime"], reverse=True)
