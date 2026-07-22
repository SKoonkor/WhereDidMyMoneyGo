"""Entry point for the interactive Where Did My Money Go? web app.

Run from the project root:

    python3 run_app.py

Everything — every calculation, your data files, and all market lookups — runs on
this computer, and the app is served to this computer only. On start-up the URL is
printed; open it in your browser::

    http://127.0.0.1:8050

Environment variables:
    MT_HOST   host/interface to bind (default 127.0.0.1 = this computer only)
    MT_PORT   port to serve on (default 8050)
    MT_DEBUG  set to 1/true/yes to enable Dash debug mode (default off)
"""

import os
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


def _print_banner(port: int) -> None:
    """Tell the user where to open the app."""
    print("\nWhere Did My Money Go? is running.")
    print(f"  Open in your browser:  http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.\n")


if __name__ == "__main__":
    debug = _truthy("MT_DEBUG")
    # Serve to this computer only. MT_HOST stays overridable for anyone who
    # deliberately wants LAN exposure, but it is not the default.
    host = os.getenv("MT_HOST") or "127.0.0.1"
    port = int(os.getenv("MT_PORT", "8050"))
    _print_banner(port)
    # threaded=True keeps a slow market lookup from blocking other requests
    # (writes are guarded by the paper engine's process-wide lock).
    app.run(debug=debug, host=host, port=port, threaded=True)
