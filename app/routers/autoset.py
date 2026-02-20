"""Auto Set (narrative set builder) routes.

Extracted from sets.py — 4 routes for building narrative-driven DJ sets
via the 5-phase LLM pipeline in app/autoset.py.
"""

import logging
import os
import threading

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import load_config
from app.parser import parse_all_comments
from app.state import AppState, get_state
from app.tree import (
    COLLECTION_TREE_MODELS,
    TREE_PROFILES,
    _COLLECTION_TREE_FILE,
    find_node,
    load_tree,
)
from app.routers.tagging import sse_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["autoset"])


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


def _ensure_parsed(state: AppState) -> pd.DataFrame | None:
    with state.df_lock:
        if state.df.empty:
            return None
        parse_all_comments(state.df)
        return state.df


def _resolve_tree(tree_type: str, state: AppState):
    """Helper: load genre, scene, or collection tree from state or disk."""
    if tree_type == "collection":
        return state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if tree_type == "scene":
        return state.scene_tree or load_tree(file_path=TREE_PROFILES["scene"]["file"])
    return state.tree or load_tree()


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class AutosetBuildBody(BaseModel):
    source_type: str
    source_id: str
    phase_profile_id: str = "classic_arc"
    set_name: str = "Auto Set"
    tree_type: str = "collection"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/autoset/build", status_code=202)
async def autoset_build(body: AutosetBuildBody, state: AppState = Depends(get_state)):
    from app.autoset import build_autoset
    from app.playlist import get_playlist as get_pl

    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    t = state.autoset_thread
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail="Auto Set build already in progress")

    # Resolve track IDs from source
    track_ids = []
    set_name = body.set_name
    if body.source_type == "playlist":
        pl = get_pl(body.source_id)
        if not pl:
            raise HTTPException(status_code=404, detail=f"Playlist '{body.source_id}' not found")
        track_ids = pl.get("track_ids", [])
        if not set_name or set_name == "Auto Set":
            set_name = f"Auto Set — {pl.get('name', body.source_id)}"
    elif body.source_type == "tree_node":
        tree = _resolve_tree(body.tree_type, state)
        if not tree:
            raise HTTPException(status_code=404, detail=f"{body.tree_type} tree not found")
        node = find_node(tree, body.source_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node '{body.source_id}' not found")
        track_ids = node.get("track_ids", [])
        if not set_name or set_name == "Auto Set":
            set_name = f"Auto Set — {node.get('title', body.source_id)}"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown source_type: {body.source_type}")

    if len(track_ids) < 10:
        raise HTTPException(status_code=400, detail=f"Need at least 10 tracks, got {len(track_ids)}")

    # Gather available trees
    trees = {}
    genre_tree = state.tree or load_tree()
    if genre_tree:
        trees["genre"] = genre_tree
    scene_tree = state.scene_tree or load_tree(file_path=TREE_PROFILES["scene"]["file"])
    if scene_tree:
        trees["scene"] = scene_tree
    collection_tree = state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if collection_tree:
        trees["collection"] = collection_tree

    config = load_config()
    model_config = {
        "creative": config.get("creative_model", COLLECTION_TREE_MODELS["creative"]),
        "mechanical": config.get("mechanical_model", COLLECTION_TREE_MODELS["mechanical"]),
    }
    client = _get_client("anthropic")
    listeners = state.autoset_listeners

    state.autoset_stop_flag.clear()
    state.autoset_result = None

    def progress_callback(phase, detail, pct):
        listeners.broadcast({
            "event": "progress", "phase": phase,
            "detail": detail, "percent": pct,
        })

    def worker():
        try:
            result = build_autoset(
                df=df, track_ids=track_ids,
                phase_profile_id=body.phase_profile_id,
                client=client, model_config=model_config,
                set_name=set_name, trees=trees,
                progress_cb=progress_callback,
                stop_flag=state.autoset_stop_flag,
            )
            state.autoset_result = result
            if result.get("stopped"):
                listeners.broadcast({"event": "stopped", "phase": "stopped", "percent": 0})
            else:
                listeners.broadcast({
                    "event": "done", "phase": "complete", "percent": 100,
                    "set_id": result.get("set", {}).get("id"),
                })
        except Exception as e:
            logger.exception("Auto Set build failed")
            listeners.broadcast({
                "event": "error", "phase": "error",
                "detail": str(e), "percent": 0,
            })

    thread = threading.Thread(target=worker, daemon=True)
    state.autoset_thread = thread
    thread.start()
    return {"started": True, "track_count": len(track_ids)}


@router.get("/autoset/progress")
async def autoset_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.autoset_listeners),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/autoset/stop")
async def autoset_stop(state: AppState = Depends(get_state)):
    state.autoset_stop_flag.set()
    return {"stopped": True}


@router.get("/autoset/result")
async def autoset_result(state: AppState = Depends(get_state)):
    result = state.autoset_result
    if not result:
        raise HTTPException(status_code=404, detail="No result available")
    return {
        "narrative": result.get("narrative", ""),
        "acts": result.get("acts", []),
        "ordered_tracks": result.get("ordered_tracks", []),
        "set": {
            "id": result.get("set", {}).get("id"),
            "name": result.get("set", {}).get("name"),
            "slot_count": len(result.get("set", {}).get("slots", [])),
        },
        "pool_profile": {
            "track_count": result.get("pool_profile", {}).get("track_count", 0),
            "bpm": result.get("pool_profile", {}).get("bpm", {}),
        },
    }
