"""Playlist and workshop analysis routes.

Migrated from Flask routes.py — playlist CRUD, search, suggestions,
reranking, chord data, and import/export.
"""

import io
import logging
import os

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import load_config
from app.parser import (
    build_chord_data,
    build_facet_options,
    build_genre_cooccurrence,
    build_genre_landscape_summary,
    faceted_search,
    parse_all_comments,
    scored_search,
)
from app.playlist import (
    add_tracks_to_playlist,
    create_playlist,
    delete_playlist,
    export_csv,
    export_m3u,
    get_playlist,
    import_m3u,
    list_playlists,
    remove_tracks_from_playlist,
    rerank_tracks,
    update_playlist,
)
from app.state import AppState, get_state
from app.tree import TREE_PROFILES, load_tree

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workshop", tags=["playlists"])


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


def _get_analysis(state: AppState) -> dict | None:
    with state.cache_lock:
        if state.analysis_cache is not None:
            return state.analysis_cache
    df = _ensure_parsed(state)
    if df is None:
        return None
    analysis = {
        "cooccurrence": build_genre_cooccurrence(df),
        "landscape_summary": build_genre_landscape_summary(df),
        "facet_options": build_facet_options(df),
    }
    with state.cache_lock:
        state.analysis_cache = analysis
    return analysis


# ---------------------------------------------------------------------------
# Analysis / Chord / Search routes
# ---------------------------------------------------------------------------


@router.get("/analysis")
async def workshop_analysis(state: AppState = Depends(get_state)):
    analysis = _get_analysis(state)
    if analysis is None:
        raise HTTPException(status_code=400, detail="No file uploaded")
    return analysis


@router.get("/chord-data")
async def workshop_chord_data(
    tree_type: str = "genre",
    threshold: float = 0.08,
    max_lineages: int = 12,
    state: AppState = Depends(get_state),
):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    if tree_type == "scene":
        tree = state.scene_tree or load_tree(file_path=TREE_PROFILES["scene"]["file"])
        if tree:
            state.scene_tree = tree
    else:
        tree = state.tree or load_tree()
        if tree:
            state.tree = tree

    if not tree or not tree.get("lineages"):
        raise HTTPException(
            status_code=404,
            detail=f"No {tree_type} tree built yet. Build one in the Trees tab first.",
        )

    cache_key = f"{tree_type}_{threshold}_{max_lineages}"
    with state.cache_lock:
        cached = state.chord_cache
        if cached and cached.get("_key") == cache_key:
            return cached["data"]

    data = build_chord_data(df, tree, threshold=threshold, max_lineages=max_lineages)
    with state.cache_lock:
        state.chord_cache = {"_key": cache_key, "data": data}
    return data


class SearchBody(BaseModel):
    filters: dict = {}


@router.post("/search")
async def workshop_search(body: SearchBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    matching_ids = faceted_search(df, body.filters)
    tracks = _tracks_from_ids(df, matching_ids)
    return {
        "track_ids": [int(i) for i in matching_ids],
        "count": len(matching_ids),
        "tracks": tracks,
    }


class ScoredSearchBody(BaseModel):
    filters: dict = {}
    min_score: float = 0.15
    max_results: int = 200


@router.post("/scored-search")
async def workshop_scored_search(body: ScoredSearchBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    scored_results = scored_search(df, body.filters, min_score=body.min_score,
                                   max_results=body.max_results)

    tracks = []
    for idx, score, matched_facets in scored_results:
        if idx not in df.index:
            continue
        row = df.loc[idx]
        track = {"id": int(idx), "score": score, "matched": matched_facets}
        for col in df.columns:
            if not col.startswith("_"):
                track[col] = _safe_val(row[col])
        tracks.append(track)

    return {
        "count": len(tracks),
        "tracks": tracks,
        "track_ids": [t["id"] for t in tracks],
    }


class RerankBody(BaseModel):
    tracks: list[dict] = []
    playlist_name: str = "Untitled"
    description: str = ""
    target_count: int = 25


@router.post("/rerank")
async def workshop_rerank(body: RerankBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    if not body.tracks:
        raise HTTPException(status_code=400, detail="No candidate tracks provided")

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    try:
        result = rerank_tracks(
            body.tracks, body.playlist_name, body.description,
            client, model, provider, body.target_count,
        )

        reranked_ids = [t["id"] for t in result["tracks"]]
        reason_map = {t["id"]: t["reason"] for t in result["tracks"]}
        enriched_tracks = _tracks_from_ids(df, reranked_ids)

        for t in enriched_tracks:
            t["reason"] = reason_map.get(t["id"], "")

        return {
            "tracks": enriched_tracks,
            "track_ids": reranked_ids,
            "flow_notes": result["flow_notes"],
            "count": len(enriched_tracks),
        }
    except Exception as e:
        logger.exception("LLM reranking failed")
        raise HTTPException(status_code=500, detail=str(e))


class SuggestBody(BaseModel):
    mode: str = "explore"
    num_suggestions: int | None = None
    vibe_text: str = ""
    seed_track_ids: list[int] = []
    genre1: str = ""
    genre2: str = ""
    lineage1_title: str = ""
    lineage2_title: str = ""
    lineage1_filters: dict = {}
    lineage2_filters: dict = {}


@router.post("/suggest")
async def workshop_suggest(body: SuggestBody, state: AppState = Depends(get_state)):
    from app.playlist import (
        generate_intersection_suggestions,
        generate_playlist_suggestions,
        generate_seed_suggestions,
        generate_vibe_suggestions,
    )

    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    analysis = _get_analysis(state)
    landscape = analysis["landscape_summary"]

    num = body.num_suggestions or (6 if body.mode == "explore" else 3)

    try:
        if body.mode == "vibe":
            if not body.vibe_text.strip():
                raise HTTPException(status_code=400, detail="vibe_text is required for vibe mode")
            suggestions = generate_vibe_suggestions(
                landscape, body.vibe_text, client, model, provider, num,
            )
        elif body.mode == "seed":
            if not body.seed_track_ids:
                raise HTTPException(status_code=400, detail="seed_track_ids is required for seed mode")
            seed_tracks = _tracks_from_ids(df, body.seed_track_ids)
            seed_details = "\n".join(
                f"- {t.get('artist', '?')} — {t.get('title', '?')} "
                f"(BPM: {t.get('bpm', '?')}, Key: {t.get('key', '?')}, "
                f"Comment: {t.get('comment', '')})"
                for t in seed_tracks
            )
            suggestions = generate_seed_suggestions(
                landscape, seed_details, client, model, provider, num,
            )
        elif body.mode == "intersection":
            if not body.genre1 or not body.genre2:
                raise HTTPException(status_code=400, detail="genre1 and genre2 required for intersection mode")
            intersection_ids = faceted_search(df, {"genres": [body.genre1, body.genre2]})
            suggestions = generate_intersection_suggestions(
                landscape, body.genre1, body.genre2, len(intersection_ids),
                client, model, provider, num,
            )
        elif body.mode == "chord-intersection":
            if not body.lineage1_title or not body.lineage2_title:
                raise HTTPException(status_code=400, detail="lineage titles required")
            r1 = scored_search(df, body.lineage1_filters, min_score=0.08, max_results=len(df))
            r2 = scored_search(df, body.lineage2_filters, min_score=0.08, max_results=len(df))
            shared = {i for i, _, _ in r1} & {i for i, _, _ in r2}
            suggestions = generate_intersection_suggestions(
                landscape, body.lineage1_title, body.lineage2_title, len(shared),
                client, model, provider, num,
            )
        else:
            suggestions = generate_playlist_suggestions(
                landscape, client, model, provider, num,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Playlist suggestion generation failed")
        raise HTTPException(status_code=500, detail=str(e))

    for s in suggestions:
        try:
            scored_results = scored_search(df, s["filters"], min_score=0.1, max_results=100)
            s["track_count"] = len(scored_results)
            sample_ids = [r[0] for r in scored_results[:5]]
            samples = _tracks_from_ids(df, sample_ids)
            score_map = {r[0]: r[1] for r in scored_results[:5]}
            s["sample_tracks"] = [
                {
                    "id": t["id"],
                    "title": t.get("title", ""),
                    "artist": t.get("artist", ""),
                    "year": t.get("year", ""),
                    "score": score_map.get(t["id"], 0),
                }
                for t in samples
            ]
        except Exception:
            s["track_count"] = 0
            s["sample_tracks"] = []

    return {"suggestions": suggestions}


# ---------------------------------------------------------------------------
# Playlist CRUD
# ---------------------------------------------------------------------------


@router.get("/playlists")
async def workshop_list_playlists():
    return {"playlists": list_playlists()}


class CreatePlaylistBody(BaseModel):
    name: str = "Untitled Playlist"
    description: str = ""
    filters: dict | None = None
    track_ids: list[int] | None = None
    source: str = "manual"


@router.post("/playlists", status_code=201)
async def workshop_create_playlist(body: CreatePlaylistBody, state: AppState = Depends(get_state)):
    track_ids = body.track_ids
    if track_ids is None and body.filters:
        df = _ensure_parsed(state)
        if df is not None:
            track_ids = faceted_search(df, body.filters)

    playlist = create_playlist(body.name, body.description, body.filters, track_ids, body.source)
    return {"playlist": playlist}


class SmartCreateBody(BaseModel):
    name: str = "Untitled Playlist"
    description: str = ""
    filters: dict | None = None
    target_count: int = 25


@router.post("/playlists/smart-create", status_code=201)
async def workshop_smart_create_playlist(body: SmartCreateBody, state: AppState = Depends(get_state)):
    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    if not body.filters:
        raise HTTPException(status_code=400, detail="Filters are required for smart create")

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    scored_results = scored_search(df, body.filters, min_score=0.1, max_results=80)

    if not scored_results:
        playlist = create_playlist(body.name, body.description, body.filters, [], "llm")
        return {"playlist": playlist, "method": "empty"}

    candidate_ids = [r[0] for r in scored_results]
    candidates = _tracks_from_ids(df, candidate_ids)

    try:
        result = rerank_tracks(
            candidates, body.name, body.description,
            client, model, provider, body.target_count,
        )
        reranked_ids = [t["id"] for t in result["tracks"]]
        valid_ids = [tid for tid in reranked_ids if tid in df.index]
        method = "smart"
    except Exception:
        logger.exception("LLM reranking failed during smart create, falling back")
        valid_ids = [int(r[0]) for r in scored_results[:body.target_count]]
        method = "scored_fallback"

    playlist = create_playlist(body.name, body.description, body.filters, valid_ids, "llm")
    return {"playlist": playlist, "method": method}


@router.get("/playlists/{playlist_id}")
async def workshop_get_playlist(playlist_id: str, state: AppState = Depends(get_state)):
    p = get_playlist(playlist_id)
    if not p:
        raise HTTPException(status_code=404, detail="Playlist not found")

    with state.df_lock:
        if not state.df.empty:
            playlist_tracks = _tracks_from_ids(state.df, p["track_ids"])
        else:
            playlist_tracks = []
    return {"playlist": p, "tracks": playlist_tracks}


@router.put("/playlists/{playlist_id}")
async def workshop_update_playlist(playlist_id: str, request: Request):
    data = await request.json()
    p = update_playlist(playlist_id, data)
    if not p:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"playlist": p}


@router.delete("/playlists/{playlist_id}")
async def workshop_delete_playlist(playlist_id: str):
    if delete_playlist(playlist_id):
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Playlist not found")


class TrackIdsBody(BaseModel):
    track_ids: list[int] = []


@router.post("/playlists/{playlist_id}/tracks")
async def workshop_add_tracks(playlist_id: str, body: TrackIdsBody):
    p = add_tracks_to_playlist(playlist_id, body.track_ids)
    if not p:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"playlist": p}


@router.delete("/playlists/{playlist_id}/tracks")
async def workshop_remove_tracks(playlist_id: str, body: TrackIdsBody):
    p = remove_tracks_from_playlist(playlist_id, body.track_ids)
    if not p:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"playlist": p}


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------


@router.get("/playlists/{playlist_id}/export/m3u")
async def workshop_export_m3u(playlist_id: str, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        content = export_m3u(playlist_id, state.df)

    if content is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    p = get_playlist(playlist_id)
    name = (p["name"] if p else "playlist").replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{name}.m3u8"'},
    )


@router.get("/playlists/{playlist_id}/export/csv")
async def workshop_export_csv(playlist_id: str, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        buf = export_csv(playlist_id, state.df)

    if buf is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    p = get_playlist(playlist_id)
    name = (p["name"] if p else "playlist").replace(" ", "_")
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


@router.post("/playlists/import")
async def workshop_import_playlist(file: UploadFile, state: AppState = Depends(get_state)):
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded — load your collection first")
        df = state.df

    fname = file.filename or ""
    if not fname.lower().endswith((".m3u", ".m3u8")):
        raise HTTPException(status_code=400, detail="Only .m3u / .m3u8 files are supported")

    contents = await file.read()
    content = contents.decode("utf-8", errors="replace")
    result = import_m3u(content, fname, df)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result
