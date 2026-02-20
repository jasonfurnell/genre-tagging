"""Set workshop and saved sets routes.

Migrated from Flask routes.py — set workshop operations and saved set CRUD.
"""

import io
import json
import logging
import os

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import load_config
from app.parser import parse_all_comments
from app.setbuilder import (
    build_track_context,
    create_saved_set,
    delete_saved_set,
    find_all_leaves_for_track,
    find_leaf_for_track,
    get_browse_sources,
    get_saved_set,
    get_source_detail,
    get_source_info,
    get_source_tracks,
    list_saved_sets,
    load_set_state,
    save_set_state,
    select_tracks_for_source,
    update_saved_set,
)
from app.state import AppState, get_state
from app.tree import (
    TREE_PROFILES,
    _COLLECTION_TREE_FILE,
    load_tree,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sets"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_val(val):
    if pd.isna(val):
        return ""
    if hasattr(val, "item"):
        return val.item()
    return val


def _ensure_parsed(state: AppState) -> pd.DataFrame | None:
    with state.df_lock:
        if state.df.empty:
            return None
        parse_all_comments(state.df)
        return state.df


def _tracks_from_ids(df: pd.DataFrame, ids: list) -> list[dict]:
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


def _resolve_tree(tree_type: str, state: AppState):
    """Helper: load genre, scene, or collection tree from state or disk."""
    if tree_type == "collection":
        return state.collection_tree or load_tree(file_path=_COLLECTION_TREE_FILE)
    if tree_type == "scene":
        return state.scene_tree or load_tree(file_path=TREE_PROFILES["scene"]["file"])
    return state.tree or load_tree()


def _map_audio_path(location: str) -> str:
    if not location or location == "nan":
        return location
    cfg = load_config()
    if not cfg.get("audio_path_map_enabled"):
        return location
    path_from = cfg.get("audio_path_from", "")
    path_to = cfg.get("audio_path_to", "")
    if path_from and location.startswith(path_from):
        return path_to + location[len(path_from):]
    return location


def _to_dropbox_path(location: str) -> str | None:
    if not location or location == "nan":
        return None
    cfg = load_config()
    prefix = cfg.get("dropbox_path_prefix") or cfg.get("audio_path_from", "")
    if prefix and location.startswith(prefix):
        return location[len(prefix):]
    return None


def _dropbox_file_exists(state: AppState, dropbox_path: str) -> bool:
    if not dropbox_path:
        return False
    if dropbox_path in state.dropbox_exists_cache:
        return state.dropbox_exists_cache[dropbox_path]
    dbx = state.dropbox_client
    if not dbx:
        return False
    try:
        dbx.files_get_metadata(dropbox_path)
        state.dropbox_exists_cache[dropbox_path] = True
        return True
    except Exception:
        state.dropbox_exists_cache[dropbox_path] = False
        return False


def _check_has_audio(location: str, state: AppState | None = None) -> bool:
    if not location or location == "nan":
        return False
    if state:
        dbx = state.dropbox_client
        if dbx:
            dropbox_path = _to_dropbox_path(str(location))
            if dropbox_path and _dropbox_file_exists(state, dropbox_path):
                return True
    mapped = _map_audio_path(str(location))
    return bool(mapped and mapped != "nan" and os.path.isfile(mapped))


# ═══════════════════════════════════════════════════════════════════════════
# Set Workshop routes
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/api/set-workshop/sources")
async def set_workshop_sources(search: str = "", state: AppState = Depends(get_state)):
    collection_tree = _resolve_tree("collection", state)
    return get_browse_sources(collection_tree, search)


class AssignSourceBody(BaseModel):
    source_type: str = "playlist"
    source_id: str = ""
    tree_type: str = "genre"
    used_track_ids: list[int] = []
    anchor_track_id: int | None = None
    track_ids: list[int] = []
    name: str = "Ad-hoc"


@router.post("/api/set-workshop/assign-source")
async def set_workshop_assign_source(body: AssignSourceBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    used_ids = set(body.used_track_ids)
    tree = _resolve_tree(body.tree_type, state) if body.source_type == "tree_node" else None

    if body.source_type == "adhoc":
        track_ids = body.track_ids
        info = {"id": body.source_id, "name": body.name,
                "description": "", "track_count": len(track_ids), "examples": []}
    else:
        info = get_source_info(body.source_type, body.source_id, tree)
        if not info:
            raise HTTPException(status_code=404, detail="Source not found")
        track_ids = get_source_tracks(body.source_type, body.source_id, tree)

    if not track_ids:
        raise HTTPException(status_code=400, detail="Source has no tracks")

    def has_audio_fn(loc):
        return _check_has_audio(loc, state)

    tracks = select_tracks_for_source(
        df, track_ids,
        used_track_ids=used_ids,
        anchor_track_id=body.anchor_track_id,
        has_audio_fn=has_audio_fn,
    )

    return {"source": info, "tracks": tracks}


class DragTrackBody(BaseModel):
    track_id: int | None = None
    source_type: str = "playlist"
    source_id: str = ""
    tree_type: str = "genre"
    used_track_ids: list[int] = []
    track_ids: list[int] = []
    name: str = "Ad-hoc"


@router.post("/api/set-workshop/drag-track")
async def set_workshop_drag_track(body: DragTrackBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    used_ids = set(body.used_track_ids)
    source_type = body.source_type
    source_id = body.source_id
    tree_type = body.tree_type
    tree = _resolve_tree(tree_type, state) if source_type == "tree_node" else None

    if source_type == "adhoc":
        track_ids = body.track_ids
        if len(track_ids) <= 1 and body.track_id is not None:
            coll_tree = _resolve_tree("collection", state)
            leaf = find_leaf_for_track(coll_tree, body.track_id)
            if leaf:
                track_ids = leaf.get("track_ids", track_ids)
                source_type = "tree_node"
                source_id = leaf.get("id", "")
                tree_type = "collection"
                tree = coll_tree
    else:
        track_ids = get_source_tracks(source_type, source_id, tree)

    if not track_ids:
        raise HTTPException(status_code=400, detail="Source has no tracks")

    def has_audio_fn(loc):
        return _check_has_audio(loc, state)

    tracks = select_tracks_for_source(
        df, track_ids,
        used_track_ids=used_ids,
        anchor_track_id=body.track_id,
        has_audio_fn=has_audio_fn,
    )

    if source_type == "adhoc":
        info = {"id": source_id, "name": body.name,
                "description": "", "track_count": len(track_ids), "examples": []}
    else:
        info = get_source_info(source_type, source_id, tree)

    if info:
        info["type"] = source_type
        info["tree_type"] = tree_type

    return {"source": info, "tracks": tracks}


class RefillBpmBody(BaseModel):
    slots: list[dict] = []


@router.post("/api/set-workshop/refill-bpm")
async def set_workshop_refill_bpm(body: RefillBpmBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    slots = body.slots

    def has_audio_fn(loc):
        return _check_has_audio(loc, state)

    def generate():
        used_global = set()
        total = len(slots)
        done = 0

        for si, slot in enumerate(slots):
            source = slot.get("source")
            tracks = slot.get("tracks") or []
            sel_idx = slot.get("selectedTrackIndex")

            if not source or not tracks or sel_idx is None:
                done += 1
                continue

            anchor = tracks[sel_idx] if 0 <= sel_idx < len(tracks) and tracks[sel_idx] else None
            if not anchor or anchor.get("id") is None:
                done += 1
                continue

            anchor_id = anchor["id"]
            src_type = source.get("type", "adhoc")
            src_id = source.get("id")
            tree_type = source.get("tree_type", "genre")

            tree = _resolve_tree(tree_type, state) if src_type == "tree_node" else None

            if src_type == "adhoc":
                pool_ids = [t["id"] for t in tracks if t and t.get("id") is not None]
                if len(pool_ids) <= 1:
                    coll_tree = _resolve_tree("collection", state)
                    leaf = find_leaf_for_track(coll_tree, anchor_id)
                    if leaf:
                        pool_ids = leaf.get("track_ids", pool_ids)
                        src_type = "tree_node"
                        src_id = leaf.get("id", "")
                        tree_type = "collection"
                        tree = coll_tree
            else:
                pool_ids = get_source_tracks(src_type, src_id, tree)

            if not pool_ids:
                done += 1
                continue

            new_tracks = select_tracks_for_source(
                df, pool_ids,
                used_track_ids=used_global,
                anchor_track_id=anchor_id,
                has_audio_fn=has_audio_fn,
            )

            for t in new_tracks:
                if t and t.get("id") is not None:
                    used_global.add(t["id"])

            if src_type == "adhoc":
                info = {"id": src_id, "name": source.get("name", "Ad-hoc"),
                        "type": src_type, "tree_type": tree_type}
            else:
                info = get_source_info(src_type, src_id, tree) or {}
                info["type"] = src_type
                info["tree_type"] = tree_type

            done += 1
            event = json.dumps({
                "slot_index": si,
                "source": info,
                "tracks": new_tracks,
                "progress": done,
                "total": total,
            })
            yield f"data: {event}\n\n"

        yield 'data: {"done": true}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/set-workshop/source-detail")
async def set_workshop_source_detail(
    source_type: str = "playlist",
    source_id: str = "",
    tree_type: str = "genre",
    state: AppState = Depends(get_state),
):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    tree = _resolve_tree(tree_type, state) if source_type == "tree_node" else None

    def has_audio_fn(loc):
        return _check_has_audio(loc, state)

    detail = get_source_detail(df, source_type, source_id, tree, has_audio_fn=has_audio_fn)
    if not detail:
        raise HTTPException(status_code=404, detail="Source not found")
    return detail


class TrackSearchBody(BaseModel):
    query: str = ""


@router.post("/api/set-workshop/track-search")
async def set_workshop_track_search(body: TrackSearchBody, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        df = state.df

        query = (body.query or "").strip()
        if not query or len(query) < 2:
            return {"tracks": [], "count": 0}

        q_lower = query.lower()
        matches = []
        for idx in df.index:
            row = df.loc[idx]
            title = str(row.get("title", "")).lower()
            artist = str(row.get("artist", "")).lower()
            if q_lower in title or q_lower in artist:
                matches.append(idx)
            if len(matches) >= 50:
                break

        tracks = _tracks_from_ids(df, matches)
    return {"tracks": tracks, "count": len(tracks)}


@router.get("/api/set-workshop/track-context/{track_id}")
async def set_workshop_track_context(track_id: int, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    if track_id not in df.index:
        raise HTTPException(status_code=404, detail="Track not found")

    collection_tree = _resolve_tree("collection", state)
    result = build_track_context(df, track_id, collection_tree)
    if not result:
        raise HTTPException(status_code=404, detail="Track not found")
    return result


class CheckAudioBody(BaseModel):
    track_ids: list[int] = []


@router.post("/api/set-workshop/check-audio")
async def set_workshop_check_audio(body: CheckAudioBody, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            return {}
        df = state.df
        result = {}
        for tid in body.track_ids:
            tid = int(tid)
            if tid not in df.index:
                result[str(tid)] = False
                continue
            raw_loc = str(df.loc[tid].get("location", ""))
            result[str(tid)] = _check_has_audio(raw_loc, state)
    return result


@router.get("/api/set-workshop/state")
async def set_workshop_get_state():
    ws_state = load_set_state()
    return ws_state if ws_state else None


@router.post("/api/set-workshop/state")
async def set_workshop_save_state(request: Request):
    body = await request.json()
    if body is None:
        raise HTTPException(status_code=400, detail="No data")
    save_set_state(body)
    return {"ok": True}


class ExportM3uBody(BaseModel):
    slots: list[dict] = []
    name: str = "DJ_Set"


@router.post("/api/set-workshop/export-m3u")
async def set_workshop_export_m3u(body: ExportM3uBody, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        df = state.df

        lines = ["#EXTM3U", f"#PLAYLIST:{body.name}"]
        for slot in body.slots:
            tid = slot.get("track_id")
            if tid is None or tid not in df.index:
                continue
            row = df.loc[tid]
            artist = str(row.get("artist", "Unknown"))
            title = str(row.get("title", "Unknown"))
            location = str(row.get("location", ""))
            lines.append(f"#EXTINF:-1,{artist} - {title}")
            if location and location != "nan":
                lines.append(location)

    content = "\n".join(lines) + "\n"
    safe_name = body.name.replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.m3u8"'},
    )


# ═══════════════════════════════════════════════════════════════════════════
# Saved Sets CRUD
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/api/saved-sets")
async def saved_sets_list():
    return {"sets": list_saved_sets()}


@router.get("/api/saved-sets/{set_id}")
async def saved_sets_get(set_id: str):
    s = get_saved_set(set_id)
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    return s


class CreateSetBody(BaseModel):
    name: str
    slots: list[dict]


@router.post("/api/saved-sets", status_code=201)
async def saved_sets_create(body: CreateSetBody):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    s = create_saved_set(body.name, body.slots)
    return s


class UpdateSetBody(BaseModel):
    name: str | None = None
    slots: list[dict] | None = None


@router.put("/api/saved-sets/{set_id}")
async def saved_sets_update(set_id: str, body: UpdateSetBody):
    s = update_saved_set(set_id, name=body.name, slots=body.slots)
    if not s:
        raise HTTPException(status_code=404, detail="Set not found")
    return s


@router.delete("/api/saved-sets/{set_id}")
async def saved_sets_delete(set_id: str):
    if delete_saved_set(set_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Set not found")


@router.get("/api/saved-sets/{set_id}/export/m3u")
async def saved_sets_export_m3u(set_id: str, state: AppState = Depends(get_state)):
    """Export a saved set as M3U8 (Lexicon compatible)."""
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        df = state.df

        s = get_saved_set(set_id)
        if not s:
            raise HTTPException(status_code=404, detail="Set not found")

        set_name = s.get("name", "DJ_Set")
        lines = ["#EXTM3U", f"#PLAYLIST:{set_name}"]

        for slot in s.get("slots", []):
            idx = slot.get("selectedTrackIndex")
            tracks = slot.get("tracks") or []
            if idx is None or idx >= len(tracks) or tracks[idx] is None:
                continue
            tid = tracks[idx].get("id")
            if tid is None or tid not in df.index:
                continue
            row = df.loc[tid]
            artist = str(row.get("artist", "Unknown"))
            title = str(row.get("title", "Unknown"))
            location = str(row.get("location", ""))
            lines.append(f"#EXTINF:-1,{artist} - {title}")
            if location and location != "nan":
                lines.append(location)

    content = "\n".join(lines) + "\n"
    safe_name = set_name.replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.m3u8"'},
    )
