"""Playlist CRUD, LLM playlist suggestion generation, and export (M3U / CSV)."""

import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import pandas as pd
from tenacity import retry, wait_fixed, stop_after_attempt, retry_if_exception_type

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_PLAYLISTS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "playlists.json"
)

_playlists: dict = {}  # id -> playlist dict


def _load_playlists():
    global _playlists
    if os.path.exists(_PLAYLISTS_FILE):
        try:
            with open(_PLAYLISTS_FILE) as f:
                _playlists = json.load(f)
        except Exception:
            _playlists = {}
    else:
        _playlists = {}


def _save_playlists():
    os.makedirs(os.path.dirname(_PLAYLISTS_FILE), exist_ok=True)
    with open(_PLAYLISTS_FILE, "w") as f:
        json.dump(_playlists, f, indent=2)


# Load on import
_load_playlists()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def _now():
    return datetime.now(timezone.utc).isoformat()


def create_playlist(name, description="", filters=None, track_ids=None, source="manual"):
    pid = str(uuid.uuid4())[:8]
    playlist = {
        "id": pid,
        "name": name,
        "description": description,
        "filters": filters or {},
        "track_ids": track_ids or [],
        "source": source,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _playlists[pid] = playlist
    _save_playlists()
    return playlist


def get_playlist(playlist_id):
    return _playlists.get(playlist_id)


def list_playlists():
    return sorted(
        _playlists.values(),
        key=lambda p: p.get("updated_at", ""),
        reverse=True,
    )


def update_playlist(playlist_id, updates):
    p = _playlists.get(playlist_id)
    if not p:
        return None
    for key in ("name", "description", "filters", "track_ids"):
        if key in updates:
            p[key] = updates[key]
    p["updated_at"] = _now()
    _save_playlists()
    return p


def delete_playlist(playlist_id):
    if playlist_id in _playlists:
        del _playlists[playlist_id]
        _save_playlists()
        return True
    return False


def add_tracks_to_playlist(playlist_id, track_ids):
    p = _playlists.get(playlist_id)
    if not p:
        return None
    existing = set(p["track_ids"])
    for tid in track_ids:
        if tid not in existing:
            p["track_ids"].append(tid)
            existing.add(tid)
    p["updated_at"] = _now()
    _save_playlists()
    return p


def remove_tracks_from_playlist(playlist_id, track_ids):
    p = _playlists.get(playlist_id)
    if not p:
        return None
    remove_set = set(track_ids)
    p["track_ids"] = [t for t in p["track_ids"] if t not in remove_set]
    p["updated_at"] = _now()
    _save_playlists()
    return p


# ---------------------------------------------------------------------------
# LLM playlist suggestion generation
# ---------------------------------------------------------------------------

_SUGGEST_SYSTEM_PROMPT = (
    "You are a professional DJ and music curator. You analyze music collections "
    "and suggest themed playlists that would work well for real DJ sets or "
    "listening experiences. You understand genre relationships, BPM mixing, "
    "mood progression, and dancefloor energy management.\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

_SUGGEST_USER_TEMPLATE = """Here is a summary of my music collection:

{landscape}

Suggest {num} themed playlists that would make great DJ sets or listening experiences from this collection. Each playlist should have a cohesive theme based on interesting genre intersections, mood/era combinations, or geographic scenes — NOT just a single broad genre.

For each playlist, specify search filters using these available fields:
- genres: list of genre names to match (matches against both primary and secondary genre)
- mood: list of mood/atmosphere keywords to search for in the mood field
- descriptors: list of production descriptor keywords to search in the descriptors field
- location: list of location/origin keywords
- era: list of era keywords (e.g. "2010s", "late 1990s")
- bpm_min, bpm_max: BPM range (optional, only if relevant)
- year_min, year_max: year range (optional, only if relevant)

Respond with a JSON array of objects, each with:
- name: catchy, evocative playlist name (max 40 chars)
- description: 1-2 sentence description of the vibe
- filters: search filter object using the fields above
- rationale: 1 sentence explaining why this grouping works with this collection

Focus on creating diverse, interesting combinations:
- Cross-genre connections (e.g. where Funk meets Electronic)
- Era-spanning themes (e.g. "80s NYC downtown scene")
- Mood-based curation (e.g. "late-night deep grooves")
- Geographic scenes (e.g. "UK bass culture")
Avoid obvious single-genre lists like "All House tracks"."""


def _extract_json_array(text):
    """Extract a JSON array from LLM response, stripping markdown fences."""
    text = text.strip()
    # Remove markdown code fences
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()
    return json.loads(text)


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def generate_playlist_suggestions(landscape_summary, client, model, provider,
                                  num_suggestions=6):
    """Ask an LLM to propose themed playlist definitions.

    Returns a list of dicts with keys: name, description, filters, rationale.
    """
    user_prompt = _SUGGEST_USER_TEMPLATE.format(
        landscape=landscape_summary,
        num=num_suggestions,
    )

    if provider == "anthropic":
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=_SUGGEST_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text.strip()
    else:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SUGGEST_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = response.choices[0].message.content.strip()

    suggestions = _extract_json_array(raw)

    # Validate structure
    validated = []
    for s in suggestions:
        validated.append({
            "name": str(s.get("name", "Untitled")),
            "description": str(s.get("description", "")),
            "filters": s.get("filters", {}),
            "rationale": str(s.get("rationale", "")),
        })
    return validated


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_m3u(playlist_id, df):
    """Generate M3U content for a playlist. Returns string."""
    p = _playlists.get(playlist_id)
    if not p:
        return None

    lines = ["#EXTM3U", f"#PLAYLIST:{p['name']}"]

    for tid in p["track_ids"]:
        if tid not in df.index:
            continue
        row = df.loc[tid]
        artist = str(row.get("artist", "Unknown"))
        title = str(row.get("title", "Unknown"))
        location = str(row.get("location", ""))
        lines.append(f"#EXTINF:-1,{artist} - {title}")
        if location and location != "nan":
            lines.append(location)

    return "\n".join(lines) + "\n"


def export_csv(playlist_id, df):
    """Return CSV content for a playlist's tracks. Returns BytesIO."""
    p = _playlists.get(playlist_id)
    if not p:
        return None

    valid_ids = [tid for tid in p["track_ids"] if tid in df.index]
    subset = df.loc[valid_ids]
    # Drop internal columns
    export_cols = [c for c in subset.columns if not c.startswith("_")]

    buf = io.BytesIO()
    subset[export_cols].to_csv(buf, index=False)
    buf.seek(0)
    return buf
