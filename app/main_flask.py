import os
import sys
import logging
import time
from logging.handlers import RotatingFileHandler

# Ensure the project root is on sys.path so `app` package is importable
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

from flask import Flask, render_template
from app.routes import api

app = Flask(__name__)
app.register_blueprint(api)

# Cache busting: use app startup timestamp as version
_boot_ts = int(time.time())

@app.context_processor
def inject_version():
    return dict(v=_boot_ts)

# --- File-based logging ---
_log_file = os.path.join(_project_root, "output", "app.log")
os.makedirs(os.path.dirname(_log_file), exist_ok=True)
_handler = RotatingFileHandler(_log_file, maxBytes=2_000_000, backupCount=3)
_handler.setLevel(logging.DEBUG)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
))
logging.root.addHandler(_handler)
logging.root.setLevel(logging.DEBUG)


@app.route("/healthz")
def healthz():
    """Lightweight health check — Docker pings this to detect frozen workers.
    Always fast, never blocks on init. Proves the process is alive."""
    return "ok", 200


@app.route("/ready")
def ready():
    """Readiness check — verifies lazy init has completed.
    Used by canary deploy to confirm the app can actually serve requests,
    not just that gunicorn booted. Returns 503 until init is done."""
    from app.routes import _initialized
    if not _initialized:
        return "initializing", 503
    return "ready", 200


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print(f"\n  Genre Tagger is running at http://localhost:5001")
    print(f"  Logging to {_log_file}\n")
    app.run(debug=True, port=5001)
