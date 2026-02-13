import io
import json
import logging
import os
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import dropbox
from dropbox import DropboxOAuth2Flow
from flask import Blueprint, request, jsonify, Response, send_file, redirect
from anthropic import Anthropic
from openai import OpenAI
from dotenv import load_dotenv

from app.tagger import generate_genre_comment
from app.config import load_config, save_config, DEFAULT_CONFIG
from app.parser import (
    parse_all_comments, invalidate_parsed_columns,
    build_genre_cooccurrence, build_genre_landscape_summary,
    build_facet_options, faceted_search, scored_search,
    build_chord_data,
)
from app.playlist import (
    create_playlist, get_playlist, list_playlists, update_playlist,
    delete_playlist, add_tracks_to_playlist, remove_tracks_from_playlist,
    generate_playlist_suggestions, generate_vibe_suggestions,
    generate_seed_suggestions, generate_intersection_suggestions,
    rerank_tracks, export_m3u, export_csv,
)
from app.tree import (
    build_collection_tree, expand_tree_from_ungrouped,
    load_tree, save_tree, delete_tree as delete_tree_file,
    find_node, refresh_all_examples, TREE_PROFILES,
)
from app.setbuilder import (
    get_browse_sources, get_source_detail, get_source_info,
    get_source_tracks, select_tracks_for_source,
    build_track_context, save_set_state, load_set_state,
    create_saved_set, get_saved_set, list_saved_sets,
    update_saved_set, delete_saved_set,
)

api = Blueprint("api", __name__)

# ---------------------------------------------------------------------------
# Session state (in-memory, single-user)
# ---------------------------------------------------------------------------
_state = {
    "df": None,
    "original_filename": None,
    "tagging_thread": None,
    "stop_flag": threading.Event(),
    "progress_listeners": [],   # list of queue.Queue for SSE
    "_analysis_cache": None,     # cached analysis data for workshop
    # Collection Tree (Genre)
    "tree": None,
    "tree_thread": None,
    "tree_stop_flag": threading.Event(),
    "tree_progress_listeners": [],
    # Scene Tree
    "scene_tree": None,
    "scene_tree_thread": None,
    "scene_tree_stop_flag": threading.Event(),
    "scene_tree_progress_listeners": [],
    "_preview_cache": {},          # "artist||title" -> {preview_url, found, ...}
    "_artwork_cache": {},          # "artist||title" -> {cover_url, found}
    "_chord_cache": None,          # cached chord diagram data
    # Dropbox integration
    "_dropbox_client": None,       # dropbox.Dropbox instance
    "_dropbox_refresh_token": None,
    "_dropbox_account_id": None,
    "_dropbox_exists_cache": {},   # dropbox_path -> bool
    "_dropbox_oauth_csrf": None,   # CSRF token for OAuth flow
}

# ---------------------------------------------------------------------------
# Persistent artwork cache (survives server restarts)
# ---------------------------------------------------------------------------
_ARTWORK_CACHE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "artwork_cache.json"
)

def _load_artwork_cache():
    """Load artwork cache from disk into _state."""
    try:
        if os.path.exists(_ARTWORK_CACHE_FILE):
            with open(_ARTWORK_CACHE_FILE, "r") as f:
                _state["_artwork_cache"] = json.load(f)
            logging.info("Loaded %d artwork cache entries from disk",
                         len(_state["_artwork_cache"]))
    except Exception:
        logging.exception("Failed to load artwork cache from disk")

def _save_artwork_cache():
    """Persist artwork cache to disk."""
    try:
        snapshot = dict(_state["_artwork_cache"])   # safe copy
        with open(_ARTWORK_CACHE_FILE, "w") as f:
            json.dump(snapshot, f)
    except Exception:
        logging.exception("Failed to save artwork cache to disk")

_load_artwork_cache()

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

# ---------------------------------------------------------------------------
# Persistent Dropbox tokens (survives server restarts)
# ---------------------------------------------------------------------------
_DROPBOX_TOKENS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "dropbox_tokens.json"
)

def _init_dropbox_client(refresh_token):
    """Create a Dropbox client from a refresh token."""
    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    if not app_key or not app_secret:
        logging.warning("DROPBOX_APP_KEY or DROPBOX_APP_SECRET not set in .env")
        return
    try:
        dbx = dropbox.Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret,
        )
        _state["_dropbox_client"] = dbx
    except Exception:
        logging.exception("Failed to initialize Dropbox client")

def _load_dropbox_tokens():
    """Load persisted Dropbox tokens and initialize client."""
    try:
        if os.path.exists(_DROPBOX_TOKENS_FILE):
            with open(_DROPBOX_TOKENS_FILE, "r") as f:
                data = json.load(f)
            refresh_token = data.get("refresh_token")
            if refresh_token:
                _state["_dropbox_refresh_token"] = refresh_token
                _state["_dropbox_account_id"] = data.get("account_id", "")
                _init_dropbox_client(refresh_token)
                logging.info("Loaded Dropbox tokens from disk")
    except Exception:
        logging.exception("Failed to load Dropbox tokens from disk")

def _save_dropbox_tokens():
    """Persist Dropbox tokens to disk."""
    try:
        os.makedirs(os.path.dirname(_DROPBOX_TOKENS_FILE), exist_ok=True)
        data = {
            "refresh_token": _state.get("_dropbox_refresh_token"),
            "account_id": _state.get("_dropbox_account_id", ""),
        }
        with open(_DROPBOX_TOKENS_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        logging.exception("Failed to save Dropbox tokens to disk")

_load_dropbox_tokens()

# ---------------------------------------------------------------------------
# Dropbox path helpers
# ---------------------------------------------------------------------------

def _to_dropbox_path(location):
    """Convert a CSV location path to a Dropbox-relative path."""
    if not location or location == "nan":
        return None
    cfg = load_config()
    prefix = cfg.get("dropbox_path_prefix") or cfg.get("audio_path_from", "")
    if prefix and location.startswith(prefix):
        return location[len(prefix):]
    return None

def _dropbox_file_exists(dropbox_path):
    """Check if a file exists in Dropbox, with in-memory caching."""
    if not dropbox_path:
        return False
    cache = _state.get("_dropbox_exists_cache", {})
    if dropbox_path in cache:
        return cache[dropbox_path]
    dbx = _state.get("_dropbox_client")
    if not dbx:
        return False
    try:
        dbx.files_get_metadata(dropbox_path)
        cache[dropbox_path] = True
    except dropbox.exceptions.ApiError:
        cache[dropbox_path] = False
    except Exception:
        return False
    _state["_dropbox_exists_cache"] = cache
    return cache.get(dropbox_path, False)

def _check_has_audio(location):
    """Check if a track has playable audio (Dropbox first, then local fallback)."""
    if not location or location == "nan":
        return False
    dbx = _state.get("_dropbox_client")
    if dbx:
        dropbox_path = _to_dropbox_path(str(location))
        if dropbox_path and _dropbox_file_exists(dropbox_path):
            return True
    mapped = _map_audio_path(str(location))
    return bool(mapped and mapped != "nan" and os.path.isfile(mapped))

_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


_LAST_UPLOAD_META = os.path.join(_OUTPUT_DIR, ".last_upload.json")


def _autosave():
    """Write the current DataFrame to output/<original>_autosave.csv."""
    try:
        df = _state["df"]
        if df is None:
            return
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        original = _state.get("original_filename", "playlist.csv")
        name = original.rsplit(".", 1)[0] + "_autosave.csv"
        df.to_csv(os.path.join(_OUTPUT_DIR, name), index=False)
    except Exception:
        pass  # never let a save failure interrupt tagging


def _save_last_upload_meta():
    """Remember which file was last uploaded so we can restore on refresh."""
    try:
        original = _state.get("original_filename")
        if not original:
            return
        os.makedirs(_OUTPUT_DIR, exist_ok=True)
        with open(_LAST_UPLOAD_META, "w") as f:
            json.dump({"original_filename": original}, f)
    except Exception:
        pass


_caffeinate_proc = None


def _caffeinate_start():
    """Prevent macOS idle sleep while tagging is running."""
    global _caffeinate_proc
    _caffeinate_stop()
    try:
        _caffeinate_proc = subprocess.Popen(["caffeinate", "-i"])
    except Exception:
        pass  # not on macOS or caffeinate unavailable


def _caffeinate_stop():
    """Allow macOS to sleep again."""
    global _caffeinate_proc
    if _caffeinate_proc is not None:
        _caffeinate_proc.terminate()
        _caffeinate_proc = None


def _provider_for_model(model):
    return "anthropic" if model.startswith("claude") else "openai"


def _get_client(provider):
    if provider == "anthropic":
        return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _track_status(row):
    comment = row.get("comment", "")
    if pd.isna(comment) or str(comment).strip() == "":
        return "untagged"
    return "tagged"


def _tracks_json():
    df = _state["df"]
    tracks = []
    for idx, row in df.iterrows():
        track = {"id": int(idx)}
        for col in df.columns:
            val = row[col]
            track[col] = "" if pd.isna(val) else val
        track["status"] = _track_status(row)
        tracks.append(track)
    return tracks


def _summary():
    df = _state["df"]
    total = len(df)
    tagged = sum(1 for _, r in df.iterrows()
                 if pd.notna(r.get("comment", "")) and str(r.get("comment", "")).strip())
    return {
        "total": total,
        "tagged": tagged,
        "untagged": total - tagged,
        "columns": list(df.columns),
    }


# ---------------------------------------------------------------------------
# POST /api/upload
# ---------------------------------------------------------------------------
@api.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename.endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported"}), 400

    try:
        df = pd.read_csv(file.stream)
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    # Validate required columns
    missing = [c for c in ("title", "artist") if c not in df.columns]
    if missing:
        return jsonify({"error": f"Missing required columns: {', '.join(missing)}"}), 400

    if "comment" not in df.columns:
        df["comment"] = ""

    # Stop any running tagging
    _state["stop_flag"].set()
    _state["df"] = df
    _state["original_filename"] = file.filename
    _state["_analysis_cache"] = None
    _state["_chord_cache"] = None
    _state["_preview_cache"] = {}
    _state["_artwork_cache"] = {}

    # Persist autosave + metadata so refresh can restore
    _autosave()
    _save_last_upload_meta()

    return jsonify(_summary())


# ---------------------------------------------------------------------------
# GET /api/restore  — reload last autosave on page refresh
# ---------------------------------------------------------------------------
@api.route("/api/restore")
def restore():
    # Already loaded in memory — just return summary
    if _state["df"] is not None:
        return jsonify(_summary())

    # Try to load from autosave on disk
    try:
        with open(_LAST_UPLOAD_META) as f:
            meta = json.load(f)
        original = meta.get("original_filename", "")
        autosave = original.rsplit(".", 1)[0] + "_autosave.csv"
        path = os.path.join(_OUTPUT_DIR, autosave)
        if not os.path.exists(path):
            return jsonify({"restored": False})

        df = pd.read_csv(path)
        missing = [c for c in ("title", "artist") if c not in df.columns]
        if missing:
            return jsonify({"restored": False})

        if "comment" not in df.columns:
            df["comment"] = ""

        _state["df"] = df
        _state["original_filename"] = original
        _state["_analysis_cache"] = None
        _state["_chord_cache"] = None
        _state["_preview_cache"] = {}
        _state["_artwork_cache"] = {}

        result = _summary()
        result["restored"] = True
        result["filename"] = original
        return jsonify(result)
    except Exception:
        return jsonify({"restored": False})


# ---------------------------------------------------------------------------
# GET /api/tracks
# ---------------------------------------------------------------------------
@api.route("/api/tracks")
def tracks():
    if _state["df"] is None:
        return jsonify([])
    return jsonify(_tracks_json())


# ---------------------------------------------------------------------------
# POST /api/tag  (start bulk tagging)
# ---------------------------------------------------------------------------
@api.route("/api/tag", methods=["POST"])
def tag_all():
    if _state["df"] is None:
        return jsonify({"error": "No file uploaded"}), 400

    _state["stop_flag"].clear()
    t = threading.Thread(target=_tagging_worker, daemon=True)
    _state["tagging_thread"] = t
    t.start()
    return jsonify({"started": True})


def _tagging_worker():
    _caffeinate_start()
    try:
        _tagging_loop()
    finally:
        _caffeinate_stop()


def _tagging_loop():
    df = _state["df"]
    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    untagged = [(i, r) for i, r in df.iterrows()
                if pd.isna(r.get("comment", "")) or str(r.get("comment", "")).strip() == ""]

    total_untagged = len(untagged)
    for count, (idx, row) in enumerate(untagged, 1):
        if _state["stop_flag"].is_set():
            _autosave()
            _broadcast({"event": "stopped"})
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
            df.at[idx, "comment"] = comment
            if detected_year:
                df.at[idx, "year"] = int(detected_year)
            _autosave()
            status = "tagged"
        except Exception:
            logging.exception("Tagging failed for track %s – %s", row["title"], row["artist"])
            status = "error"

        _broadcast({
            "event": "progress",
            "id": int(idx),
            "title": row["title"],
            "artist": row["artist"],
            "comment": df.at[idx, "comment"] if status == "tagged" else "",
            "year": int(df.at[idx, "year"]) if status == "tagged" else "",
            "status": status,
            "progress": f"{count}/{total_untagged}",
        })

        if count < total_untagged and not _state["stop_flag"].is_set():
            time.sleep(delay)

    _autosave()
    _broadcast({"event": "done"})


def _broadcast(data):
    import queue
    dead = []
    for q in _state["progress_listeners"]:
        try:
            q.put_nowait(data)
        except queue.Full:
            dead.append(q)
    for q in dead:
        _state["progress_listeners"].remove(q)


# ---------------------------------------------------------------------------
# GET /api/tag/progress  (SSE)
# ---------------------------------------------------------------------------
@api.route("/api/tag/progress")
def tag_progress():
    import queue
    q = queue.Queue(maxsize=100)
    _state["progress_listeners"].append(q)

    def stream():
        try:
            while True:
                try:
                    data = q.get(timeout=30)
                except queue.Empty:
                    yield ":\n\n"  # keep-alive
                    continue
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("event") in ("done", "stopped"):
                    break
        finally:
            if q in _state["progress_listeners"]:
                _state["progress_listeners"].remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# POST /api/tag/stop
# ---------------------------------------------------------------------------
@api.route("/api/tag/stop", methods=["POST"])
def tag_stop():
    _state["stop_flag"].set()
    return jsonify({"stopped": True})


# ---------------------------------------------------------------------------
# POST /api/tag/<id>  (re-tag single track)
# ---------------------------------------------------------------------------
@api.route("/api/tag/<int:track_id>", methods=["POST"])
def tag_single(track_id):
    df = _state["df"]
    if df is None or track_id not in df.index:
        return jsonify({"error": "Track not found"}), 404

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    row = df.loc[track_id]

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
        df.at[track_id, "comment"] = comment
        result = {"id": track_id, "comment": comment}
        if detected_year:
            df.at[track_id, "year"] = int(detected_year)
            result["year"] = int(detected_year)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# PUT /api/track/<id>  (inline edit)
# ---------------------------------------------------------------------------
@api.route("/api/track/<int:track_id>", methods=["PUT"])
def update_track(track_id):
    df = _state["df"]
    if df is None or track_id not in df.index:
        return jsonify({"error": "Track not found"}), 404

    data = request.get_json()
    df.at[track_id, "comment"] = data.get("comment", "")
    return jsonify({"id": track_id, "comment": df.at[track_id, "comment"]})


# ---------------------------------------------------------------------------
# POST /api/track/<id>/clear
# ---------------------------------------------------------------------------
@api.route("/api/track/<int:track_id>/clear", methods=["POST"])
def clear_track(track_id):
    df = _state["df"]
    if df is None or track_id not in df.index:
        return jsonify({"error": "Track not found"}), 404

    df.at[track_id, "comment"] = ""
    return jsonify({"id": track_id, "comment": ""})


# ---------------------------------------------------------------------------
# POST /api/tracks/clear-all
# ---------------------------------------------------------------------------
@api.route("/api/tracks/clear-all", methods=["POST"])
def clear_all():
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400
    df["comment"] = ""
    return jsonify({"cleared": True})


# ---------------------------------------------------------------------------
# GET /api/export
# ---------------------------------------------------------------------------
@api.route("/api/export")
def export():
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)

    original = _state.get("original_filename", "playlist.csv")
    name = original.rsplit(".", 1)[0] + "_tagged.csv"

    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=name)


# ---------------------------------------------------------------------------
# GET/PUT /api/config   POST /api/config/reset
# ---------------------------------------------------------------------------
@api.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(load_config())


@api.route("/api/config", methods=["PUT"])
def update_config():
    data = request.get_json()
    config = load_config()
    config.update(data)
    save_config(config)
    return jsonify(config)


@api.route("/api/config/reset", methods=["POST"])
def reset_config():
    save_config(dict(DEFAULT_CONFIG))
    return jsonify(DEFAULT_CONFIG)


# ═══════════════════════════════════════════════════════════════════════════
# Playlist Workshop endpoints
# ═══════════════════════════════════════════════════════════════════════════

def _ensure_parsed():
    """Ensure facet columns exist on the DataFrame. Returns df or None."""
    df = _state["df"]
    if df is None:
        return None
    parse_all_comments(df)
    return df


def _safe_val(val):
    """Convert numpy/pandas types to JSON-safe Python types."""
    if pd.isna(val):
        return ""
    if hasattr(val, "item"):  # numpy scalar
        return val.item()
    return val


def _tracks_from_ids(df, ids):
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


def _get_analysis():
    """Return cached analysis data, computing if needed."""
    if _state["_analysis_cache"] is not None:
        return _state["_analysis_cache"]
    df = _ensure_parsed()
    if df is None:
        return None
    _state["_analysis_cache"] = {
        "cooccurrence": build_genre_cooccurrence(df),
        "landscape_summary": build_genre_landscape_summary(df),
        "facet_options": build_facet_options(df),
    }
    return _state["_analysis_cache"]


# ---------------------------------------------------------------------------
# GET /api/workshop/analysis
# ---------------------------------------------------------------------------
@api.route("/api/workshop/analysis")
def workshop_analysis():
    analysis = _get_analysis()
    if analysis is None:
        return jsonify({"error": "No file uploaded"}), 400
    return jsonify(analysis)


# ---------------------------------------------------------------------------
# GET /api/workshop/chord-data
# ---------------------------------------------------------------------------
@api.route("/api/workshop/chord-data")
def workshop_chord_data():
    """Build chord diagram data from tree lineages."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    tree_type = request.args.get("tree_type", "genre")
    threshold = float(request.args.get("threshold", "0.08"))
    max_lineages = int(request.args.get("max_lineages", "12"))

    # Load tree
    if tree_type == "scene":
        tree = _state.get("scene_tree") or load_tree(
            file_path=TREE_PROFILES["scene"]["file"])
        if tree:
            _state["scene_tree"] = tree
    else:
        tree = _state.get("tree") or load_tree()
        if tree:
            _state["tree"] = tree

    if not tree or not tree.get("lineages"):
        return jsonify({"error": f"No {tree_type} tree built yet. "
                        "Build one in the Collection Tree tab first."}), 404

    # Check cache
    cache_key = f"{tree_type}_{threshold}_{max_lineages}"
    cached = _state.get("_chord_cache")
    if cached and cached.get("_key") == cache_key:
        return jsonify(cached["data"])

    data = build_chord_data(df, tree, threshold=threshold,
                            max_lineages=max_lineages)
    _state["_chord_cache"] = {"_key": cache_key, "data": data}
    return jsonify(data)


# ---------------------------------------------------------------------------
# POST /api/workshop/search
# ---------------------------------------------------------------------------
@api.route("/api/workshop/search", methods=["POST"])
def workshop_search():
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    filters = request.get_json().get("filters", {})
    matching_ids = faceted_search(df, filters)

    tracks = _tracks_from_ids(df, matching_ids)
    return jsonify({"track_ids": [int(i) for i in matching_ids],
                    "count": len(matching_ids), "tracks": tracks})


# ---------------------------------------------------------------------------
# POST /api/workshop/scored-search
# ---------------------------------------------------------------------------
@api.route("/api/workshop/scored-search", methods=["POST"])
def workshop_scored_search():
    """Search tracks with relevance scoring instead of hard AND."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    body = request.get_json() or {}
    filters = body.get("filters", {})
    min_score = body.get("min_score", 0.15)
    max_results = body.get("max_results", 200)

    scored_results = scored_search(df, filters, min_score=min_score,
                                   max_results=max_results)

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

    return jsonify({
        "count": len(tracks),
        "tracks": tracks,
        "track_ids": [t["id"] for t in tracks],
    })


# ---------------------------------------------------------------------------
# POST /api/workshop/rerank
# ---------------------------------------------------------------------------
@api.route("/api/workshop/rerank", methods=["POST"])
def workshop_rerank():
    """LLM reranking of candidate tracks for a playlist."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    body = request.get_json() or {}
    candidate_tracks = body.get("tracks", [])
    playlist_name = body.get("playlist_name", "Untitled")
    description = body.get("description", "")
    target_count = body.get("target_count", 25)

    if not candidate_tracks:
        return jsonify({"error": "No candidate tracks provided"}), 400

    try:
        result = rerank_tracks(
            candidate_tracks, playlist_name, description,
            client, model, provider, target_count
        )

        # Enrich reranked tracks with full track data
        reranked_ids = [t["id"] for t in result["tracks"]]
        reason_map = {t["id"]: t["reason"] for t in result["tracks"]}
        enriched_tracks = _tracks_from_ids(df, reranked_ids)

        for t in enriched_tracks:
            t["reason"] = reason_map.get(t["id"], "")

        return jsonify({
            "tracks": enriched_tracks,
            "track_ids": reranked_ids,
            "flow_notes": result["flow_notes"],
            "count": len(enriched_tracks),
        })
    except Exception as e:
        logging.exception("LLM reranking failed")
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# POST /api/workshop/suggest
# ---------------------------------------------------------------------------
@api.route("/api/workshop/suggest", methods=["POST"])
def workshop_suggest():
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    analysis = _get_analysis()
    landscape = analysis["landscape_summary"]

    body = request.get_json() or {}
    mode = body.get("mode", "explore")
    num = body.get("num_suggestions", 6 if mode == "explore" else 3)

    try:
        if mode == "vibe":
            vibe_text = body.get("vibe_text", "")
            if not vibe_text.strip():
                return jsonify({"error": "vibe_text is required for vibe mode"}), 400
            suggestions = generate_vibe_suggestions(
                landscape, vibe_text, client, model, provider, num
            )
        elif mode == "seed":
            seed_ids = body.get("seed_track_ids", [])
            if not seed_ids:
                return jsonify({"error": "seed_track_ids is required for seed mode"}), 400
            seed_tracks = _tracks_from_ids(df, seed_ids)
            seed_details = "\n".join(
                f"- {t.get('artist', '?')} — {t.get('title', '?')} "
                f"(BPM: {t.get('bpm', '?')}, Key: {t.get('key', '?')}, "
                f"Comment: {t.get('comment', '')})"
                for t in seed_tracks
            )
            suggestions = generate_seed_suggestions(
                landscape, seed_details, client, model, provider, num
            )
        elif mode == "intersection":
            genre1 = body.get("genre1", "")
            genre2 = body.get("genre2", "")
            if not genre1 or not genre2:
                return jsonify({"error": "genre1 and genre2 required for intersection mode"}), 400
            # Count intersection tracks
            intersection_ids = faceted_search(df, {"genres": [genre1, genre2]})
            suggestions = generate_intersection_suggestions(
                landscape, genre1, genre2, len(intersection_ids),
                client, model, provider, num
            )
        elif mode == "chord-intersection":
            l1_title = body.get("lineage1_title", "")
            l2_title = body.get("lineage2_title", "")
            l1_filters = body.get("lineage1_filters", {})
            l2_filters = body.get("lineage2_filters", {})
            if not l1_title or not l2_title:
                return jsonify({"error": "lineage titles required"}), 400
            # Find tracks scoring well for both lineages
            r1 = scored_search(df, l1_filters, min_score=0.08,
                               max_results=len(df))
            r2 = scored_search(df, l2_filters, min_score=0.08,
                               max_results=len(df))
            shared = {i for i, _, _ in r1} & {i for i, _, _ in r2}
            suggestions = generate_intersection_suggestions(
                landscape, l1_title, l2_title, len(shared),
                client, model, provider, num
            )
        else:
            # Default: explore mode
            suggestions = generate_playlist_suggestions(
                landscape, client, model, provider, num
            )
    except Exception as e:
        logging.exception("Playlist suggestion generation failed")
        return jsonify({"error": str(e)}), 500

    # Enrich each suggestion with track count and samples (using scored search)
    for s in suggestions:
        try:
            scored_results = scored_search(df, s["filters"], min_score=0.1,
                                           max_results=100)
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

    return jsonify({"suggestions": suggestions})


# ---------------------------------------------------------------------------
# Playlist CRUD
# ---------------------------------------------------------------------------

@api.route("/api/workshop/playlists")
def workshop_list_playlists():
    return jsonify({"playlists": list_playlists()})


@api.route("/api/workshop/playlists", methods=["POST"])
def workshop_create_playlist():
    data = request.get_json()
    name = data.get("name", "Untitled Playlist")
    description = data.get("description", "")
    filters = data.get("filters")
    source = data.get("source", "manual")

    # If filters provided, run the search to populate track_ids
    track_ids = data.get("track_ids")
    if track_ids is None and filters:
        df = _ensure_parsed()
        if df is not None:
            track_ids = faceted_search(df, filters)

    playlist = create_playlist(name, description, filters, track_ids, source)
    return jsonify({"playlist": playlist}), 201


@api.route("/api/workshop/playlists/smart-create", methods=["POST"])
def workshop_smart_create_playlist():
    """Create a playlist using scored search + LLM reranking for curation."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    data = request.get_json()
    name = data.get("name", "Untitled Playlist")
    description = data.get("description", "")
    filters = data.get("filters")
    target_count = data.get("target_count", 25)

    if not filters:
        return jsonify({"error": "Filters are required for smart create"}), 400

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)

    # Step 1: Scored search to find candidates
    scored_results = scored_search(df, filters, min_score=0.1, max_results=80)

    if not scored_results:
        # Fallback: create empty playlist
        playlist = create_playlist(name, description, filters, [], "llm")
        return jsonify({"playlist": playlist, "method": "empty"}), 201

    # Step 2: Build candidate track data for LLM
    candidate_ids = [r[0] for r in scored_results]
    candidates = _tracks_from_ids(df, candidate_ids)

    # Step 3: LLM reranking
    try:
        result = rerank_tracks(
            candidates, name, description,
            client, model, provider, target_count
        )
        reranked_ids = [t["id"] for t in result["tracks"]]
        # Filter to only valid IDs that exist in df
        valid_ids = [tid for tid in reranked_ids if tid in df.index]
        method = "smart"
    except Exception:
        logging.exception("LLM reranking failed during smart create, falling back to scored results")
        # Fallback: use top scored results
        valid_ids = [int(r[0]) for r in scored_results[:target_count]]
        method = "scored_fallback"

    playlist = create_playlist(name, description, filters, valid_ids, "llm")
    return jsonify({"playlist": playlist, "method": method}), 201


@api.route("/api/workshop/playlists/<playlist_id>")
def workshop_get_playlist(playlist_id):
    p = get_playlist(playlist_id)
    if not p:
        return jsonify({"error": "Playlist not found"}), 404

    df = _state["df"]
    playlist_tracks = _tracks_from_ids(df, p["track_ids"]) if df is not None else []
    return jsonify({"playlist": p, "tracks": playlist_tracks})


@api.route("/api/workshop/playlists/<playlist_id>", methods=["PUT"])
def workshop_update_playlist(playlist_id):
    data = request.get_json()
    p = update_playlist(playlist_id, data)
    if not p:
        return jsonify({"error": "Playlist not found"}), 404
    return jsonify({"playlist": p})


@api.route("/api/workshop/playlists/<playlist_id>", methods=["DELETE"])
def workshop_delete_playlist(playlist_id):
    if delete_playlist(playlist_id):
        return jsonify({"deleted": True})
    return jsonify({"error": "Playlist not found"}), 404


@api.route("/api/workshop/playlists/<playlist_id>/tracks", methods=["POST"])
def workshop_add_tracks(playlist_id):
    data = request.get_json()
    track_ids = data.get("track_ids", [])
    p = add_tracks_to_playlist(playlist_id, track_ids)
    if not p:
        return jsonify({"error": "Playlist not found"}), 404
    return jsonify({"playlist": p})


@api.route("/api/workshop/playlists/<playlist_id>/tracks", methods=["DELETE"])
def workshop_remove_tracks(playlist_id):
    data = request.get_json()
    track_ids = data.get("track_ids", [])
    p = remove_tracks_from_playlist(playlist_id, track_ids)
    if not p:
        return jsonify({"error": "Playlist not found"}), 404
    return jsonify({"playlist": p})


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@api.route("/api/workshop/playlists/<playlist_id>/export/m3u")
def workshop_export_m3u(playlist_id):
    """Export playlist as .m3u8 (UTF-8 M3U, Lexicon-compatible)."""
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    content = export_m3u(playlist_id, df)
    if content is None:
        return jsonify({"error": "Playlist not found"}), 404

    p = get_playlist(playlist_id)
    name = (p["name"] if p else "playlist").replace(" ", "_")

    buf = io.BytesIO(content.encode("utf-8"))
    return send_file(buf, mimetype="audio/x-mpegurl", as_attachment=True,
                     download_name=f"{name}.m3u8")


@api.route("/api/workshop/playlists/<playlist_id>/export/csv")
def workshop_export_csv(playlist_id):
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    buf = export_csv(playlist_id, df)
    if buf is None:
        return jsonify({"error": "Playlist not found"}), 404

    p = get_playlist(playlist_id)
    name = (p["name"] if p else "playlist").replace(" ", "_")

    return send_file(buf, mimetype="text/csv", as_attachment=True,
                     download_name=f"{name}.csv")


# ═══════════════════════════════════════════════════════════════════════════
# Collection Tree endpoints
# ═══════════════════════════════════════════════════════════════════════════

def _tree_broadcast(data, listeners_key="tree_progress_listeners"):
    import queue
    dead = []
    for q in _state[listeners_key]:
        try:
            q.put_nowait(data)
        except queue.Full:
            dead.append(q)
    for q in dead:
        _state[listeners_key].remove(q)


# ---------------------------------------------------------------------------
# GET /api/tree
# ---------------------------------------------------------------------------
@api.route("/api/tree")
def get_tree():
    tree = _state.get("tree")
    if tree is None:
        tree = load_tree()
        if tree:
            _state["tree"] = tree
    if tree is None:
        return jsonify({"tree": None})
    return jsonify({"tree": tree})


# ---------------------------------------------------------------------------
# POST /api/tree/build
# ---------------------------------------------------------------------------
@api.route("/api/tree/build", methods=["POST"])
def tree_build():
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    # Check if already building
    t = _state.get("tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Tree build already in progress"}), 409

    _state["tree_stop_flag"].clear()
    _state["tree"] = None

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            tree = build_collection_tree(
                df=df,
                client=client,
                model=model,
                provider=provider,
                delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["tree_stop_flag"],
            )
            _state["tree"] = tree
            _tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Tree build failed")
            _tree_broadcast({"event": "error", "phase": "error",
                             "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["tree_thread"] = thread
    thread.start()

    return jsonify({"started": True}), 202


# ---------------------------------------------------------------------------
# GET /api/tree/progress  (SSE)
# ---------------------------------------------------------------------------
@api.route("/api/tree/progress")
def tree_progress():
    import queue
    q = queue.Queue(maxsize=100)
    _state["tree_progress_listeners"].append(q)

    def stream():
        try:
            while True:
                try:
                    data = q.get(timeout=30)
                except queue.Empty:
                    yield ":\n\n"  # keep-alive
                    continue
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("event") in ("done", "error", "stopped"):
                    break
        finally:
            if q in _state["tree_progress_listeners"]:
                _state["tree_progress_listeners"].remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# POST /api/tree/stop
# ---------------------------------------------------------------------------
@api.route("/api/tree/stop", methods=["POST"])
def tree_stop():
    _state["tree_stop_flag"].set()
    return jsonify({"stopped": True})


# ---------------------------------------------------------------------------
# POST /api/tree/expand-ungrouped
# ---------------------------------------------------------------------------
@api.route("/api/tree/expand-ungrouped", methods=["POST"])
def tree_expand_ungrouped():
    """Create new lineage(s) from ungrouped tracks and merge into the tree."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    ungrouped = tree.get("ungrouped_track_ids", [])
    if not ungrouped:
        return jsonify({"error": "No ungrouped tracks to process"}), 400

    # Check if already building
    t = _state.get("tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Tree operation already in progress"}), 409

    _state["tree_stop_flag"].clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            updated_tree = expand_tree_from_ungrouped(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["tree_stop_flag"],
            )
            _state["tree"] = updated_tree
            _tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Expand ungrouped failed")
            _tree_broadcast({"event": "error", "phase": "error",
                             "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["tree_thread"] = thread
    thread.start()

    return jsonify({"started": True, "ungrouped_count": len(ungrouped)}), 202


# ---------------------------------------------------------------------------
# POST /api/tree/refresh-examples
# ---------------------------------------------------------------------------
@api.route("/api/tree/refresh-examples", methods=["POST"])
def tree_refresh_examples():
    """Re-run exemplar track selection for all nodes (extends to 7 per node)."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    t = _state.get("tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Tree operation already in progress"}), 409

    _state["tree_stop_flag"].clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            updated = refresh_all_examples(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["tree_stop_flag"],
            )
            _state["tree"] = updated
            _tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Refresh examples failed")
            _tree_broadcast({"event": "error", "phase": "error",
                             "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["tree_thread"] = thread
    thread.start()

    return jsonify({"started": True}), 202


# ---------------------------------------------------------------------------
# GET /api/tree/ungrouped
# ---------------------------------------------------------------------------
@api.route("/api/tree/ungrouped")
def tree_ungrouped():
    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    ungrouped_ids = tree.get("ungrouped_track_ids", [])
    tracks = _tracks_from_ids(df, ungrouped_ids)
    return jsonify({"count": len(tracks), "tracks": tracks})


# ---------------------------------------------------------------------------
# POST /api/tree/create-playlist
# ---------------------------------------------------------------------------
@api.route("/api/tree/create-playlist", methods=["POST"])
def tree_create_playlist():
    """Create a Workshop playlist from a tree leaf using smart-create (LLM rerank)."""
    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    data = request.get_json()
    node_id = data.get("node_id")
    if not node_id:
        return jsonify({"error": "node_id is required"}), 400

    node = find_node(tree, node_id)
    if not node:
        return jsonify({"error": f"Node '{node_id}' not found"}), 404

    track_ids = node.get("track_ids", [])
    name = node.get("title", "Untitled")
    description = node.get("description", "")
    filters = node.get("filters", {})

    # Smart-create: LLM reranks to pick best 25 in playback order
    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    target_count = min(25, len(track_ids))

    # Build candidate list from the node's assigned tracks
    valid_ids = [tid for tid in track_ids if tid in df.index]
    candidates = _tracks_from_ids(df, valid_ids[:80])  # cap at 80 for LLM context

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
            logging.exception("LLM rerank failed for tree leaf, using direct track list")
            final_ids = valid_ids[:target_count]
            method = "scored_fallback"

    playlist = create_playlist(name, description, filters, final_ids, "tree")
    return jsonify({"playlist": playlist, "method": method}), 201


# ---------------------------------------------------------------------------
# POST /api/tree/create-all-playlists
# ---------------------------------------------------------------------------
@api.route("/api/tree/create-all-playlists", methods=["POST"])
def tree_create_all_playlists():
    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    # Collect all leaf nodes
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
            source="tree",
        )
        created.append(playlist)

    return jsonify({"playlists": created, "count": len(created)}), 201


def _collect_tree_leaves(node, result):
    """Recursively collect leaf nodes from a tree node."""
    if node.get("is_leaf") or not node.get("children"):
        result.append(node)
    else:
        for child in node["children"]:
            _collect_tree_leaves(child, result)


# ---------------------------------------------------------------------------
# GET /api/tree/node/<node_id>/export/m3u
# ---------------------------------------------------------------------------
@api.route("/api/tree/node/<node_id>/export/m3u")
def tree_node_export_m3u(node_id):
    """Export any tree node's tracks as .m3u8 (works for lineages, branches, leaves)."""
    tree = _state.get("tree") or load_tree()
    if not tree:
        return jsonify({"error": "No tree built"}), 404

    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    node = find_node(tree, node_id)
    if not node:
        return jsonify({"error": f"Node '{node_id}' not found"}), 404

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
    return send_file(buf, mimetype="audio/x-mpegurl", as_attachment=True,
                     download_name=f"{name}.m3u8")


# ---------------------------------------------------------------------------
# DELETE /api/tree
# ---------------------------------------------------------------------------
@api.route("/api/tree", methods=["DELETE"])
def tree_delete():
    _state["tree"] = None
    deleted = delete_tree_file()
    return jsonify({"deleted": deleted})


# ═══════════════════════════════════════════════════════════════════════════
# Scene Tree endpoints (mirrors genre tree with scene-specific state/profile)
# ═══════════════════════════════════════════════════════════════════════════

_SCENE_PROFILE = TREE_PROFILES["scene"]


def _scene_tree_broadcast(data):
    _tree_broadcast(data, listeners_key="scene_tree_progress_listeners")


# ---------------------------------------------------------------------------
# GET /api/scene-tree
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree")
def get_scene_tree():
    tree = _state.get("scene_tree")
    if tree is None:
        tree = load_tree(file_path=_SCENE_PROFILE["file"])
        if tree:
            _state["scene_tree"] = tree
    if tree is None:
        return jsonify({"tree": None})
    return jsonify({"tree": tree})


# ---------------------------------------------------------------------------
# POST /api/scene-tree/build
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/build", methods=["POST"])
def scene_tree_build():
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    t = _state.get("scene_tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Scene tree build already in progress"}), 409

    _state["scene_tree_stop_flag"].clear()
    _state["scene_tree"] = None

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _scene_tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            tree = build_collection_tree(
                df=df,
                client=client,
                model=model,
                provider=provider,
                delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["scene_tree_stop_flag"],
                tree_type="scene",
            )
            _state["scene_tree"] = tree
            _scene_tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Scene tree build failed")
            _scene_tree_broadcast({"event": "error", "phase": "error",
                                   "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["scene_tree_thread"] = thread
    thread.start()

    return jsonify({"started": True}), 202


# ---------------------------------------------------------------------------
# GET /api/scene-tree/progress  (SSE)
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/progress")
def scene_tree_progress():
    import queue
    q = queue.Queue(maxsize=100)
    _state["scene_tree_progress_listeners"].append(q)

    def stream():
        try:
            while True:
                try:
                    data = q.get(timeout=30)
                except queue.Empty:
                    yield ":\n\n"
                    continue
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("event") in ("done", "error", "stopped"):
                    break
        finally:
            if q in _state["scene_tree_progress_listeners"]:
                _state["scene_tree_progress_listeners"].remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# POST /api/scene-tree/stop
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/stop", methods=["POST"])
def scene_tree_stop():
    _state["scene_tree_stop_flag"].set()
    return jsonify({"stopped": True})


# ---------------------------------------------------------------------------
# POST /api/scene-tree/expand-ungrouped
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/expand-ungrouped", methods=["POST"])
def scene_tree_expand_ungrouped():
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

    ungrouped = tree.get("ungrouped_track_ids", [])
    if not ungrouped:
        return jsonify({"error": "No ungrouped tracks to process"}), 400

    t = _state.get("scene_tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Scene tree operation already in progress"}), 409

    _state["scene_tree_stop_flag"].clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _scene_tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            updated_tree = expand_tree_from_ungrouped(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["scene_tree_stop_flag"],
                tree_type="scene",
            )
            _state["scene_tree"] = updated_tree
            _scene_tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Scene tree expand ungrouped failed")
            _scene_tree_broadcast({"event": "error", "phase": "error",
                                   "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["scene_tree_thread"] = thread
    thread.start()

    return jsonify({"started": True, "ungrouped_count": len(ungrouped)}), 202


# ---------------------------------------------------------------------------
# POST /api/scene-tree/refresh-examples
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/refresh-examples", methods=["POST"])
def scene_tree_refresh_examples():
    """Re-run exemplar track selection for all scene tree nodes."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

    t = _state.get("scene_tree_thread")
    if t and t.is_alive():
        return jsonify({"error": "Scene tree operation already in progress"}), 409

    _state["scene_tree_stop_flag"].clear()

    config = load_config()
    model = config.get("model", "gpt-4")
    provider = _provider_for_model(model)
    client = _get_client(provider)
    delay = config.get("delay_between_requests", 1.5)

    def progress_callback(phase, detail, pct):
        _scene_tree_broadcast({
            "event": "progress",
            "phase": phase,
            "detail": detail,
            "percent": pct,
        })

    def worker():
        try:
            updated = refresh_all_examples(
                tree=tree, df=df, client=client, model=model,
                provider=provider, delay=delay,
                progress_cb=progress_callback,
                stop_flag=_state["scene_tree_stop_flag"],
                tree_type="scene",
            )
            _state["scene_tree"] = updated
            _scene_tree_broadcast({"event": "done", "phase": "complete", "percent": 100})
        except Exception as e:
            logging.exception("Scene tree refresh examples failed")
            _scene_tree_broadcast({"event": "error", "phase": "error",
                                   "detail": str(e), "percent": 0})

    thread = threading.Thread(target=worker, daemon=True)
    _state["scene_tree_thread"] = thread
    thread.start()

    return jsonify({"started": True}), 202


# ---------------------------------------------------------------------------
# GET /api/scene-tree/ungrouped
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/ungrouped")
def scene_tree_ungrouped():
    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    ungrouped_ids = tree.get("ungrouped_track_ids", [])
    tracks = _tracks_from_ids(df, ungrouped_ids)
    return jsonify({"count": len(tracks), "tracks": tracks})


# ---------------------------------------------------------------------------
# POST /api/scene-tree/create-playlist
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/create-playlist", methods=["POST"])
def scene_tree_create_playlist():
    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    data = request.get_json()
    node_id = data.get("node_id")
    if not node_id:
        return jsonify({"error": "node_id is required"}), 400

    node = find_node(tree, node_id)
    if not node:
        return jsonify({"error": f"Node '{node_id}' not found"}), 404

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
            logging.exception("LLM rerank failed for scene tree leaf")
            final_ids = valid_ids[:target_count]
            method = "scored_fallback"

    playlist = create_playlist(name, description, filters, final_ids, "scene-tree")
    return jsonify({"playlist": playlist, "method": method}), 201


# ---------------------------------------------------------------------------
# POST /api/scene-tree/create-all-playlists
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/create-all-playlists", methods=["POST"])
def scene_tree_create_all_playlists():
    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

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
            source="scene-tree",
        )
        created.append(playlist)

    return jsonify({"playlists": created, "count": len(created)}), 201


# ---------------------------------------------------------------------------
# GET /api/scene-tree/node/<node_id>/export/m3u
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree/node/<node_id>/export/m3u")
def scene_tree_node_export_m3u(node_id):
    tree = _state.get("scene_tree") or load_tree(file_path=_SCENE_PROFILE["file"])
    if not tree:
        return jsonify({"error": "No scene tree built"}), 404

    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    node = find_node(tree, node_id)
    if not node:
        return jsonify({"error": f"Node '{node_id}' not found"}), 404

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
    return send_file(buf, mimetype="audio/x-mpegurl", as_attachment=True,
                     download_name=f"{name}.m3u8")


# ---------------------------------------------------------------------------
# DELETE /api/scene-tree
# ---------------------------------------------------------------------------
@api.route("/api/scene-tree", methods=["DELETE"])
def scene_tree_delete():
    _state["scene_tree"] = None
    deleted = delete_tree_file(file_path=_SCENE_PROFILE["file"])
    return jsonify({"deleted": deleted})


# ---------------------------------------------------------------------------
# GET /api/preview — Deezer 30-second track preview
# ---------------------------------------------------------------------------
@api.route("/api/preview")
def get_preview():
    artist = request.args.get("artist", "").strip()
    title = request.args.get("title", "").strip()
    if not artist or not title:
        return jsonify({"error": "artist and title are required"}), 400

    cache_key = f"{artist.lower()}||{title.lower()}"
    cached = _state["_preview_cache"].get(cache_key)
    if cached is not None:
        return jsonify(cached)

    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://api.deezer.com/search?q={query}&limit=5"
    result = {"preview_url": None, "found": False}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tracks = data.get("data", [])
        if tracks:
            best = None
            a_low, t_low = artist.lower(), title.lower()
            for t in tracks:
                d_artist = (t.get("artist", {}).get("name") or "").lower()
                d_title = (t.get("title") or "").lower()
                if (a_low in d_artist or d_artist in a_low) and \
                   (t_low in d_title or d_title in t_low):
                    best = t
                    break
            if best is None:
                best = tracks[0]

            preview = best.get("preview", "")
            album = best.get("album", {})
            cover = album.get("cover_small", "")
            cover_big = album.get("cover_big", "") or album.get("cover_medium", "") or cover
            if preview:
                result = {
                    "preview_url": preview,
                    "found": True,
                    "deezer_title": best.get("title", ""),
                    "deezer_artist": best.get("artist", {}).get("name", ""),
                    "cover_url": cover,
                    "cover_big": cover_big,
                }
            elif cover:
                result = {**result, "cover_url": cover, "cover_big": cover_big}
    except Exception:
        logging.exception("Deezer search failed for %s - %s", artist, title)
        return jsonify(result)

    _state["_preview_cache"][cache_key] = result
    return jsonify(result)


# ---------------------------------------------------------------------------
# GET /api/artwork — Lightweight album cover lookup (separate cache)
# ---------------------------------------------------------------------------
def _lookup_artwork(artist, title):
    """Look up artwork for a single track. Returns dict with cover_url/found."""
    cache_key = f"{artist.lower()}||{title.lower()}"
    cached = _state["_artwork_cache"].get(cache_key)
    if cached is not None:
        return cached

    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://api.deezer.com/search?q={query}&limit=5"
    result = {"cover_url": "", "found": False}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tracks = data.get("data", [])
        if tracks:
            best = None
            a_low, t_low = artist.lower(), title.lower()
            for t in tracks:
                d_artist = (t.get("artist", {}).get("name") or "").lower()
                d_title = (t.get("title") or "").lower()
                if (a_low in d_artist or d_artist in a_low) and \
                   (t_low in d_title or d_title in t_low):
                    best = t
                    break
            if best is None:
                best = tracks[0]

            album = best.get("album", {})
            cover = album.get("cover_small", "")
            cover_big = album.get("cover_big", "") or album.get("cover_medium", "") or cover
            if cover:
                result = {"cover_url": cover, "cover_big": cover_big, "found": True}
    except Exception:
        logging.exception("Deezer artwork lookup failed for %s - %s", artist, title)
        return result

    _state["_artwork_cache"][cache_key] = result
    return result


_artwork_cache_dirty = 0          # count of unsaved new lookups

@api.route("/api/artwork")
def get_artwork():
    global _artwork_cache_dirty
    artist = request.args.get("artist", "").strip()
    title = request.args.get("title", "").strip()
    if not artist or not title:
        return jsonify({"cover_url": None, "found": False}), 400

    cache_key = f"{artist.lower()}||{title.lower()}"
    was_cached = cache_key in _state["_artwork_cache"]
    result = _lookup_artwork(artist, title)
    if not was_cached:
        _artwork_cache_dirty += 1
        if _artwork_cache_dirty >= 10:         # batch-save every 10 new entries
            _save_artwork_cache()
            _artwork_cache_dirty = 0
    resp = jsonify(result)
    resp.headers["Cache-Control"] = "public, max-age=86400"   # 24h browser cache
    return resp


# POST /api/artwork/batch — Batch artwork lookup (reduces HTTP roundtrips)
# ---------------------------------------------------------------------------
@api.route("/api/artwork/batch", methods=["POST"])
def get_artwork_batch():
    items = request.get_json(silent=True) or []
    if not isinstance(items, list) or len(items) > 50:
        return jsonify({"error": "Expected a JSON array (max 50)"}), 400

    # Separate cached from uncached
    results = {}
    uncached = []     # (key, artist, title)
    for item in items:
        artist = (item.get("artist") or "").strip()
        title = (item.get("title") or "").strip()
        if not artist or not title:
            continue
        key = f"{artist.lower()}||{title.lower()}"
        cached = _state["_artwork_cache"].get(key)
        if cached is not None:
            results[key] = cached
        else:
            uncached.append((key, artist, title))

    # Fetch uncached items in parallel (max 8 concurrent Deezer calls)
    if uncached:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_lookup_artwork, artist, title): key
                for key, artist, title in uncached
            }
            for fut in as_completed(futures):
                key = futures[fut]
                try:
                    results[key] = fut.result()
                except Exception:
                    results[key] = {"cover_url": "", "found": False}
        _save_artwork_cache()

    resp = jsonify(results)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# ---------------------------------------------------------------------------
# Artwork cache warm-up (background)
# ---------------------------------------------------------------------------
_warm_cache_state = {
    "running": False,
    "total": 0,
    "done": 0,
    "found": 0,
    "skipped": 0,       # already cached
}

def _warm_cache_worker():
    """Background thread: look up artwork for every track in the DataFrame."""
    st = _warm_cache_state
    try:
        df = _state.get("df")
        if df is None or "artist" not in df.columns or "title" not in df.columns:
            st["running"] = False
            return

        # Build unique (artist, title) pairs not yet cached
        pairs = []
        seen = set()
        for _, row in df.iterrows():
            artist = str(row.get("artist") or "").strip()
            title = str(row.get("title") or "").strip()
            if not artist or not title:
                continue
            key = f"{artist.lower()}||{title.lower()}"
            if key in seen:
                continue
            seen.add(key)
            if key in _state["_artwork_cache"]:
                st["skipped"] += 1
                continue
            pairs.append((key, artist, title))

        st["total"] = len(pairs) + st["skipped"]
        st["done"] = st["skipped"]

        # Process in batches of 8 with a small delay to avoid rate-limiting
        BATCH = 8
        for i in range(0, len(pairs), BATCH):
            if not st["running"]:
                break
            chunk = pairs[i:i + BATCH]
            with ThreadPoolExecutor(max_workers=BATCH) as pool:
                futures = {
                    pool.submit(_lookup_artwork, artist, title): key
                    for key, artist, title in chunk
                }
                for fut in as_completed(futures):
                    key = futures[fut]
                    try:
                        result = fut.result()
                        if result.get("cover_url"):
                            st["found"] += 1
                    except Exception:
                        pass
                    st["done"] += 1
            # Save every 50 lookups and throttle
            if (i // BATCH) % 6 == 5:
                _save_artwork_cache()
            time.sleep(0.3)                       # small delay between batches

        _save_artwork_cache()
    except Exception:
        logging.exception("Artwork warm-cache failed")
    finally:
        st["running"] = False


@api.route("/api/artwork/warm-cache", methods=["POST"])
def start_warm_cache():
    if _warm_cache_state["running"]:
        return jsonify({"status": "already_running", **_warm_cache_state})
    _warm_cache_state.update(running=True, total=0, done=0, found=0, skipped=0)
    t = threading.Thread(target=_warm_cache_worker, daemon=True)
    t.start()
    return jsonify({"status": "started"})


@api.route("/api/artwork/warm-cache/status")
def warm_cache_status():
    return jsonify(_warm_cache_state)


@api.route("/api/artwork/uncached-count")
def uncached_count():
    """Quick check: how many tracks have no cached artwork lookup."""
    df = _state.get("df")
    if df is None or "artist" not in df.columns:
        return jsonify({"uncached": 0})
    seen = set()
    uncached = 0
    for _, row in df.iterrows():
        artist = str(row.get("artist") or "").strip()
        title = str(row.get("title") or "").strip()
        if not artist or not title:
            continue
        key = f"{artist.lower()}||{title.lower()}"
        if key in seen:
            continue
        seen.add(key)
        if key not in _state["_artwork_cache"]:
            uncached += 1
    return jsonify({"uncached": uncached, "total": len(seen)})


# ═══════════════════════════════════════════════════════════════════════════
# Set Workshop
# ═══════════════════════════════════════════════════════════════════════════

def _resolve_tree(tree_type):
    """Helper: load genre or scene tree from state or disk."""
    if tree_type == "scene":
        return _state.get("scene_tree") or load_tree(
            file_path=TREE_PROFILES["scene"]["file"])
    return _state.get("tree") or load_tree()


@api.route("/api/set-workshop/sources")
def set_workshop_sources():
    """Return available sources for the drawer's browse mode."""
    search = request.args.get("search", "")
    genre_tree = _state.get("tree") or load_tree()
    scene_tree = _state.get("scene_tree") or load_tree(
        file_path=TREE_PROFILES["scene"]["file"])
    result = get_browse_sources(genre_tree, scene_tree, search)
    return jsonify(result)


@api.route("/api/set-workshop/assign-source", methods=["POST"])
def set_workshop_assign_source():
    """Assign a source to a slot — returns 10 tracks (one per BPM level)."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    body = request.get_json() or {}
    source_type = body.get("source_type", "playlist")
    source_id = body.get("source_id", "")
    tree_type = body.get("tree_type", "genre")
    used_ids = set(body.get("used_track_ids", []))
    anchor_track_id = body.get("anchor_track_id")

    tree = _resolve_tree(tree_type) if source_type == "tree_node" else None

    # Resolve track IDs and source info
    if source_type == "adhoc":
        track_ids = body.get("track_ids", [])
        info = {"id": source_id, "name": body.get("name", "Ad-hoc"),
                "description": "", "track_count": len(track_ids), "examples": []}
    else:
        info = get_source_info(source_type, source_id, tree)
        if not info:
            return jsonify({"error": "Source not found"}), 404
        track_ids = get_source_tracks(source_type, source_id, tree)

    if not track_ids:
        return jsonify({"error": "Source has no tracks"}), 400

    tracks = select_tracks_for_source(
        df, track_ids,
        used_track_ids=used_ids,
        anchor_track_id=anchor_track_id,
        has_audio_fn=_check_has_audio,
    )

    return jsonify({"source": info, "tracks": tracks})


@api.route("/api/set-workshop/drag-track", methods=["POST"])
def set_workshop_drag_track():
    """Handle dragging a track into a slot: place it, fill remaining BPM levels."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    body = request.get_json() or {}
    track_id = body.get("track_id")
    source_type = body.get("source_type", "playlist")
    source_id = body.get("source_id", "")
    tree_type = body.get("tree_type", "genre")
    used_ids = set(body.get("used_track_ids", []))

    tree = _resolve_tree(tree_type) if source_type == "tree_node" else None

    if source_type == "adhoc":
        track_ids = body.get("track_ids", [])
    else:
        track_ids = get_source_tracks(source_type, source_id, tree)

    if not track_ids:
        return jsonify({"error": "Source has no tracks"}), 400

    tracks = select_tracks_for_source(
        df, track_ids,
        used_track_ids=used_ids,
        anchor_track_id=track_id,
        has_audio_fn=_check_has_audio,
    )

    # Get source info for name
    if source_type == "adhoc":
        info = {"id": source_id, "name": body.get("name", "Ad-hoc"),
                "description": "", "track_count": len(track_ids), "examples": []}
    else:
        info = get_source_info(source_type, source_id, tree)

    return jsonify({"source": info, "tracks": tracks})


@api.route("/api/set-workshop/source-detail")
def set_workshop_source_detail():
    """Get detailed info + all tracks for a source (drawer detail view)."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    source_type = request.args.get("source_type", "playlist")
    source_id = request.args.get("source_id", "")
    tree_type = request.args.get("tree_type", "genre")

    tree = _resolve_tree(tree_type) if source_type == "tree_node" else None
    detail = get_source_detail(df, source_type, source_id, tree,
                               has_audio_fn=_check_has_audio)
    if not detail:
        return jsonify({"error": "Source not found"}), 404

    return jsonify(detail)


@api.route("/api/set-workshop/track-search", methods=["POST"])
def set_workshop_track_search():
    """Search tracks by title or artist keyword for the drawer search mode."""
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    body = request.get_json() or {}
    query = (body.get("query") or "").strip()
    if not query or len(query) < 2:
        return jsonify({"tracks": [], "count": 0})

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
    return jsonify({"tracks": tracks, "count": len(tracks)})


@api.route("/api/set-workshop/track-context/<int:track_id>")
def set_workshop_track_context(track_id):
    """Return 3-card context (similar, genre leaf, scene leaf) for a track."""
    df = _ensure_parsed()
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    if track_id not in df.index:
        return jsonify({"error": "Track not found"}), 404

    genre_tree = _state.get("tree") or load_tree()
    scene_tree = _state.get("scene_tree") or load_tree(
        file_path=TREE_PROFILES["scene"]["file"])

    result = build_track_context(df, track_id, genre_tree, scene_tree)
    if not result:
        return jsonify({"error": "Track not found"}), 404

    return jsonify(result)


@api.route("/api/set-workshop/check-audio", methods=["POST"])
def set_workshop_check_audio():
    """Check which track IDs have playable audio (Dropbox or local)."""
    df = _state["df"]
    if df is None:
        return jsonify({}), 200
    body = request.get_json() or {}
    track_ids = body.get("track_ids", [])
    result = {}
    for tid in track_ids:
        tid = int(tid)
        if tid not in df.index:
            result[str(tid)] = False
            continue
        raw_loc = str(df.loc[tid].get("location", ""))
        result[str(tid)] = _check_has_audio(raw_loc)
    return jsonify(result)


@api.route("/api/set-workshop/state", methods=["GET"])
def set_workshop_get_state():
    """Load saved set workshop state."""
    state = load_set_state()
    if state:
        return jsonify(state)
    return jsonify(None)


@api.route("/api/set-workshop/state", methods=["POST"])
def set_workshop_save_state():
    """Save set workshop state."""
    body = request.get_json()
    if body is None:
        return jsonify({"error": "No data"}), 400
    save_set_state(body)
    return jsonify({"ok": True})


@api.route("/api/set-workshop/export-m3u", methods=["POST"])
def set_workshop_export_m3u():
    """Export the selected tracks from a set as an M3U playlist."""
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400

    body = request.get_json() or {}
    slot_selections = body.get("slots", [])
    set_name = body.get("name", "DJ_Set")

    lines = ["#EXTM3U", f"#PLAYLIST:{set_name}"]
    for slot in slot_selections:
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
    safe_name = set_name.replace(" ", "_")
    buf = io.BytesIO(content.encode("utf-8"))
    return send_file(buf, mimetype="audio/x-mpegurl", as_attachment=True,
                     download_name=f"{safe_name}.m3u8")


# ---------------------------------------------------------------------------
# Saved Sets CRUD
# ---------------------------------------------------------------------------

@api.route("/api/saved-sets")
def saved_sets_list():
    return jsonify({"sets": list_saved_sets()})


@api.route("/api/saved-sets/<set_id>")
def saved_sets_get(set_id):
    s = get_saved_set(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    return jsonify(s)


@api.route("/api/saved-sets", methods=["POST"])
def saved_sets_create():
    body = request.get_json() or {}
    name = body.get("name", "").strip()
    slots = body.get("slots")
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not slots:
        return jsonify({"error": "Slots data is required"}), 400
    s = create_saved_set(name, slots)
    return jsonify(s), 201


@api.route("/api/saved-sets/<set_id>", methods=["PUT"])
def saved_sets_update(set_id):
    body = request.get_json() or {}
    name = body.get("name")
    slots = body.get("slots")
    s = update_saved_set(set_id, name=name, slots=slots)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    return jsonify(s)


@api.route("/api/saved-sets/<set_id>", methods=["DELETE"])
def saved_sets_delete(set_id):
    if delete_saved_set(set_id):
        return jsonify({"ok": True})
    return jsonify({"error": "Set not found"}), 404


# ---------------------------------------------------------------------------
# Dropbox OAuth2 Integration
# ---------------------------------------------------------------------------

@api.route("/api/dropbox/status")
def dropbox_status():
    connected = _state.get("_dropbox_client") is not None
    return jsonify({
        "connected": connected,
        "account_id": _state.get("_dropbox_account_id", "") if connected else "",
    })

@api.route("/api/dropbox/auth-url")
def dropbox_auth_url():
    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    if not app_key or not app_secret:
        return jsonify({"error": "DROPBOX_APP_KEY/SECRET not configured in .env"}), 500

    redirect_uri = request.host_url.rstrip("/") + "/api/dropbox/callback"
    session_store = {}
    flow = DropboxOAuth2Flow(
        consumer_key=app_key,
        consumer_secret=app_secret,
        redirect_uri=redirect_uri,
        session=session_store,
        csrf_token_session_key="dropbox-auth-csrf-token",
        token_access_type="offline",
    )
    authorize_url = flow.start()
    _state["_dropbox_oauth_csrf"] = session_store.get("dropbox-auth-csrf-token")
    return jsonify({"url": authorize_url})

@api.route("/api/dropbox/callback")
def dropbox_callback():
    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    redirect_uri = request.host_url.rstrip("/") + "/api/dropbox/callback"

    session_store = {
        "dropbox-auth-csrf-token": _state.get("_dropbox_oauth_csrf", ""),
    }
    flow = DropboxOAuth2Flow(
        consumer_key=app_key,
        consumer_secret=app_secret,
        redirect_uri=redirect_uri,
        session=session_store,
        csrf_token_session_key="dropbox-auth-csrf-token",
        token_access_type="offline",
    )
    try:
        result = flow.finish(request.args)
    except Exception as e:
        logging.exception("Dropbox OAuth callback failed")
        return (f"<html><body><h2>Dropbox connection failed</h2>"
                f"<p>{e}</p>"
                "<script>setTimeout(()=>window.close(),3000)</script>"
                "</body></html>")

    _state["_dropbox_refresh_token"] = result.refresh_token
    _state["_dropbox_account_id"] = result.account_id
    _state["_dropbox_exists_cache"] = {}
    _init_dropbox_client(result.refresh_token)
    _save_dropbox_tokens()
    logging.info("Dropbox connected: account_id=%s", result.account_id)

    return ("<html><body><h2>Dropbox connected!</h2>"
            "<p>This window will close automatically.</p>"
            "<script>"
            "if(window.opener&&window.opener.onDropboxConnected)"
            "  window.opener.onDropboxConnected();"
            "setTimeout(()=>window.close(),1500);"
            "</script></body></html>")

@api.route("/api/dropbox/disconnect", methods=["POST"])
def dropbox_disconnect():
    _state["_dropbox_client"] = None
    _state["_dropbox_refresh_token"] = None
    _state["_dropbox_account_id"] = None
    _state["_dropbox_exists_cache"] = {}
    try:
        if os.path.exists(_DROPBOX_TOKENS_FILE):
            os.remove(_DROPBOX_TOKENS_FILE)
    except Exception:
        pass
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Audio path mapping (for playing local files on a different machine)
# ---------------------------------------------------------------------------
def _map_audio_path(location):
    """Apply path prefix mapping from config (never modifies the CSV)."""
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


# ---------------------------------------------------------------------------
# GET /api/audio/<track_id> — Serve local audio file for full-track playback
# ---------------------------------------------------------------------------
_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".ogg": "audio/ogg",
}

@api.route("/api/audio/<int:track_id>")
def serve_audio(track_id):
    """Serve audio: redirect to Dropbox temporary link, or fall back to local."""
    df = _state["df"]
    if df is None:
        return jsonify({"error": "No file uploaded"}), 400
    if track_id not in df.index:
        return jsonify({"error": "Track not found"}), 404

    raw_location = str(df.loc[track_id].get("location", ""))

    # Try Dropbox first
    dbx = _state.get("_dropbox_client")
    if dbx:
        dropbox_path = _to_dropbox_path(raw_location)
        if dropbox_path:
            try:
                result = dbx.files_get_temporary_link(dropbox_path)
                return redirect(result.link, 302)
            except dropbox.exceptions.ApiError as e:
                logging.warning("Dropbox temp link failed for %s: %s",
                                dropbox_path, e)
            except Exception as e:
                logging.warning("Dropbox error for %s: %s", dropbox_path, e)

    # Fall back to local file
    location = _map_audio_path(raw_location)
    if not location or location == "nan":
        return jsonify({"error": "No file path for this track"}), 404
    if not os.path.isfile(location):
        return jsonify({"error": "Audio file not found"}), 404

    ext = os.path.splitext(location)[1].lower()
    mimetype = _AUDIO_MIME.get(ext, "application/octet-stream")
    return send_file(location, mimetype=mimetype, conditional=True)
