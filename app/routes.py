import io
import json
import logging
import os
import subprocess
import threading
import time

import pandas as pd
from flask import Blueprint, request, jsonify, Response, send_file
from anthropic import Anthropic
from openai import OpenAI
from dotenv import load_dotenv

from app.tagger import generate_genre_comment
from app.config import load_config, save_config, DEFAULT_CONFIG
from app.parser import (
    parse_all_comments, invalidate_parsed_columns,
    build_genre_cooccurrence, build_genre_landscape_summary,
    build_facet_options, faceted_search,
)
from app.playlist import (
    create_playlist, get_playlist, list_playlists, update_playlist,
    delete_playlist, add_tracks_to_playlist, remove_tracks_from_playlist,
    generate_playlist_suggestions, export_m3u, export_csv,
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
}

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


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

    return jsonify(_summary())


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
    num = body.get("num_suggestions", 6)

    try:
        suggestions = generate_playlist_suggestions(
            landscape, client, model, provider, num
        )
    except Exception as e:
        logging.exception("Playlist suggestion generation failed")
        return jsonify({"error": str(e)}), 500

    # Enrich each suggestion with track count and samples
    for s in suggestions:
        try:
            matching = faceted_search(df, s["filters"])
            s["track_count"] = len(matching)
            samples = _tracks_from_ids(df, matching[:5])
            s["sample_tracks"] = [
                {"id": t["id"], "title": t.get("title", ""), "artist": t.get("artist", "")}
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
                     download_name=f"{name}.m3u")


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
