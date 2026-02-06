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
