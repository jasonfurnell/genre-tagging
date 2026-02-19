"""Shared helper functions used across multiple routers."""

import json
import logging
import os

import pandas as pd

from app.state import AppState

logger = logging.getLogger(__name__)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "output")
LAST_UPLOAD_META = os.path.join(OUTPUT_DIR, ".last_upload.json")


def autosave(state: AppState) -> None:
    """Write the current DataFrame to output/<original>_autosave.csv."""
    try:
        with state.df_lock:
            df = state.df
            if df.empty:
                return
            original = state.original_filename or "playlist.csv"
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        name = original.rsplit(".", 1)[0] + "_autosave.csv"
        df.to_csv(os.path.join(OUTPUT_DIR, name), index=False)
    except Exception:
        pass


def save_last_upload_meta(state: AppState) -> None:
    """Remember which file was last uploaded so we can restore on refresh."""
    try:
        original = state.original_filename
        if not original:
            return
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(LAST_UPLOAD_META, "w") as f:
            json.dump({"original_filename": original}, f)
    except Exception:
        pass


def summary(state: AppState) -> dict:
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
