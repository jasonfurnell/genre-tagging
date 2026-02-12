"""Set Workshop — User-built DJ set builder with per-slot source assignment."""

import math
import random
import re
from app.tree import find_node
from app.playlist import get_playlist, list_playlists

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


def _find_parent(tree, node_id):
    """Find the parent node of a given node_id in the tree."""
    for lineage in tree.get("lineages", []):
        result = _find_parent_in(lineage, node_id)
        if result:
            return result
    return None


def _find_parent_in(node, node_id):
    for child in node.get("children", []):
        if child.get("id") == node_id:
            return node
        result = _find_parent_in(child, node_id)
        if result:
            return result
    return None


def _find_lineage_id(tree, node_id):
    """Find which top-level lineage a node belongs to."""
    for lineage in tree.get("lineages", []):
        if _node_contains(lineage, node_id):
            return lineage.get("id")
    return None


def _node_contains(node, target_id):
    """Check if target_id is this node or any descendant."""
    if node.get("id") == target_id:
        return True
    for child in node.get("children", []):
        if _node_contains(child, target_id):
            return True
    return False


def _collect_leaves(node, leaves):
    if node.get("is_leaf"):
        leaves.append(node)
    for child in node.get("children", []):
        _collect_leaves(child, leaves)


def _track_dict(df, idx, bpm_level=None):
    """Build a JSON-safe track dict from a DataFrame row."""
    if idx not in df.index:
        return None
    row = df.loc[idx]
    bpm = row.get("bpm")
    bpm_val = round(float(bpm), 1) if bpm is not None and not _is_nan(bpm) else None
    d = {
        "id": int(idx),
        "title": _sv(row.get("title", "")),
        "artist": _sv(row.get("artist", "")),
        "bpm": bpm_val,
        "key": _sv(row.get("key", "")),
        "year": _sv(row.get("year", "")),
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
                             used_track_ids=None, anchor_track_id=None):
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
            result.append(_track_dict(df, tid, bpm_level=level))
        else:
            result.append(None)

    return result


# ---------------------------------------------------------------------------
# Source Suggestions
# ---------------------------------------------------------------------------

def suggest_similar_sources(df, tree, current_source_type, current_source_id):
    """Suggest sources related to the current one.

    Returns {similar: [...], energy_up: [...], energy_down: [...]}.
    Each item: {id, name, track_count, type, tree_type, relationship}.
    """
    similar = []
    energy_up = []
    energy_down = []

    if current_source_type != "tree_node" or not tree:
        return {"similar": similar, "energy_up": energy_up, "energy_down": energy_down}

    node = find_node(tree, current_source_id)
    if not node:
        return {"similar": similar, "energy_up": energy_up, "energy_down": energy_down}

    tree_type = tree.get("tree_type", "genre")

    # Compute current node's avg BPM
    current_avg_bpm = _avg_bpm(df, node.get("track_ids", []))

    # Siblings (same parent's children, excluding self)
    parent = _find_parent(tree, current_source_id)
    if parent:
        for sibling in parent.get("children", []):
            if sibling.get("id") == current_source_id:
                continue
            info = _suggestion_item(df, sibling, tree_type, "sibling")
            if info:
                similar.append(info)

    # Parent node itself
    if parent and parent.get("id"):
        info = _suggestion_item(df, parent, tree_type, "parent")
        if info:
            similar.append(info)

    # Children (if branch node)
    for child in node.get("children", []):
        info = _suggestion_item(df, child, tree_type, "child")
        if info:
            similar.append(info)

    # Energy up/down: collect all leaves in same lineage, sort by avg BPM
    lineage_id = _find_lineage_id(tree, current_source_id)
    if lineage_id:
        lineage_node = find_node(tree, lineage_id)
        if lineage_node:
            all_leaves = []
            _collect_leaves(lineage_node, all_leaves)
            for leaf in all_leaves:
                if leaf.get("id") == current_source_id:
                    continue
                avg = _avg_bpm(df, leaf.get("track_ids", []))
                if avg is None:
                    continue
                info = _suggestion_item(df, leaf, tree_type, "")
                if not info:
                    continue
                if current_avg_bpm is not None:
                    if avg > current_avg_bpm + 5:
                        info["relationship"] = "higher energy"
                        energy_up.append((avg, info))
                    elif avg < current_avg_bpm - 5:
                        info["relationship"] = "lower energy"
                        energy_down.append((avg, info))

    # Sort energy_up ascending (closest first), energy_down descending
    energy_up.sort(key=lambda x: x[0])
    energy_down.sort(key=lambda x: -x[0])
    energy_up = [item for _, item in energy_up[:8]]
    energy_down = [item for _, item in energy_down[:8]]

    return {"similar": similar[:10], "energy_up": energy_up, "energy_down": energy_down}


def _suggestion_item(df, node, tree_type, relationship):
    """Build a suggestion dict from a tree node."""
    track_ids = node.get("track_ids", [])
    if not track_ids:
        return None
    return {
        "id": node.get("id", ""),
        "name": node.get("title", ""),
        "track_count": node.get("track_count", len(track_ids)),
        "type": "tree_node",
        "tree_type": tree_type,
        "relationship": relationship,
    }


def _avg_bpm(df, track_ids):
    """Compute average BPM for a set of track IDs."""
    bpms = []
    for idx in track_ids:
        if idx not in df.index:
            continue
        bpm = df.loc[idx].get("bpm")
        if bpm is not None and not _is_nan(bpm):
            bpms.append(float(bpm))
    return sum(bpms) / len(bpms) if bpms else None


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

def get_source_detail(df, source_type, source_id, tree=None):
    """Full source info + all tracks for the drawer detail view.

    Returns {id, name, description, track_count, examples, tracks: [...]}.
    """
    info = get_source_info(source_type, source_id, tree)
    if not info:
        return None

    track_ids = get_source_tracks(source_type, source_id, tree)
    tracks = []
    for idx in track_ids:
        t = _track_dict(df, idx)
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
