"""Tagging routes — bulk tag, SSE progress, stop, re-tag, edit, clear, export.

Migrated from Flask routes.py — the core LLM tagging workflow.
"""

import asyncio
import io
import json
import logging
import os
import queue
import subprocess
import threading
import time

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import load_config
from app.models.common import TagSingleResponse, TrackUpdate
from app.routers._helpers import autosave
from app.state import AppState, get_state
from app.tagger import generate_genre_comment

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tagging"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _provider_for_model(model: str) -> str:
    return "anthropic" if model.startswith("claude") else "openai"


def _get_client(provider: str):
    if provider == "anthropic":
        from anthropic import Anthropic
        return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    from openai import OpenAI
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _track_status(row) -> str:
    comment = row.get("comment", "")
    if pd.isna(comment) or str(comment).strip() == "":
        return "untagged"
    return "tagged"


def _safe_val(v):
    """Convert numpy types to Python native for JSON serialization."""
    if pd.isna(v):
        return ""
    if hasattr(v, "item"):
        return v.item()
    return v


def _tracks_json(state: AppState) -> list[dict]:
    """Convert DataFrame to JSON-safe list of track dicts with status."""
    with state.df_lock:
        df = state.df
        if df.empty:
            return []
        tracks = []
        for idx, row in df.iterrows():
            track = {"id": int(idx)}
            for col in df.columns:
                track[col] = _safe_val(row[col])
            track["status"] = _track_status(row)
            tracks.append(track)
    return tracks


# ---------------------------------------------------------------------------
# Caffeinate (macOS sleep prevention)
# ---------------------------------------------------------------------------

_caffeinate_proc = None


def _caffeinate_start():
    global _caffeinate_proc
    _caffeinate_stop()
    try:
        _caffeinate_proc = subprocess.Popen(["caffeinate", "-i"])
    except Exception:
        pass


def _caffeinate_stop():
    global _caffeinate_proc
    if _caffeinate_proc is not None:
        _caffeinate_proc.terminate()
        _caffeinate_proc = None


# ---------------------------------------------------------------------------
# Background tagging thread
# ---------------------------------------------------------------------------


def _tagging_worker(state: AppState) -> None:
    _caffeinate_start()
    try:
        _tagging_loop(state)
    finally:
        _caffeinate_stop()


def _tagging_loop(state: AppState) -> None:
    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    with state.df_lock:
        df = state.df
        untagged = [
            (i, r) for i, r in df.iterrows()
            if pd.isna(r.get("comment", "")) or str(r.get("comment", "")).strip() == ""
        ]

    total_untagged = len(untagged)
    for count, (idx, row) in enumerate(untagged, 1):
        if state.stop_flag.is_set():
            autosave(state)
            state.tagging_listeners.broadcast({"event": "stopped"})
            return

        try:
            comment, detected_year = generate_genre_comment(
                client=client,
                title=row["title"],
                artist=row["artist"],
                system_prompt=config["system_prompt"],
                user_prompt_template=config["user_prompt_template"],
                bpm=str(row.get("bpm", "")),
                key=str(row.get("key", "")),
                year=str(row.get("year", "")),
                model=model,
                provider=provider,
            )
            with state.df_lock:
                state.df.at[idx, "comment"] = comment
                if detected_year:
                    state.df.at[idx, "year"] = int(detected_year)
            autosave(state)
            status = "tagged"
        except Exception:
            comment = ""
            logger.exception("Tagging failed for track %s – %s", row["title"], row["artist"])
            status = "error"

        state.tagging_listeners.broadcast({
            "event": "progress",
            "id": int(idx),
            "title": row["title"],
            "artist": row["artist"],
            "comment": comment if status == "tagged" else "",
            "year": _safe_val(state.df.at[idx, "year"]) if status == "tagged" else "",
            "status": status,
            "progress": f"{count}/{total_untagged}",
        })

        if count < total_untagged and not state.stop_flag.is_set():
            time.sleep(delay)

    autosave(state)
    state.tagging_listeners.broadcast({"event": "done"})


# ---------------------------------------------------------------------------
# SSE stream helper (reusable pattern for other routers)
# ---------------------------------------------------------------------------


async def sse_stream(listeners, terminal_events=("done", "stopped")):
    """Async generator that bridges ListenerList queues to SSE format."""
    q = listeners.add(maxsize=100)
    try:
        while True:
            try:
                data = await asyncio.to_thread(q.get, True, 30)
            except queue.Empty:
                yield ":\n\n"  # keepalive
                continue
            yield f"data: {json.dumps(data)}\n\n"
            if data.get("event") in terminal_events:
                break
    finally:
        listeners.remove(q)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/tracks")
async def tracks(state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            return []
    return _tracks_json(state)


@router.post("/tag")
async def tag_all(state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")

    state.stop_flag.clear()
    t = threading.Thread(target=_tagging_worker, args=(state,), daemon=True)
    state.tagging_thread = t
    t.start()
    return {"started": True}


@router.get("/tag/progress")
async def tag_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.tagging_listeners),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/tag/stop")
async def tag_stop(state: AppState = Depends(get_state)):
    state.stop_flag.set()
    return {"stopped": True}


@router.post("/tag/{track_id}", response_model=TagSingleResponse)
async def tag_single(track_id: int, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty or track_id not in state.df.index:
            raise HTTPException(status_code=404, detail="Track not found")
        row = state.df.loc[track_id]

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    try:
        comment, detected_year = generate_genre_comment(
            client=client,
            title=row["title"],
            artist=row["artist"],
            system_prompt=config["system_prompt"],
            user_prompt_template=config["user_prompt_template"],
            bpm=str(row.get("bpm", "")),
            key=str(row.get("key", "")),
            year=str(row.get("year", "")),
            model=model,
            provider=provider,
        )
        with state.df_lock:
            state.df.at[track_id, "comment"] = comment
            result = {"id": track_id, "comment": comment}
            if detected_year:
                state.df.at[track_id, "year"] = int(detected_year)
                result["year"] = int(detected_year)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/track/{track_id}")
async def update_track(track_id: int, body: TrackUpdate, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty or track_id not in state.df.index:
            raise HTTPException(status_code=404, detail="Track not found")
        state.df.at[track_id, "comment"] = body.comment
    return {"id": track_id, "comment": body.comment}


@router.post("/track/{track_id}/clear")
async def clear_track(track_id: int, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty or track_id not in state.df.index:
            raise HTTPException(status_code=404, detail="Track not found")
        state.df.at[track_id, "comment"] = ""
    return {"id": track_id, "comment": ""}


@router.post("/tracks/clear-all")
async def clear_all(state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        state.df["comment"] = ""
    return {"cleared": True}


@router.get("/export")
async def export(state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        buf = io.BytesIO()
        state.df.to_csv(buf, index=False)
        buf.seek(0)
        original = state.original_filename or "playlist.csv"

    name = original.rsplit(".", 1)[0] + "_tagged.csv"
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
