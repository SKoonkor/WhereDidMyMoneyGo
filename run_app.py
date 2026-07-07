"""Entry point for the interactive Money Tracker web app.

Run from the project root:

    python run_app.py

Then open http://127.0.0.1:8050 in your browser.

Environment variables:
    MT_PORT   port to serve on (default 8050)
    MT_HOST   host/interface to bind (default 127.0.0.1, localhost only)
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

if __name__ == "__main__":
    debug = os.getenv("MT_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    host = os.getenv("MT_HOST", "127.0.0.1")
    port = int(os.getenv("MT_PORT", "8050"))
    app.run(debug=debug, host=host, port=port)
