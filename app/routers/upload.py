"""Upload and restore routes.

Migrated from Flask routes.py — CSV upload + auto-restore on page refresh.
"""

import json
import logging
import os

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.models.common import UploadSummary
from app.state import AppState, get_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])

_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "output")
_LAST_UPLOAD_META = os.path.join(_OUTPUT_DIR, ".last_upload.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _summary(state: AppState) -> dict:
    """Build an upload summary from the current DataFrame."""
    with state.df_lock:
        df = state.df
        if df.empty:
            return {"total": 0, "tagged": 0, "untagged": 0, "columns": []}
        total = len(df)
        tagged = sum(
            1 for _, r in df.iterrows()
            if pd.notna(r.get("comment", "")) and str(r.get("comment", "")).strip()
        )
    return {
        "total": total,
        "tagged": tagged,
        "untagged": total - tagged,
        "columns": list(df.columns),
    }


def _autosave(state: AppState) -> None:
    """Write the current DataFrame to output/<original>_autosave.csv."""
    try:
        with state.df_lock:
            df = state.df
            if df.empty:
                return
            original = state.original_filename or "playlist.csv"
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        name = original.rsplit(".", 1)[0] + "_autosave.csv"
        df.to_csv(os.path.join(_OUTPUT_DIR, name), index=False)
    except Exception:
        pass


def _save_last_upload_meta(state: AppState) -> None:
    """Remember which file was last uploaded so we can restore on refresh."""
    try:
        original = state.original_filename
        if not original:
            return
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        with open(_LAST_UPLOAD_META, "w") as f:
            json.dump({"original_filename": original}, f)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=UploadSummary)
async def upload(file: UploadFile, state: AppState = Depends(get_state)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    contents = await file.read()
    try:
        import io
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    missing = [c for c in ("title", "artist") if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(missing)}",
        )

    if "comment" not in df.columns:
        df["comment"] = ""

    # Stop any running tagging
    state.stop_flag.set()

    with state.df_lock:
        state.df = df
        state.original_filename = file.filename

    state.invalidate_caches()
    with state.artwork_cache_lock:
        state.artwork_cache.clear()

    _autosave(state)
    _save_last_upload_meta(state)

    result = _summary(state)
    return result


@router.get("/restore", response_model=UploadSummary)
async def restore(state: AppState = Depends(get_state)):
    # Already loaded in memory — just return summary
    with state.df_lock:
        has_data = not state.df.empty

    if has_data:
        result = _summary(state)
        result["restored"] = True
        return result

    # Try to load from autosave on disk
    try:
        with open(_LAST_UPLOAD_META) as f:
            meta = json.load(f)
        original = meta.get("original_filename", "")
        autosave = original.rsplit(".", 1)[0] + "_autosave.csv"
        path = os.path.join(_OUTPUT_DIR, autosave)
        if not os.path.exists(path):
            return UploadSummary(restored=False)

        df = pd.read_csv(path)
        missing = [c for c in ("title", "artist") if c not in df.columns]
        if missing:
            return UploadSummary(restored=False)

        if "comment" not in df.columns:
            df["comment"] = ""

        with state.df_lock:
            state.df = df
            state.original_filename = original

        state.invalidate_caches()
        with state.artwork_cache_lock:
            state.artwork_cache.clear()

        result = _summary(state)
        result["restored"] = True
        result["filename"] = original
        return result
    except Exception:
        return UploadSummary(restored=False)
