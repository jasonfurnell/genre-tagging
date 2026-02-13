"""Set Workshop — User-built DJ set builder with per-slot source assignment."""

import json
import math
import os
import random
import re
import uuid
from datetime import datetime, timezone
from app.tree import find_node
from app.playlist import get_playlist, list_playlists

# ---------------------------------------------------------------------------
# State Persistence (working copy — crash recovery)
# ---------------------------------------------------------------------------

_SET_STATE_FILE = os.path.join("output", "set_workshop_state.json")


def save_set_state(state):
    """Save the set workshop state to disk."""
    os.makedirs(os.path.dirname(_SET_STATE_FILE), exist_ok=True)
    with open(_SET_STATE_FILE, "w") as f:
        json.dump(state, f)


def load_set_state():
    """Load the set workshop state from disk, or None."""
    if os.path.exists(_SET_STATE_FILE):
        try:
            with open(_SET_STATE_FILE) as f:
                return json.load(f)
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# Saved Sets Persistence (named sets — mirrors playlist.py CRUD pattern)
# ---------------------------------------------------------------------------

_SAVED_SETS_FILE = os.path.join("output", "saved_sets.json")
_saved_sets: dict = {}


def _load_saved_sets():
    global _saved_sets
    if os.path.exists(_SAVED_SETS_FILE):
        try:
            with open(_SAVED_SETS_FILE) as f:
                _saved_sets = json.load(f)
        except Exception:
            _saved_sets = {}
    else:
        _saved_sets = {}


def _save_saved_sets():
    os.makedirs(os.path.dirname(_SAVED_SETS_FILE), exist_ok=True)
    with open(_SAVED_SETS_FILE, "w") as f:
        json.dump(_saved_sets, f, indent=2)


_load_saved_sets()


def _now():
    return datetime.now(timezone.utc).isoformat()


def create_saved_set(name, slots):
    sid = str(uuid.uuid4())[:8]
    saved = {
        "id": sid,
        "name": name,
        "slots": slots,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _saved_sets[sid] = saved
    _save_saved_sets()
    return saved


def get_saved_set(set_id):
    return _saved_sets.get(set_id)


def list_saved_sets():
    result = []
    for s in sorted(_saved_sets.values(),
                    key=lambda x: x.get("updated_at", ""), reverse=True):
        slots = s.get("slots", [])
        track_count = sum(
            1 for sl in slots
            if sl.get("selectedTrackIndex") is not None
            and sl.get("tracks")
            and len(sl["tracks"]) > (sl["selectedTrackIndex"] or 0)
            and sl["tracks"][sl["selectedTrackIndex"]] is not None
        )
        result.append({
            "id": s["id"],
            "name": s["name"],
            "track_count": track_count,
            "slot_count": len(slots),
            "duration_minutes": len(slots) * 3,
            "created_at": s.get("created_at", ""),
            "updated_at": s.get("updated_at", ""),
        })
    return result


def update_saved_set(set_id, name=None, slots=None):
    s = _saved_sets.get(set_id)
    if not s:
        return None
    if name is not None:
        s["name"] = name
    if slots is not None:
        s["slots"] = slots
    s["updated_at"] = _now()
    _save_saved_sets()
    return s


def delete_saved_set(set_id):
    if set_id in _saved_sets:
        del _saved_sets[set_id]
        _save_saved_sets()
        return True
    return False

# ---------------------------------------------------------------------------
# Camelot Wheel
# ---------------------------------------------------------------------------

_CAMELOT = {}
for _n in range(1, 13):
    _CAMELOT[f"{_n}A"] = (_n, "A")
    _CAMELOT[f"{_n}B"] = (_n, "B")


def normalize_camelot(key_str):
    """Normalize key strings: '10M' → '10B', '9m' → '9A'.  Already-Camelot passes through."""
    if not key_str or not isinstance(key_str, str):
        return None
    key_str = key_str.strip()
    if key_str in _CAMELOT:
        return key_str
    m = re.match(r"^(\d{1,2})([MmABab])$", key_str)
    if not m:
        return None
    num, letter = int(m.group(1)), m.group(2)
    if num < 1 or num > 12:
        return None
    if letter in ("M", "B", "b"):
        return f"{num}B"
    return f"{num}A"


def camelot_compatible(key1, key2):
    """True if two keys are mix-compatible (±1 number same letter, or same number cross letter)."""
    k1, k2 = normalize_camelot(key1), normalize_camelot(key2)
    if not k1 or not k2:
        return True
    if k1 == k2:
        return True
    n1, l1 = _CAMELOT[k1]
    n2, l2 = _CAMELOT[k2]
    if l1 == l2:
        diff = abs(n1 - n2)
        if diff <= 1 or diff == 11:
            return True
    if n1 == n2 and l1 != l2:
        return True
    return False


def camelot_distance(key1, key2):
    """Integer distance on the Camelot wheel (0 = same).  Cross-letter = 1."""
    k1, k2 = normalize_camelot(key1), normalize_camelot(key2)
    if not k1 or not k2:
        return 0
    if k1 == k2:
        return 0
    n1, l1 = _CAMELOT[k1]
    n2, l2 = _CAMELOT[k2]
    num_diff = min(abs(n1 - n2), 12 - abs(n1 - n2))
    letter_diff = 0 if l1 == l2 else 1
    return num_diff + letter_diff


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_nan(val):
    try:
        return math.isnan(float(val))
    except (TypeError, ValueError):
        return False


def _sv(val):
    """Safe value for JSON — handle numpy/pandas types."""
    if _is_nan(val):
        return ""
    if hasattr(val, "item"):
        return val.item()
    return val


def _track_dict(df, idx, bpm_level=None, path_mapper=None, has_audio_fn=None):
    """Build a JSON-safe track dict from a DataFrame row."""
    if idx not in df.index:
        return None
    row = df.loc[idx]
    bpm = row.get("bpm")
    bpm_val = round(float(bpm), 1) if bpm is not None and not _is_nan(bpm) else None
    location = _sv(row.get("location", ""))
    loc_str = str(location) if location else ""
    if has_audio_fn:
        has_audio = has_audio_fn(loc_str)
    elif path_mapper and location:
        mapped = path_mapper(loc_str)
        has_audio = bool(mapped and mapped != "" and os.path.isfile(mapped))
    else:
        has_audio = bool(loc_str and os.path.isfile(loc_str))
    d = {
        "id": int(idx),
        "title": _sv(row.get("title", "")),
        "artist": _sv(row.get("artist", "")),
        "bpm": bpm_val,
        "key": _sv(row.get("key", "")),
        "year": _sv(row.get("year", "")),
        "has_audio": has_audio,
    }
    if bpm_level is not None:
        d["bpm_level"] = bpm_level
    return d


# ---------------------------------------------------------------------------
# BPM Levels
# ---------------------------------------------------------------------------

DEFAULT_BPM_LEVELS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150]


# ---------------------------------------------------------------------------
# Source Resolution
# ---------------------------------------------------------------------------

def get_source_tracks(source_type, source_id, tree=None):
    """Resolve a source to its track_ids list.

    source_type: "playlist", "tree_node", or "adhoc"
    For adhoc, source_id is ignored — caller should supply track_ids directly.
    """
    if source_type == "playlist":
        pl = get_playlist(source_id)
        if pl:
            return pl.get("track_ids", [])
        return []
    if source_type == "tree_node":
        if not tree:
            return []
        node = find_node(tree, source_id)
        if node:
            return node.get("track_ids", [])
        return []
    return []


def get_source_info(source_type, source_id, tree=None):
    """Return display info for a source: {name, description, track_count, examples}."""
    if source_type == "playlist":
        pl = get_playlist(source_id)
        if not pl:
            return None
        return {
            "id": pl["id"],
            "name": pl.get("name", ""),
            "description": pl.get("description", ""),
            "track_count": len(pl.get("track_ids", [])),
            "examples": [],
        }
    if source_type == "tree_node":
        if not tree:
            return None
        node = find_node(tree, source_id)
        if not node:
            return None
        return {
            "id": node.get("id", source_id),
            "name": node.get("title", ""),
            "description": node.get("description", ""),
            "track_count": node.get("track_count", len(node.get("track_ids", []))),
            "examples": node.get("examples", []),
        }
    return None


# ---------------------------------------------------------------------------
# Track Selection for Source-Based Slots
# ---------------------------------------------------------------------------

def select_tracks_for_source(df, source_track_ids, bpm_levels=None,
                             used_track_ids=None, anchor_track_id=None,
                             path_mapper=None, has_audio_fn=None):
    """Pick one best track per BPM level from a source's track pool.

    Args:
        df: DataFrame with track data.
        source_track_ids: list of track IDs from the source.
        bpm_levels: list of target BPMs (default [60,70,...,150]).
        used_track_ids: set of IDs already used in other slots (optional dedup).
        anchor_track_id: if set, this track is placed at its natural BPM level first.

    Returns:
        list of 10 items (one per BPM level). Each is a track dict or None.
    """
    if bpm_levels is None:
        bpm_levels = list(DEFAULT_BPM_LEVELS)
    if used_track_ids is None:
        used_track_ids = set()

    # Build pool of available tracks with their BPMs
    pool = []
    for idx in source_track_ids:
        if idx in used_track_ids:
            # Always keep the anchor track even if used in another slot
            if anchor_track_id is None or int(idx) != int(anchor_track_id):
                continue
        if idx not in df.index:
            continue
        bpm = df.loc[idx].get("bpm")
        if bpm is not None and not _is_nan(bpm):
            pool.append((int(idx), float(bpm)))

    assigned = {}  # bpm_level → track_id
    used_in_slot = set()

    # If anchor track specified, place it first
    if anchor_track_id is not None:
        anchor_bpm = None
        for idx, bpm in pool:
            if idx == anchor_track_id:
                anchor_bpm = bpm
                break
        if anchor_bpm is not None:
            # Find closest BPM level
            best_level = min(bpm_levels, key=lambda lv: abs(lv - anchor_bpm))
            assigned[best_level] = anchor_track_id
            used_in_slot.add(anchor_track_id)

    # For each remaining BPM level, find best available track
    for level in bpm_levels:
        if level in assigned:
            continue

        best_id = None
        best_dist = float("inf")

        # Progressive tolerance: ±5, ±10, ±15
        for tolerance in (5, 10, 15):
            for idx, bpm in pool:
                if idx in used_in_slot:
                    continue
                dist = abs(bpm - level)
                if dist <= tolerance and dist < best_dist:
                    best_dist = dist
                    best_id = idx
            if best_id is not None:
                break

        if best_id is not None:
            assigned[level] = best_id
            used_in_slot.add(best_id)

    # Build result list aligned to bpm_levels
    result = []
    for level in bpm_levels:
        tid = assigned.get(level)
        if tid is not None:
            result.append(_track_dict(df, tid, bpm_level=level,
                                      path_mapper=path_mapper,
                                      has_audio_fn=has_audio_fn))
        else:
            result.append(None)

    return result


# ---------------------------------------------------------------------------
# Browse Sources (for drawer)
# ---------------------------------------------------------------------------

def get_browse_sources(genre_tree=None, scene_tree=None, search_term=""):
    """Return available sources for the drawer's browse mode.

    Returns {playlists: [...], genre_tree: {...}, scene_tree: {...}}.
    """
    search = search_term.strip().lower()

    # Playlists
    all_playlists = list_playlists()
    playlists = []
    for pl in all_playlists:
        if search and search not in pl.get("name", "").lower():
            continue
        playlists.append({
            "id": pl["id"],
            "name": pl.get("name", ""),
            "description": pl.get("description", ""),
            "track_count": len(pl.get("track_ids", [])),
            "source": pl.get("source", ""),
        })

    # Tree summaries (lightweight — no track_ids)
    def _tree_summary(tree):
        if not tree:
            return {"available": False, "lineages": []}
        lineages = []
        for lin in tree.get("lineages", []):
            lineages.append(_summarize_node(lin, search))
        if search:
            lineages = [l for l in lineages if l is not None]
        return {"available": True, "lineages": lineages}

    return {
        "playlists": playlists,
        "genre_tree": _tree_summary(genre_tree),
        "scene_tree": _tree_summary(scene_tree),
    }


def _summarize_node(node, search=""):
    """Recursively build a lightweight tree summary (no track_ids)."""
    title = node.get("title", "")
    children_summaries = []
    for child in node.get("children", []):
        s = _summarize_node(child, search)
        if s is not None:
            children_summaries.append(s)

    # If searching, include node only if it matches or has matching children
    if search:
        self_match = search in title.lower()
        if not self_match and not children_summaries:
            return None

    return {
        "id": node.get("id", ""),
        "title": title,
        "description": node.get("description", ""),
        "track_count": node.get("track_count", len(node.get("track_ids", []))),
        "is_leaf": node.get("is_leaf", False),
        "children": children_summaries,
    }


# ---------------------------------------------------------------------------
# Source Detail (all tracks for drawer)
# ---------------------------------------------------------------------------

def get_source_detail(df, source_type, source_id, tree=None, path_mapper=None,
                      has_audio_fn=None):
    """Full source info + all tracks for the drawer detail view.

    Returns {id, name, description, track_count, examples, tracks: [...]}.
    """
    info = get_source_info(source_type, source_id, tree)
    if not info:
        return None

    track_ids = get_source_tracks(source_type, source_id, tree)
    tracks = []
    for idx in track_ids:
        t = _track_dict(df, idx, path_mapper=path_mapper,
                        has_audio_fn=has_audio_fn)
        if t:
            tracks.append(t)

    # Sort by BPM for the drawer list
    tracks.sort(key=lambda t: t.get("bpm") or 0)

    info["tracks"] = tracks
    return info


# ---------------------------------------------------------------------------
# Track Search & Context (for drawer search mode)
# ---------------------------------------------------------------------------

def find_leaf_for_track(tree, track_id):
    """Return the leaf node whose track_ids contains track_id, or None."""
    if not tree:
        return None
    for lineage in tree.get("lineages", []):
        result = _find_leaf_with_track(lineage, track_id)
        if result:
            return result
    return None


def _find_leaf_with_track(node, track_id):
    """Recursively find a leaf that contains track_id."""
    if node.get("is_leaf") or not node.get("children"):
        if track_id in node.get("track_ids", []):
            return node
        return None
    for child in node.get("children", []):
        result = _find_leaf_with_track(child, track_id)
        if result:
            return result
    return None


def build_track_context(df, track_id, genre_tree, scene_tree):
    """Build the 2-card context for a selected track (genre leaf + scene leaf).

    Returns {genre_leaf: {...}, scene_leaf: {...}}.
    """
    if track_id not in df.index:
        return None

    genre_leaf = _build_leaf_card(df, genre_tree, track_id, "genre")
    scene_leaf = _build_leaf_card(df, scene_tree, track_id, "scene")

    return {"genre_leaf": genre_leaf, "scene_leaf": scene_leaf}


def _build_leaf_card(df, tree, track_id, tree_type):
    """Build a card dict for the leaf node containing track_id."""
    label = "Genre" if tree_type == "genre" else "Scene"
    if not tree:
        return {"available": False, "reason": f"{label} tree not built"}

    leaf = find_leaf_for_track(tree, track_id)
    if not leaf:
        return {"available": False, "reason": f"Track not assigned in {label.lower()} tree"}

    leaf_track_ids = leaf.get("track_ids", [])
    sample_tracks = []
    for tid in leaf_track_ids:
        if tid == track_id:
            continue
        t = _track_dict(df, tid)
        if t:
            sample_tracks.append(t)
        if len(sample_tracks) >= 10:
            break

    return {
        "available": True,
        "node_id": leaf.get("id", ""),
        "name": leaf.get("title", "Unknown"),
        "description": leaf.get("description", ""),
        "track_count": len(leaf_track_ids),
        "tree_type": tree_type,
        "tracks": sample_tracks,
        "examples": leaf.get("examples", []),
    }
