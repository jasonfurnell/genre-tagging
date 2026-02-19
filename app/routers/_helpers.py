"""Shared helper functions used across multiple routers."""

import json
import logging
import os

import pandas as pd

from app.state import AppState

logger = logging.getLogger(__name__)

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_DIR = os.path.join(_project_root, "output")

# V2 session-specific state (autosave CSVs, upload metadata) goes to a
# separate directory so V2 testing never clobbers V1's state files.
V2_OUTPUT_DIR = os.path.join(_project_root, "output_v2")
LAST_UPLOAD_META = os.path.join(V2_OUTPUT_DIR, ".last_upload.json")


def autosave(state: AppState) -> None:
    """Write the current DataFrame to output_v2/<original>_autosave.csv."""
    try:
        with state.df_lock:
            df = state.df
            if df.empty:
                return
            original = state.original_filename or "playlist.csv"
        os.makedirs(V2_OUTPUT_DIR, exist_ok=True)
        name = original.rsplit(".", 1)[0] + "_autosave.csv"
        df.to_csv(os.path.join(V2_OUTPUT_DIR, name), index=False)
    except Exception:
        pass


def save_last_upload_meta(state: AppState) -> None:
    """Remember which file was last uploaded so we can restore on refresh."""
    try:
        original = state.original_filename
        if not original:
            return
        os.makedirs(V2_OUTPUT_DIR, exist_ok=True)
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
