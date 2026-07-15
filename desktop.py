"""Desktop launcher — the PyInstaller entry point for the frozen app.

Double-clicking the packaged app runs this. Unlike ``run_app.py`` (the simple
dev server), it makes the app self-contained for non-technical users:

1. pick a per-user writable data folder and ``chdir`` into it, so all the
   app's CWD-relative paths (``./config``, ``./data``) land somewhere the
   read-only bundle can be written *around*;
2. seed ``config/`` + ``data/`` from the ``config.example`` bundled inside the
   executable (first run only);
3. serve the Dash app on ``127.0.0.1`` in a background thread;
4. open the user's browser at the app;
5. create a Desktop shortcut the first time;
6. sit in the system tray / menu bar with *Open Money Tracker* / *Quit*.

Closing the browser tab leaves the server running in the tray; *Quit* stops it.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

# When frozen, PyInstaller sets sys.path to the extraction dir; from source add
# the project root so `from src...` resolves (mirrors run_app.py).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.utils.paths import app_data_dir, resource_path  # noqa: E402

HOST = os.getenv("MT_HOST", "127.0.0.1")
FIRST_RUN_MARKER = ".shortcut_created"


def _choose_port() -> int:
    """Preferred port from MT_PORT (default 8050), or a free one if it's taken."""
    preferred = int(os.getenv("MT_PORT", "8050"))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def _wait_until_serving(port: int, timeout: float = 20.0) -> bool:
    """Block until the server accepts connections (or timeout)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((HOST, port)) == 0:
                return True
        time.sleep(0.2)
    return False


def _maybe_create_shortcut(root: Path) -> None:
    """Create a Desktop shortcut once; a marker file makes it idempotent."""
    marker = root / FIRST_RUN_MARKER
    if marker.exists():
        return
    try:
        from src.utils.shortcut import create_desktop_shortcut
        icon = resource_path("packaging/icon.png")
        create_desktop_shortcut(icon=str(icon) if icon.exists() else None)
    except Exception:
        pass
    finally:
        marker.touch()  # never retry, even if creation failed


def main() -> int:
    # 1) writable working dir + 2) seed config/data from the bundled template.
    root = app_data_dir()
    os.chdir(root)

    from src.utils.bootstrap import bootstrap
    bootstrap(root, template=resource_path("config.example"))

    # 3) build the app *after* chdir/bootstrap (it reads config on import).
    from src.app.app import server
    port = _choose_port()
    url = f"http://{HOST}:{port}"

    from werkzeug.serving import make_server
    httpd = make_server(HOST, port, server, threaded=True)
    t = threading.Thread(target=httpd.serve_forever, name="mt-server", daemon=True)
    t.start()

    # 4) open the browser once the server answers; 5) first-run shortcut.
    if _wait_until_serving(port):
        webbrowser.open(url)
    _maybe_create_shortcut(root)

    print(f"Money Tracker is running at {url}")

    # 6) system-tray icon; falls back to a blocking wait when tray is
    # unavailable (headless Linux, or pystray/Pillow missing).
    _run_tray(url, httpd) or _run_blocking(httpd)
    return 0


def _run_tray(url: str, httpd) -> bool:
    """Show a tray icon with Open / Quit. Returns False if tray isn't usable."""
    try:
        import pystray
        from PIL import Image
    except Exception:
        return False

    icon_path = resource_path("packaging/icon.png")
    try:
        image = Image.open(icon_path) if icon_path.exists() else _fallback_image()
    except Exception:
        image = _fallback_image()

    def _open(icon, item):
        webbrowser.open(url)

    def _quit(icon, item):
        httpd.shutdown()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Open Money Tracker", _open, default=True),
        pystray.MenuItem("Quit", _quit),
    )
    try:
        pystray.Icon("money-tracker", image, "Money Tracker", menu).run()
        return True
    except Exception:
        return False


def _fallback_image():
    """A tiny solid icon so the tray still shows something without an asset."""
    from PIL import Image
    return Image.new("RGBA", (64, 64), (26, 188, 156, 255))


def _run_blocking(httpd) -> None:
    """No tray: keep serving until Ctrl-C / termination."""
    print("System tray not available — press Ctrl+C to quit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
