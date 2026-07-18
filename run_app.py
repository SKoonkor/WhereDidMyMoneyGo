"""Entry point for the interactive Money Tracker web app.

Run from the project root:

    python3 run_app.py

The server — every calculation, your data files, and all market lookups — runs on
this computer; a browser (on this computer OR your phone) is just a remote screen.
On start-up both URLs are printed, e.g.::

    On this computer:  http://127.0.0.1:8050
    On your phone:     http://192.168.1.42:8050   (same WiFi)

Open the phone URL in your phone's browser (it must be on the same WiFi).
Notes:
  * macOS may ask "Do you want the application 'Python' to accept incoming network
    connections?" — click Allow (or System Settings → Network → Firewall → allow
    Python). Without this the phone can't connect.
  * The network must not have client/AP isolation enabled (common on guest
    networks — it blocks device-to-device traffic).

By default the app is reachable by other devices on your WiFi (no password). To keep
it private to this computer only, set ``MT_HOST=127.0.0.1``.

Environment variables:
    MT_HOST   host/interface to bind (default 0.0.0.0 = reachable on the LAN; set
              to 127.0.0.1 to restrict to this computer only)
    MT_PORT   port to serve on (default 8050)
    MT_DEBUG  set to 1/true/yes to enable Dash debug mode (default off)
"""

import os
import socket
import sys
from pathlib import Path

# Allow `from src...` imports when run from the project root.
sys.path.insert(0, str(Path(__file__).parent))

# First-run bootstrap: create data dirs and seed config/ from templates if
# missing. Must run before importing the app (which reads config on import).
from src.utils.bootstrap import bootstrap  # noqa: E402

bootstrap()

from src.app.app import app  # noqa: E402


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def _lan_ip() -> str | None:
    """This machine's primary LAN IPv4, or None if it can't be determined.

    A UDP ``connect`` just selects the outbound interface — no packets are sent —
    so ``getsockname()`` reveals the address other devices on the WiFi would use."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return None


def _print_banner(host: str, port: int) -> None:
    """Tell the user where to open the app — including the phone URL whenever the
    server is reachable off localhost (the default)."""
    lan_exposed = host not in ("127.0.0.1", "localhost")
    print("\nMoney Tracker is running.")
    print(f"  On this computer:  http://127.0.0.1:{port}")
    if lan_exposed:
        ip = _lan_ip()
        if ip:
            print(f"  On your phone:     http://{ip}:{port}   (same WiFi)")
        else:
            print("  On your phone:     http://<this-computer's-IP>:"
                  f"{port}   (same WiFi)")
    else:
        print("  (private to this computer — unset MT_HOST to open it on your phone)")
    print("Press Ctrl+C to stop.\n")


if __name__ == "__main__":
    debug = _truthy("MT_DEBUG")
    # Default to serving on the LAN so a phone on the same WiFi can connect with no
    # extra flag; set MT_HOST=127.0.0.1 to keep it private to this computer.
    host = os.getenv("MT_HOST") or "0.0.0.0"
    port = int(os.getenv("MT_PORT", "8050"))
    _print_banner(host, port)
    # threaded=True lets the phone and this computer be served at once without a
    # slow market lookup blocking the other (writes are guarded by the paper
    # engine's process-wide lock).
    app.run(debug=debug, host=host, port=port, threaded=True)
