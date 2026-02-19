"""Tree routes — genre, scene, and collection tree building.

Migrated from Flask routes.py — 31 routes for 3 tree types.
Uses shared helpers to reduce duplication across genre/scene/collection.
"""

import io
import json
import logging
import os
import threading

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import load_config
from app.parser import parse_all_comments
from app.playlist import create_playlist, rerank_tracks
from app.state import AppState, ListenerList, get_state
from app.tree import (
    COLLECTION_TREE_MODELS,
    TREE_PROFILES,
    _COLLECTION_CHECKPOINT_FILE,
    _COLLECTION_TREE_FILE,
    _clear_checkpoint,
    build_collection_tree,
    build_curated_collection,
    delete_tree as delete_tree_file,
    expand_tree_from_ungrouped,
    find_node,
    load_tree,
    refresh_all_examples,
    save_tree,
)
from app.routers.tagging import sse_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["trees"])


# ---------------------------------------------------------------------------
# Helpers (shared across genre/scene/collection)
# ---------------------------------------------------------------------------


def _provider_for_model(model: str) -> str:
    return "anthropic" if model.startswith("claude") else "openai"


def _get_client(provider: str):
    if provider == "anthropic":
        from anthropic import Anthropic
        return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    from openai import OpenAI
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _safe_val(val):
    """Convert numpy/pandas types to JSON-safe Python types."""
    if pd.isna(val):
        return ""
    if hasattr(val, "item"):
        return val.item()
    return val


def _ensure_parsed(state: AppState) -> pd.DataFrame | None:
    """Ensure facet columns exist on the DataFrame. Returns df or None."""
    with state.df_lock:
        if state.df.empty:
            return None
        parse_all_comments(state.df)
        return state.df


def _tracks_from_ids(df: pd.DataFrame, ids: list) -> list[dict]:
    """Build a JSON-safe list of track dicts from row indices."""
    result = []
    for idx in ids:
        if idx not in df.index:
            continue
        row = df.loc[idx]
        track = {"id": int(idx)}
        for col in df.columns:
            if not col.startswith("_"):
                track[col] = _safe_val(row[col])
        result.append(track)
    return result


def _collect_tree_leaves(node: dict, result: list) -> None:
    """Recursively collect leaf nodes from a tree node."""
    if node.get("is_leaf") or not node.get("children"):
        result.append(node)
    else:
        for child in node["children"]:
            _collect_tree_leaves(child, result)


class _TreeConfig:
    """Configuration for a tree type (genre/scene) to reduce route duplication."""

    def __init__(
        self,
        prefix: str,
        state_key: str,
        thread_key: str,
        stop_flag_key: str,
        listeners_key: str,
        file_path: str | None = None,
        tree_type: str | None = None,
        playlist_source: str = "tree",
    ):
        self.prefix = prefix
        self.state_key = state_key
        self.thread_key = thread_key
        self.stop_flag_key = stop_flag_key
        self.listeners_key = listeners_key
        self.file_path = file_path
        self.tree_type = tree_type
        self.playlist_source = playlist_source

    def get_tree(self, state: AppState) -> dict | None:
        tree = getattr(state, self.state_key)
        if tree is None:
            kwargs = {"file_path": self.file_path} if self.file_path else {}
            tree = load_tree(**kwargs)
            if tree:
                setattr(state, self.state_key, tree)
        return tree

    def get_thread(self, state: AppState) -> threading.Thread | None:
        return getattr(state, self.thread_key)

    def set_thread(self, state: AppState, thread: threading.Thread) -> None:
        setattr(state, self.thread_key, thread)

    def get_stop_flag(self, state: AppState) -> threading.Event:
        return getattr(state, self.stop_flag_key)

    def get_listeners(self, state: AppState) -> ListenerList:
        return getattr(state, self.listeners_key)

    def set_tree(self, state: AppState, tree: dict | None) -> None:
        setattr(state, self.state_key, tree)


_GENRE = _TreeConfig(
    prefix="tree",
    state_key="tree",
    thread_key="tree_thread",
    stop_flag_key="tree_stop_flag",
    listeners_key="tree_listeners",
    file_path=None,
    tree_type=None,
    playlist_source="tree",
)

_SCENE = _TreeConfig(
    prefix="scene-tree",
    state_key="scene_tree",
    thread_key="scene_tree_thread",
    stop_flag_key="scene_tree_stop_flag",
    listeners_key="scene_tree_listeners",
    file_path=TREE_PROFILES["scene"]["file"],
    tree_type="scene",
    playlist_source="scene-tree",
)


# ---------------------------------------------------------------------------
# Shared route implementations for genre/scene trees
# ---------------------------------------------------------------------------


def _get_tree_handler(tc: _TreeConfig, state: AppState):
    tree = tc.get_tree(state)
    if tree is None:
        return {"tree": None}
    return {"tree": tree}


def _build_tree_handler(tc: _TreeConfig, state: AppState):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    t = tc.get_thread(state)
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail=f"{tc.prefix} build already in progress")

    stop_flag = tc.get_stop_flag(state)
    stop_flag.clear()
    tc.set_tree(state, None)

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)
    listeners = tc.get_listeners(state)

    def progress_callback(phase, detail, pct):
        listeners.broadcast({
            "event": "progress", "phase": phase,
            "detail": detail, "percent": pct,
        })

    def worker():
        try:
            kwargs = {"tree_type": tc.tree_type} if tc.tree_type else {}
            tree = build_collection_tree(
                df=df, client=client, model=model, provider=provider,
                delay=delay, progress_cb=progress_callback,
                stop_flag=stop_flag, **kwargs,
            )
            tc.set_tree(state, tree)
            listeners.broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logger.exception("%s build failed", tc.prefix)
            listeners.broadcast({"event": "error", "phase": "error",
                                 "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    tc.set_thread(state, thread)
    thread.start()
    return {"started": True}


def _stop_tree_handler(tc: _TreeConfig, state: AppState):
    tc.get_stop_flag(state).set()
    return {"stopped": True}


def _expand_ungrouped_handler(tc: _TreeConfig, state: AppState):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    ungrouped = tree.get("ungrouped_track_ids", [])
    if not ungrouped:
        raise HTTPException(status_code=400, detail="No ungrouped tracks to process")

    t = tc.get_thread(state)
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail=f"{tc.prefix} operation already in progress")

    stop_flag = tc.get_stop_flag(state)
    stop_flag.clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)
    listeners = tc.get_listeners(state)

    def progress_callback(phase, detail, pct):
        listeners.broadcast({
            "event": "progress", "phase": phase,
            "detail": detail, "percent": pct,
        })

    def worker():
        try:
            kwargs = {"tree_type": tc.tree_type} if tc.tree_type else {}
            updated_tree = expand_tree_from_ungrouped(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=stop_flag, **kwargs,
            )
            tc.set_tree(state, updated_tree)
            listeners.broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logger.exception("%s expand ungrouped failed", tc.prefix)
            listeners.broadcast({"event": "error", "phase": "error",
                                 "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    tc.set_thread(state, thread)
    thread.start()
    return {"started": True, "ungrouped_count": len(ungrouped)}


def _refresh_examples_handler(tc: _TreeConfig, state: AppState):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    t = tc.get_thread(state)
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail=f"{tc.prefix} operation already in progress")

    stop_flag = tc.get_stop_flag(state)
    stop_flag.clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)
    listeners = tc.get_listeners(state)

    def progress_callback(phase, detail, pct):
        listeners.broadcast({
            "event": "progress", "phase": phase,
            "detail": detail, "percent": pct,
        })

    def worker():
        try:
            kwargs = {"tree_type": tc.tree_type} if tc.tree_type else {}
            updated = refresh_all_examples(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=stop_flag, **kwargs,
            )
            tc.set_tree(state, updated)
            listeners.broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logger.exception("%s refresh examples failed", tc.prefix)
            listeners.broadcast({"event": "error", "phase": "error",
                                 "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    tc.set_thread(state, thread)
    thread.start()
    return {"started": True}


def _ungrouped_handler(tc: _TreeConfig, state: AppState):
    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        ungrouped_ids = tree.get("ungrouped_track_ids", [])
        tracks = _tracks_from_ids(state.df, ungrouped_ids)
    return {"count": len(tracks), "tracks": tracks}


def _create_playlist_handler(tc: _TreeConfig, node_id: str, state: AppState):
    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    if not node_id:
        raise HTTPException(status_code=400, detail="node_id is required")

    node = find_node(tree, node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    track_ids = node.get("track_ids", [])
    name = node.get("title", "Untitled")
    description = node.get("description", "")
    filters = node.get("filters", {})

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    target_count = min(25, len(track_ids))

    valid_ids = [tid for tid in track_ids if tid in df.index]
    candidates = _tracks_from_ids(df, valid_ids[:80])

    method = "direct"
    final_ids = valid_ids

    if candidates and len(candidates) > 5:
        try:
            result = rerank_tracks(
                candidates, name, description,
                client, model, provider, target_count,
            )
            reranked_ids = [t["id"] for t in result["tracks"]]
            final_ids = [tid for tid in reranked_ids if tid in df.index]
            method = "smart"
        except Exception:
            logger.exception("LLM rerank failed for %s leaf", tc.prefix)
            final_ids = valid_ids[:target_count]
            method = "scored_fallback"

    playlist = create_playlist(name, description, filters, final_ids, tc.playlist_source)
    return {"playlist": playlist, "method": method}


def _create_all_playlists_handler(tc: _TreeConfig, state: AppState):
    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    leaves = []
    for lineage in tree.get("lineages", []):
        _collect_tree_leaves(lineage, leaves)

    created = []
    for leaf in leaves:
        playlist = create_playlist(
            name=leaf.get("title", "Untitled"),
            description=leaf.get("description", ""),
            filters=leaf.get("filters", {}),
            track_ids=leaf.get("track_ids", []),
            source=tc.playlist_source,
        )
        created.append(playlist)

    return {"playlists": created, "count": len(created)}


def _export_m3u_handler(tc: _TreeConfig, node_id: str, state: AppState):
    tree = tc.get_tree(state)
    if not tree:
        raise HTTPException(status_code=404, detail=f"No {tc.prefix} built")

    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        df = state.df

        node = find_node(tree, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

        track_ids = node.get("track_ids", [])
        title = node.get("title", "Untitled")

        lines = ["#EXTM3U", f"#PLAYLIST:{title}"]
        for tid in track_ids:
            if tid not in df.index:
                continue
            row = df.loc[tid]
            artist = str(row.get("artist", "Unknown"))
            track_title = str(row.get("title", "Unknown"))
            location = str(row.get("location", ""))
            lines.append(f"#EXTINF:-1,{artist} - {track_title}")
            if location and location != "nan":
                lines.append(location)

    content = "\n".join(lines) + "\n"
    name = title.replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{name}.m3u8"'},
    )


def _delete_tree_handler(tc: _TreeConfig, state: AppState):
    tc.set_tree(state, None)
    kwargs = {"file_path": tc.file_path} if tc.file_path else {}
    deleted = delete_tree_file(**kwargs)
    return {"deleted": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# Genre Tree routes
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/tree")
async def get_tree(state: AppState = Depends(get_state)):
    return _get_tree_handler(_GENRE, state)


@router.post("/tree/build", status_code=202)
async def tree_build(state: AppState = Depends(get_state)):
    return _build_tree_handler(_GENRE, state)


@router.get("/tree/progress")
async def tree_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.tree_listeners),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/tree/stop")
async def tree_stop(state: AppState = Depends(get_state)):
    return _stop_tree_handler(_GENRE, state)


@router.post("/tree/expand-ungrouped", status_code=202)
async def tree_expand_ungrouped(state: AppState = Depends(get_state)):
    return _expand_ungrouped_handler(_GENRE, state)


@router.post("/tree/refresh-examples", status_code=202)
async def tree_refresh_examples(state: AppState = Depends(get_state)):
    return _refresh_examples_handler(_GENRE, state)


@router.get("/tree/ungrouped")
async def tree_ungrouped(state: AppState = Depends(get_state)):
    return _ungrouped_handler(_GENRE, state)


class CreatePlaylistBody(BaseModel):
    node_id: str


@router.post("/tree/create-playlist", status_code=201)
async def tree_create_playlist(body: CreatePlaylistBody, state: AppState = Depends(get_state)):
    return _create_playlist_handler(_GENRE, body.node_id, state)


@router.post("/tree/create-all-playlists", status_code=201)
async def tree_create_all_playlists(state: AppState = Depends(get_state)):
    return _create_all_playlists_handler(_GENRE, state)


@router.get("/tree/node/{node_id}/export/m3u")
async def tree_node_export_m3u(node_id: str, state: AppState = Depends(get_state)):
    return _export_m3u_handler(_GENRE, node_id, state)


@router.delete("/tree")
async def tree_delete(state: AppState = Depends(get_state)):
    return _delete_tree_handler(_GENRE, state)


# ═══════════════════════════════════════════════════════════════════════════
# Scene Tree routes
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/scene-tree")
async def get_scene_tree(state: AppState = Depends(get_state)):
    return _get_tree_handler(_SCENE, state)


@router.post("/scene-tree/build", status_code=202)
async def scene_tree_build(state: AppState = Depends(get_state)):
    return _build_tree_handler(_SCENE, state)


@router.get("/scene-tree/progress")
async def scene_tree_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.scene_tree_listeners),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/scene-tree/stop")
async def scene_tree_stop(state: AppState = Depends(get_state)):
    return _stop_tree_handler(_SCENE, state)


@router.post("/scene-tree/expand-ungrouped", status_code=202)
async def scene_tree_expand_ungrouped(state: AppState = Depends(get_state)):
    return _expand_ungrouped_handler(_SCENE, state)


@router.post("/scene-tree/refresh-examples", status_code=202)
async def scene_tree_refresh_examples(state: AppState = Depends(get_state)):
    return _refresh_examples_handler(_SCENE, state)


@router.get("/scene-tree/ungrouped")
async def scene_tree_ungrouped(state: AppState = Depends(get_state)):
    return _ungrouped_handler(_SCENE, state)


@router.post("/scene-tree/create-playlist", status_code=201)
async def scene_tree_create_playlist(body: CreatePlaylistBody, state: AppState = Depends(get_state)):
    return _create_playlist_handler(_SCENE, body.node_id, state)


@router.post("/scene-tree/create-all-playlists", status_code=201)
async def scene_tree_create_all_playlists(state: AppState = Depends(get_state)):
    return _create_all_playlists_handler(_SCENE, state)


@router.get("/scene-tree/node/{node_id}/export/m3u")
async def scene_tree_node_export_m3u(node_id: str, state: AppState = Depends(get_state)):
    return _export_m3u_handler(_SCENE, node_id, state)


@router.delete("/scene-tree")
async def scene_tree_delete(state: AppState = Depends(get_state)):
    return _delete_tree_handler(_SCENE, state)


# ═══════════════════════════════════════════════════════════════════════════
# Collection Tree routes (different pipeline — curated cross-reference)
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/collection-tree")
async def get_collection_tree(state: AppState = Depends(get_state)):
    tree = state.collection_tree
    if tree is None:
        tree = load_tree(file_path=_COLLECTION_TREE_FILE)
        if tree:
            state.collection_tree = tree
    if tree is None:
        has_checkpoint = os.path.exists(_COLLECTION_CHECKPOINT_FILE)
        checkpoint_phase = 0
        if has_checkpoint:
            try:
                with open(_COLLECTION_CHECKPOINT_FILE) as f:
                    cp = json.load(f)
                checkpoint_phase = cp.get("phase_completed", 0)
            except Exception:
                pass
        return {"tree": None, "has_checkpoint": has_checkpoint,
                "checkpoint_phase": checkpoint_phase}
    return {"tree": tree}


@router.post("/collection-tree/build", status_code=202)
async def collection_tree_build(
    request: Request,
    state: AppState = Depends(get_state),
):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    genre_tree = _GENRE.get_tree(state)
    scene_tree = _SCENE.get_tree(state)
    if not genre_tree:
        raise HTTPException(status_code=400, detail="Genre tree must be built first")
    if not scene_tree:
        raise HTTPException(status_code=400, detail="Scene tree must be built first")

    t = state.collection_tree_thread
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail="Collection tree build already in progress")

    state.collection_tree_stop_flag.clear()
    state.collection_tree = None

    config = load_config()
    model_config = {
        "creative": config.get("creative_model", COLLECTION_TREE_MODELS["creative"]),
        "mechanical": config.get("mechanical_model", COLLECTION_TREE_MODELS["mechanical"]),
    }
    client = _get_client("anthropic")
    delay = 0

    listeners = state.collection_tree_listeners

    def progress_callback(phase, detail, pct):
        listeners.broadcast({
            "event": "progress", "phase": phase,
            "detail": detail, "percent": pct,
        })

    test_mode = request.query_params.get("test", "").lower() in ("1", "true")

    def worker():
        try:
            tree = build_curated_collection(
                df=df, client=client, model_config=model_config,
                delay=delay, progress_cb=progress_callback,
                stop_flag=state.collection_tree_stop_flag,
                test_mode=test_mode,
            )
            state.collection_tree = tree
            listeners.broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logger.exception("Collection tree build failed")
            listeners.broadcast({"event": "error", "phase": "error",
                                 "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    state.collection_tree_thread = thread
    thread.start()
    return {"started": True}


@router.get("/collection-tree/progress")
async def collection_tree_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.collection_tree_listeners),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/collection-tree/stop")
async def collection_tree_stop(state: AppState = Depends(get_state)):
    state.collection_tree_stop_flag.set()
    return {"stopped": True}


@router.get("/collection-tree/ungrouped")
async def collection_tree_ungrouped(state: AppState = Depends(get_state)):
    tree = state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if not tree:
        raise HTTPException(status_code=404, detail="No collection tree built")

    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        ungrouped_ids = tree.get("ungrouped_track_ids", [])
        tracks = _tracks_from_ids(state.df, ungrouped_ids)
    return {"count": len(tracks), "tracks": tracks}


@router.post("/collection-tree/create-playlist", status_code=201)
async def collection_tree_create_playlist(body: CreatePlaylistBody, state: AppState = Depends(get_state)):
    tree = state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if not tree:
        raise HTTPException(status_code=404, detail="No collection tree built")

    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    node = find_node(tree, body.node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"Node '{body.node_id}' not found")

    track_ids = node.get("track_ids", [])
    name = node.get("title", "Untitled")
    description = node.get("description", "")
    filters = node.get("filters", {})

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    target_count = min(25, len(track_ids))

    valid_ids = [tid for tid in track_ids if tid in df.index]
    candidates = _tracks_from_ids(df, valid_ids[:80])

    method = "direct"
    final_ids = valid_ids

    if candidates and len(candidates) > 5:
        try:
            result = rerank_tracks(
                candidates, name, description,
                client, model, provider, target_count,
            )
            reranked_ids = [t["id"] for t in result["tracks"]]
            final_ids = [tid for tid in reranked_ids if tid in df.index]
            method = "smart"
        except Exception:
            logger.exception("LLM rerank failed for collection tree leaf")
            final_ids = valid_ids[:target_count]
            method = "scored_fallback"

    playlist = create_playlist(name, description, filters, final_ids, "collection-tree")
    return {"playlist": playlist, "method": method}


@router.post("/collection-tree/create-all-playlists", status_code=201)
async def collection_tree_create_all_playlists(state: AppState = Depends(get_state)):
    tree = state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if not tree:
        raise HTTPException(status_code=404, detail="No collection tree built")

    created = []
    for cat in tree.get("categories", []):
        for leaf in cat.get("leaves", []):
            playlist = create_playlist(
                name=leaf.get("title", "Untitled"),
                description=leaf.get("description", ""),
                filters=leaf.get("filters", {}),
                track_ids=leaf.get("track_ids", []),
                source="collection-tree",
            )
            created.append(playlist)

    return {"playlists": created, "count": len(created)}


@router.get("/collection-tree/node/{node_id}/export/m3u")
async def collection_tree_node_export_m3u(node_id: str, state: AppState = Depends(get_state)):
    tree = state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if not tree:
        raise HTTPException(status_code=404, detail="No collection tree built")

    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        df = state.df

        node = find_node(tree, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

        track_ids = node.get("track_ids", [])
        title = node.get("title", "Untitled")

        lines = ["#EXTM3U", f"#PLAYLIST:{title}"]
        for tid in track_ids:
            if tid not in df.index:
                continue
            row = df.loc[tid]
            artist = str(row.get("artist", "Unknown"))
            track_title = str(row.get("title", "Unknown"))
            location = str(row.get("location", ""))
            lines.append(f"#EXTINF:-1,{artist} - {track_title}")
            if location and location != "nan":
                lines.append(location)

    content = "\n".join(lines) + "\n"
    name = title.replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{name}.m3u8"'},
    )


@router.delete("/collection-tree")
async def collection_tree_delete(state: AppState = Depends(get_state)):
    state.collection_tree = None
    deleted = delete_tree_file(file_path=_COLLECTION_TREE_FILE)
    _clear_checkpoint()
    return {"deleted": deleted}
