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

_FILTER_FIELDS_HELP = """For each playlist, specify search filters using these available fields:
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
- rationale: 1 sentence explaining why this grouping works"""

_SUGGEST_USER_TEMPLATE = """Here is a summary of my music collection:

{landscape}

Suggest {num} themed playlists that would make great DJ sets or listening experiences from this collection. Each playlist should have a cohesive theme based on interesting genre intersections, mood/era combinations, or geographic scenes — NOT just a single broad genre.

""" + _FILTER_FIELDS_HELP + """

Focus on creating diverse, interesting combinations:
- Cross-genre connections (e.g. where Funk meets Electronic)
- Era-spanning themes (e.g. "80s NYC downtown scene")
- Mood-based curation (e.g. "late-night deep grooves")
- Geographic scenes (e.g. "UK bass culture")
Avoid obvious single-genre lists like "All House tracks"."""

# --- Vibe text mode ---
_VIBE_USER_TEMPLATE = """Here is a summary of my music collection:

{landscape}

A user wants a playlist with this vibe/feel:
"{vibe_text}"

Create {num} playlist definitions that capture this vibe using tracks from the collection described above. Be creative in interpreting the vibe — think about what genres, moods, tempos, locations, and eras would match.

""" + _FILTER_FIELDS_HELP

# --- Seed tracks mode ---
_SEED_USER_TEMPLATE = """Here is a summary of my music collection:

{landscape}

A user selected these tracks as "seed" inspiration for a playlist:
{seed_details}

Analyze the common threads across these seed tracks (genres, mood, tempo range, era, geography) and create {num} playlist definitions that expand on this selection. Each playlist should find MORE tracks like these but with a slightly different angle or twist.

""" + _FILTER_FIELDS_HELP

# --- Genre intersection mode ---
_INTERSECTION_USER_TEMPLATE = """Here is a summary of my music collection:

{landscape}

A user is interested in the intersection of these genres: {genre1} + {genre2}
There are approximately {intersection_count} tracks in the collection that combine these genres.

Create {num} playlist definitions that explore different facets of this genre intersection. Think about different moods, eras, tempos, or regional variations within this intersection.

""" + _FILTER_FIELDS_HELP


def _extract_json_array(text):
    """Extract a JSON array from LLM response, stripping markdown fences."""
    text = text.strip()
    # Remove markdown code fences
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()
    return json.loads(text)


def _call_llm(client, model, provider, system_prompt, user_prompt):
    """Make an LLM call and return the raw text response."""
    if provider == "anthropic":
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return response.content[0].text.strip()
    else:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content.strip()


def _validate_suggestions(suggestions):
    """Validate and normalize a list of suggestion dicts."""
    validated = []
    for s in suggestions:
        validated.append({
            "name": str(s.get("name", "Untitled")),
            "description": str(s.get("description", "")),
            "filters": s.get("filters", {}),
            "rationale": str(s.get("rationale", "")),
        })
    return validated


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def generate_playlist_suggestions(landscape_summary, client, model, provider,
                                  num_suggestions=6):
    """Ask an LLM to propose themed playlist definitions (explore mode).

    Returns a list of dicts with keys: name, description, filters, rationale.
    """
    user_prompt = _SUGGEST_USER_TEMPLATE.format(
        landscape=landscape_summary,
        num=num_suggestions,
    )
    raw = _call_llm(client, model, provider, _SUGGEST_SYSTEM_PROMPT, user_prompt)
    return _validate_suggestions(_extract_json_array(raw))


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def generate_vibe_suggestions(landscape_summary, vibe_text, client, model,
                              provider, num_suggestions=3):
    """Generate playlists from a free-text vibe description."""
    user_prompt = _VIBE_USER_TEMPLATE.format(
        landscape=landscape_summary,
        vibe_text=vibe_text,
        num=num_suggestions,
    )
    raw = _call_llm(client, model, provider, _SUGGEST_SYSTEM_PROMPT, user_prompt)
    return _validate_suggestions(_extract_json_array(raw))


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def generate_seed_suggestions(landscape_summary, seed_details, client, model,
                              provider, num_suggestions=3):
    """Generate playlists inspired by a set of seed tracks."""
    user_prompt = _SEED_USER_TEMPLATE.format(
        landscape=landscape_summary,
        seed_details=seed_details,
        num=num_suggestions,
    )
    raw = _call_llm(client, model, provider, _SUGGEST_SYSTEM_PROMPT, user_prompt)
    return _validate_suggestions(_extract_json_array(raw))


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def generate_intersection_suggestions(landscape_summary, genre1, genre2,
                                      intersection_count, client, model,
                                      provider, num_suggestions=3):
    """Generate playlists exploring a specific genre intersection."""
    user_prompt = _INTERSECTION_USER_TEMPLATE.format(
        landscape=landscape_summary,
        genre1=genre1,
        genre2=genre2,
        intersection_count=intersection_count,
        num=num_suggestions,
    )
    raw = _call_llm(client, model, provider, _SUGGEST_SYSTEM_PROMPT, user_prompt)
    return _validate_suggestions(_extract_json_array(raw))


# ---------------------------------------------------------------------------
# LLM track reranking
# ---------------------------------------------------------------------------

_RERANK_SYSTEM_PROMPT = (
    "You are a professional DJ and music curator. You select and rank tracks "
    "to build the perfect playlist flow. You consider energy, mood, genre "
    "compatibility, BPM flow, and overall vibe coherence.\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

_RERANK_USER_TEMPLATE = """I'm building a playlist called "{playlist_name}".
{description}

Here are candidate tracks from my collection (sorted by relevance score). For each track I'm showing: ID, Artist, Title, BPM, Key, and the full Comment tag.

{track_list}

From these {candidate_count} candidates, select the best {target_count} tracks for this playlist. Consider:
1. How well each track fits the playlist theme/vibe
2. Genre cohesion (tracks should feel like they belong together)
3. Energy and mood flow (if BPM/key info is available, consider mixing compatibility)
4. Variety within the theme (avoid too many tracks from the same artist or identical style)

Respond with a JSON object:
{{
  "tracks": [
    {{"id": <track_id>, "reason": "1-sentence reason for inclusion"}}
  ],
  "flow_notes": "Brief description of how you ordered these tracks"
}}

Order the tracks array in your recommended playback order."""


@retry(
    wait=wait_fixed(3),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
)
def rerank_tracks(candidate_tracks, playlist_name, description,
                  client, model, provider, target_count=25):
    """Ask an LLM to pick and rank the best tracks from scored candidates.

    candidate_tracks: list of dicts with id, artist, title, bpm, key, comment
    Returns dict with keys: tracks (list of {id, reason}), flow_notes (str)
    """
    track_lines = []
    for t in candidate_tracks:
        bpm_str = f"BPM:{t.get('bpm', '?')}" if t.get('bpm') else ""
        key_str = f"Key:{t.get('key', '?')}" if t.get('key') else ""
        comment = str(t.get('comment', ''))[:200]
        line = (
            f"  ID:{t['id']} | {t.get('artist', '?')} — {t.get('title', '?')} "
            f"| {bpm_str} {key_str} | Comment: {comment}"
        )
        track_lines.append(line)

    user_prompt = _RERANK_USER_TEMPLATE.format(
        playlist_name=playlist_name,
        description=description or "",
        track_list="\n".join(track_lines),
        candidate_count=len(candidate_tracks),
        target_count=target_count,
    )

    raw = _call_llm(client, model, provider, _RERANK_SYSTEM_PROMPT, user_prompt)
    # Strip markdown fences if present, then parse as JSON object
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```\s*$", "", cleaned).strip()
    result = json.loads(cleaned)

    if isinstance(result, list):
        result = {"tracks": result, "flow_notes": ""}

    validated_tracks = []
    for t in result.get("tracks", []):
        if "id" in t:
            validated_tracks.append({
                "id": t["id"],
                "reason": str(t.get("reason", "")),
            })

    return {
        "tracks": validated_tracks,
        "flow_notes": str(result.get("flow_notes", "")),
    }


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_m3u(playlist_id, df):
    """Generate extended M3U8 content for a playlist (UTF-8, Lexicon compatible).

    Returns string with #EXTM3U header, #PLAYLIST tag, and #EXTINF entries.
    Lexicon DJ can import this by dragging the .m3u8 file onto its playlists panel.
    """
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


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def import_m3u(file_content, filename, df):
    """Import an M3U/M3U8 playlist file, matching tracks to the DataFrame.

    Match strategy (in priority order):
      1. Exact match on 'location' column (file path)
      2. Filename-only match (basename, case-insensitive)
      3. Artist + title case-insensitive match

    Returns dict with: playlist, matched_count, unmatched_count, unmatched_tracks
    """
    lines = file_content.splitlines()

    # Extract playlist name from #PLAYLIST tag or filename
    playlist_name = os.path.splitext(filename)[0]
    for line in lines:
        if line.startswith("#PLAYLIST:"):
            playlist_name = line[len("#PLAYLIST:"):].strip()
            break

    # Parse EXTINF entries: collect (artist_title_str, file_path) pairs
    entries = []
    pending_info = None
    for line in lines:
        line = line.strip()
        if not line or line == "#EXTM3U":
            continue
        if line.startswith("#EXTINF:"):
            # Format: #EXTINF:duration,Artist - Title
            after_tag = line[len("#EXTINF:"):]
            comma_idx = after_tag.find(",")
            if comma_idx >= 0:
                pending_info = after_tag[comma_idx + 1:].strip()
            else:
                pending_info = after_tag.strip()
        elif line.startswith("#"):
            # Other comment/tag lines — skip but don't clear pending_info
            continue
        else:
            # This is a file path line
            entries.append((pending_info or "", line))
            pending_info = None

    if not entries:
        return {"error": "No tracks found in the playlist file"}

    # Build lookup indexes from the DataFrame
    loc_index = {}       # full path -> track id
    basename_index = {}  # lowercase basename -> list of track ids
    for tid in df.index:
        loc = str(df.at[tid, "location"]) if "location" in df.columns else ""
        if loc and loc != "nan":
            loc_index[loc] = tid
            bn = os.path.basename(loc).lower()
            basename_index.setdefault(bn, []).append(tid)

    matched_ids = []
    unmatched_tracks = []

    for info_str, filepath in entries:
        matched_id = None

        # Strategy 1: exact location match
        if filepath in loc_index:
            matched_id = loc_index[filepath]

        # Strategy 2: basename match
        if matched_id is None:
            bn = os.path.basename(filepath).lower()
            candidates = basename_index.get(bn, [])
            if len(candidates) == 1:
                matched_id = candidates[0]
            elif len(candidates) > 1:
                # Multiple basename matches — pick first (could refine later)
                matched_id = candidates[0]

        # Strategy 3: artist + title match
        if matched_id is None and info_str:
            # Parse "Artist - Title" from EXTINF info
            parts = info_str.split(" - ", 1)
            if len(parts) == 2:
                m3u_artist = parts[0].strip().lower()
                m3u_title = parts[1].strip().lower()
                for tid in df.index:
                    row_artist = str(df.at[tid, "artist"]).lower() if "artist" in df.columns else ""
                    row_title = str(df.at[tid, "title"]).lower() if "title" in df.columns else ""
                    if m3u_artist in row_artist and m3u_title in row_title:
                        matched_id = tid
                        break

        if matched_id is not None:
            if matched_id not in matched_ids:
                matched_ids.append(int(matched_id) if hasattr(matched_id, 'item') else matched_id)
        else:
            unmatched_tracks.append(info_str or filepath)

    playlist = create_playlist(
        name=playlist_name,
        track_ids=matched_ids,
        source="import",
    )

    return {
        "playlist": playlist,
        "matched_count": len(matched_ids),
        "unmatched_count": len(unmatched_tracks),
        "unmatched_tracks": unmatched_tracks,
    }
