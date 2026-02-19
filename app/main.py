"""FastAPI application entry point.

Run with: uv run uvicorn app.main:app --port 5001 --reload
"""

import os
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.state import get_state, reset_state
from app.tasks import BackgroundTaskManager

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_project_root, ".env"))
_app_dir = os.path.dirname(os.path.abspath(__file__))
_frontend_dist = os.path.join(_project_root, "frontend", "dist")


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_log_file = os.path.join(_project_root, "output", "app.log")
os.makedirs(os.path.dirname(_log_file), exist_ok=True)
_handler = RotatingFileHandler(_log_file, maxBytes=2_000_000, backupCount=3)
_handler.setLevel(logging.DEBUG)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
))
logging.root.addHandler(_handler)
logging.root.setLevel(logging.DEBUG)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown hooks
# ---------------------------------------------------------------------------
_task_manager = BackgroundTaskManager()


def get_task_manager() -> BackgroundTaskManager:
    """FastAPI dependency for the background task manager."""
    return _task_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = get_state()
    # Ensure V2 session-state directory exists
    from app.routers._helpers import V2_OUTPUT_DIR
    os.makedirs(V2_OUTPUT_DIR, exist_ok=True)
    # Restore persisted Dropbox tokens on startup
    from app.routers.dropbox import load_dropbox_tokens
    await load_dropbox_tokens(state)
    # Load persistent artwork cache
    from app.routers.artwork import init_artwork_cache
    init_artwork_cache(state)
    logger.info("FastAPI starting up — AppState initialized")
    yield
    logger.info("FastAPI shutting down — cancelling background tasks")
    await _task_manager.shutdown()
    reset_state()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Genre Tagger",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# CORS — allows Vite dev server (React migration) to proxy to this backend
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from app.routers import (  # noqa: E402
    artwork, config_routes, dropbox, playlists, sets, tagging, trees, upload,
)

app.include_router(artwork.router)
app.include_router(config_routes.router)
app.include_router(dropbox.router)
app.include_router(playlists.router)
app.include_router(sets.router)
app.include_router(tagging.router)
app.include_router(trees.router)
app.include_router(upload.router)


# ---------------------------------------------------------------------------
# Serve React frontend from frontend/dist/ (Vite build output)
# ---------------------------------------------------------------------------
_spa_index = os.path.join(_frontend_dist, "index.html")

if os.path.isdir(os.path.join(_frontend_dist, "assets")):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_frontend_dist, "assets")),
        name="frontend-assets",
    )


@app.get("/", response_class=HTMLResponse)
async def index():
    if not os.path.isfile(_spa_index):
        return HTMLResponse(
            "<h1>Frontend not built</h1>"
            "<p>Run <code>cd frontend && npm run build</code> to build the React app, "
            "or use the Vite dev server at <a href='http://localhost:5173'>localhost:5173</a>.</p>",
            status_code=200,
        )
    return FileResponse(_spa_index)


# ---------------------------------------------------------------------------
# CLI runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    print(f"\n  Genre Tagger (FastAPI) is running at http://localhost:5001")
    print(f"  Logging to {_log_file}\n")
    uvicorn.run("app.main:app", host="127.0.0.1", port=5001, reload=True)
