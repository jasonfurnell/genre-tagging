"""Upload and restore routes.

Migrated from Flask routes.py — CSV upload + auto-restore on page refresh.
"""

import json
import logging
import os

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.models.common import UploadSummary
from app.routers._helpers import (
    LAST_UPLOAD_META,
    OUTPUT_DIR,
    autosave,
    save_last_upload_meta,
    summary,
)
from app.state import AppState, get_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])


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

    autosave(state)
    save_last_upload_meta(state)

    return summary(state)


@router.get("/restore", response_model=UploadSummary)
async def restore(state: AppState = Depends(get_state)):
    # Already loaded in memory — just return summary
    with state.df_lock:
        has_data = not state.df.empty

    if has_data:
        result = summary(state)
        result["restored"] = True
        return result

    # Try to load from autosave on disk
    try:
        with open(LAST_UPLOAD_META) as f:
            meta = json.load(f)
        original = meta.get("original_filename", "")
        autosave_name = original.rsplit(".", 1)[0] + "_autosave.csv"
        path = os.path.join(OUTPUT_DIR, autosave_name)
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

        result = summary(state)
        result["restored"] = True
        result["filename"] = original
        return result
    except Exception:
        return UploadSummary(restored=False)
