"""First-run desktop shortcut creation for the frozen desktop app.

Best-effort and idempotent: :func:`create_desktop_shortcut` points at the
currently running executable (``sys.executable`` in a frozen build) so a user
who launched the app once from Downloads gets a reusable Desktop entry. Any
failure is swallowed and reported via the return value — a missing shortcut must
never stop the app from running.

Per platform:

* **Windows** — a ``Money Tracker.lnk`` on the Desktop, created with the
  ``WScript.Shell`` COM object via a short PowerShell snippet (no pywin32 dep).
* **Linux** — a ``money-tracker.desktop`` launcher in
  ``~/.local/share/applications`` (and, when present, the XDG Desktop dir).
* **macOS** — the idiomatic install is dragging ``Money Tracker.app`` from the
  DMG into ``/Applications``; there's no separate shortcut to create, so this is
  a no-op that reports success.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

APP_LABEL = "Money Tracker"


def _executable() -> str:
    """Path to launch. In a frozen build this is the app binary/.app; from
    source it's the Python interpreter (shortcut mostly makes sense frozen)."""
    return sys.executable


def _desktop_dir() -> Path:
    """The user's Desktop, honouring XDG on Linux; falls back to ~/Desktop."""
    xdg = os.getenv("XDG_DESKTOP_DIR")
    if xdg:
        return Path(xdg).expanduser()
    return Path.home() / "Desktop"


def _create_windows(target: str) -> bool:
    lnk = _desktop_dir() / f"{APP_LABEL}.lnk"
    # Build the .lnk through the Windows Script Host shell object.
    ps = (
        "$s = (New-Object -ComObject WScript.Shell)."
        f"CreateShortcut('{lnk}');"
        f"$s.TargetPath = '{target}';"
        f"$s.WorkingDirectory = '{Path(target).parent}';"
        "$s.Save()"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        check=True, capture_output=True,
    )
    return lnk.exists()


def _create_linux(target: str, icon: str | None) -> bool:
    entry = (
        "[Desktop Entry]\n"
        "Type=Application\n"
        f"Name={APP_LABEL}\n"
        "Comment=Personal finance tracker\n"
        f"Exec=\"{target}\"\n"
        f"Icon={icon or 'money-tracker'}\n"
        "Terminal=false\n"
        "Categories=Office;Finance;\n"
    )
    apps = Path.home() / ".local" / "share" / "applications"
    apps.mkdir(parents=True, exist_ok=True)
    made = False
    for d in (apps, _desktop_dir()):
        if not d.exists():
            continue
        f = d / "money-tracker.desktop"
        f.write_text(entry, encoding="utf-8")
        os.chmod(f, 0o755)  # Desktop copy must be executable to be trusted
        made = True
    return made


def create_desktop_shortcut(icon: str | None = None) -> bool:
    """Create a Desktop/menu shortcut for this install. Returns True on success
    (or when nothing is needed, e.g. macOS), False if creation failed."""
    target = _executable()
    try:
        if os.name == "nt":
            return _create_windows(target)
        if sys.platform == "darwin":
            return True  # drag-to-Applications from the DMG is the shortcut
        return _create_linux(target, icon)
    except Exception:
        return False
