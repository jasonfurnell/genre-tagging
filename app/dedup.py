"""
Library deduplication: detect, preview, and merge duplicate tracks.

Duplicates = rows sharing the same (artist, title) pair (case-insensitive).
"""

import json
import logging
import os

import pandas as pd

log = logging.getLogger(__name__)

_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")


# ---------------------------------------------------------------------------
# Core: detect & group duplicates
# ---------------------------------------------------------------------------

def _normalise(val):
    """Lowercase-strip for comparison."""
    if pd.isna(val):
        return ""
    return str(val).strip().lower()


def find_duplicate_groups(df):
    """Return list of duplicate groups, each a list of row-index ints.

    Only groups with 2+ rows are returned.
    """
    groups = df.groupby(
        [df["artist"].apply(_normalise), df["title"].apply(_normalise)]
    ).groups          # {(artist, title): Index([row_ids])}

    return [
        list(int(i) for i in idx)
        for idx in groups.values()
        if len(idx) >= 2
    ]


# ---------------------------------------------------------------------------
# Scoring: pick the "best" row in each duplicate group
# ---------------------------------------------------------------------------

def _row_richness(row):
    """Score how much useful data a row carries (higher = richer)."""
    score = 0
    comment = str(row.get("comment", "")) if pd.notna(row.get("comment", "")) else ""
    score += len(comment)  # longer comment = richer

    # Bonus for having non-empty optional columns
    for col in ("bpm", "key", "year", "albumTitle", "location"):
        val = row.get(col, "")
        if pd.notna(val) and str(val).strip():
            score += 10
    return score


def pick_winners(df, groups):
    """For each duplicate group, pick the best row index.

    Returns list of dicts:
      {
        "winner": int,           # row index to keep
        "losers": [int, ...],    # row indices to drop
        "artist": str,
        "title": str,
        "location_conflict": bool,  # True if locations differ across group
        "locations": {row_id: location, ...},
      }
    """
    results = []
    for group_ids in groups:
        rows = [(idx, df.loc[idx]) for idx in group_ids]

        # Pick row with highest richness
        best_idx = max(rows, key=lambda r: _row_richness(r[1]))[0]

        # Detect location conflicts
        locations = {}
        for idx, row in rows:
            loc = str(row.get("location", "")) if pd.notna(row.get("location", "")) else ""
            locations[idx] = loc
        unique_locs = set(l for l in locations.values() if l)
        location_conflict = len(unique_locs) > 1

        losers = [idx for idx in group_ids if idx != best_idx]

        results.append({
            "winner": best_idx,
            "losers": losers,
            "artist": str(df.loc[best_idx]["artist"]),
            "title": str(df.loc[best_idx]["title"]),
            "location_conflict": location_conflict,
            "locations": locations,
        })
    return results


# ---------------------------------------------------------------------------
# ID remapping
# ---------------------------------------------------------------------------

def build_id_remap(df, winner_picks):
    """Build old_id → new_id mapping after deduplication.

    - Winner rows are kept; losers are dropped.
    - The kept rows get new sequential indices (0, 1, 2, ...).
    - Loser rows map to their winner's new index.

    Returns (new_df, remap_dict).
    """
    loser_to_winner = {}
    for pick in winner_picks:
        for loser in pick["losers"]:
            loser_to_winner[loser] = pick["winner"]

    # All rows to keep (in original order)
    drop_set = set(loser_to_winner.keys())
    keep_ids = [idx for idx in df.index if idx not in drop_set]

    # old winner id → new sequential id
    old_to_new = {}
    for new_idx, old_idx in enumerate(keep_ids):
        old_to_new[old_idx] = new_idx

    # Losers map to their winner's new id
    for loser, winner in loser_to_winner.items():
        old_to_new[loser] = old_to_new[winner]

    # Build new DataFrame with reset index
    new_df = df.loc[keep_ids].reset_index(drop=True)

    return new_df, old_to_new


# ---------------------------------------------------------------------------
# JSON file remappers
# ---------------------------------------------------------------------------

def _remap_id(old_id, remap):
    """Map a single track ID, returning None if not in remap."""
    return remap.get(int(old_id))


def _remap_id_list(ids, remap):
    """Remap a list of IDs, deduplicating and preserving order."""
    seen = set()
    result = []
    for old_id in ids:
        new_id = remap.get(int(old_id))
        if new_id is not None and new_id not in seen:
            seen.add(new_id)
            result.append(new_id)
    return result


def remap_playlists(remap):
    """Remap track IDs in playlists.json. Returns (data, changed_count)."""
    path = os.path.join(_OUTPUT_DIR, "playlists.json")
    if not os.path.exists(path):
        return None, 0

    with open(path) as f:
        data = json.load(f)

    changed = 0
    for pl in data.values():
        old_ids = pl.get("track_ids", [])
        new_ids = _remap_id_list(old_ids, remap)
        if new_ids != old_ids:
            pl["track_ids"] = new_ids
            changed += 1

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return data, changed


def remap_saved_sets(remap):
    """Remap track IDs in saved_sets.json. Returns (data, changed_count)."""
    path = os.path.join(_OUTPUT_DIR, "saved_sets.json")
    if not os.path.exists(path):
        return None, 0

    with open(path) as f:
        data = json.load(f)

    changed = 0
    for s in data.values():
        set_changed = False
        for slot in s.get("slots", []):
            for track in slot.get("tracks", []):
                old_id = track.get("id")
                if old_id is not None:
                    new_id = remap.get(int(old_id))
                    if new_id is not None and new_id != old_id:
                        track["id"] = new_id
                        set_changed = True
            # Also remap selectedTrackIndex — nope, that's the index
            # into the slot's tracks array, not a track ID. Leave it.
        if set_changed:
            changed += 1

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return data, changed


def _remap_tree_node(node, remap):
    """Recursively remap track_ids in a tree node and its children."""
    if "track_ids" in node:
        node["track_ids"] = _remap_id_list(node["track_ids"], remap)
        node["track_count"] = len(node["track_ids"])
    if "examples" in node:
        new_examples = []
        for ex in node["examples"]:
            if isinstance(ex, dict) and "id" in ex:
                new_id = remap.get(int(ex["id"]))
                if new_id is not None:
                    ex["id"] = new_id
                    new_examples.append(ex)
            else:
                new_examples.append(ex)
        node["examples"] = new_examples
    for child in node.get("children", []):
        _remap_tree_node(child, remap)
    for leaf in node.get("leaves", []):
        _remap_tree_node(leaf, remap)


def remap_tree_file(filename, remap):
    """Remap track_ids in a tree JSON file. Returns True if file existed."""
    path = os.path.join(_OUTPUT_DIR, filename)
    if not os.path.exists(path):
        return False

    with open(path) as f:
        data = json.load(f)

    # Top-level ungrouped
    if "ungrouped_track_ids" in data:
        data["ungrouped_track_ids"] = _remap_id_list(
            data["ungrouped_track_ids"], remap
        )

    # Lineages (genre/scene trees)
    for lineage in data.get("lineages", []):
        _remap_tree_node(lineage, remap)

    # Categories (curated collection)
    for cat in data.get("categories", []):
        _remap_tree_node(cat, remap)

    # Update totals
    if "total_tracks" in data:
        all_ids = set()
        for lin in data.get("lineages", []):
            all_ids.update(lin.get("track_ids", []))
        for cat in data.get("categories", []):
            all_ids.update(cat.get("track_ids", []))
        all_ids.update(data.get("ungrouped_track_ids", []))
        data["total_tracks"] = len(all_ids)
        data["assigned_tracks"] = len(all_ids) - len(data.get("ungrouped_track_ids", []))

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return True


def remap_workshop_state(remap):
    """Remap track IDs in set_workshop_state.json."""
    path = os.path.join(_OUTPUT_DIR, "set_workshop_state.json")
    if not os.path.exists(path):
        return False

    with open(path) as f:
        data = json.load(f)

    for slot in data.get("slots", []):
        for track in slot.get("tracks", []):
            old_id = track.get("id")
            if old_id is not None:
                new_id = remap.get(int(old_id))
                if new_id is not None:
                    track["id"] = new_id

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return True


# ---------------------------------------------------------------------------
# Upload-time dedup (Option B gate)
# ---------------------------------------------------------------------------

def dedup_dataframe(df):
    """Deduplicate a DataFrame at upload time.

    Keeps the row with the richest data for each (artist, title) pair.
    Returns (deduped_df, num_duplicates_removed).
    """
    key_col = "_dedup_key"
    df[key_col] = df["artist"].apply(_normalise) + "||" + df["title"].apply(_normalise)

    # Score each row
    df["_dedup_score"] = df.apply(_row_richness, axis=1)

    # Sort so highest score is first, then drop_duplicates keeps first
    df = df.sort_values("_dedup_score", ascending=False)
    original_len = len(df)
    df = df.drop_duplicates(subset=[key_col], keep="first")
    removed = original_len - len(df)

    # Clean up temp columns and reset index
    df = df.drop(columns=[key_col, "_dedup_score"])
    df = df.sort_index().reset_index(drop=True)

    return df, removed


# ---------------------------------------------------------------------------
# Full cleanup orchestrator (Option C)
# ---------------------------------------------------------------------------

def execute_cleanup(df, winner_picks=None):
    """Run the full dedup cleanup: merge DataFrame + remap all JSON files.

    If winner_picks is None, auto-picks winners.
    Returns dict with results summary.
    """
    if winner_picks is None:
        groups = find_duplicate_groups(df)
        winner_picks = pick_winners(df, groups)

    if not winner_picks:
        return {"status": "no_duplicates", "removed": 0}

    total_removed = sum(len(p["losers"]) for p in winner_picks)

    # Build remap and new DataFrame
    new_df, remap = build_id_remap(df, winner_picks)

    # Remap all JSON files
    remap_results = {}
    _, pl_count = remap_playlists(remap)
    remap_results["playlists"] = pl_count

    _, sets_count = remap_saved_sets(remap)
    remap_results["saved_sets"] = sets_count

    for tree_file in ("collection_tree.json", "scene_tree.json", "curated_collection.json"):
        remap_results[tree_file] = remap_tree_file(tree_file, remap)

    remap_results["workshop_state"] = remap_workshop_state(remap)

    return {
        "status": "ok",
        "removed": total_removed,
        "kept": len(new_df),
        "duplicate_groups": len(winner_picks),
        "location_conflicts": sum(1 for p in winner_picks if p["location_conflict"]),
        "remap_results": remap_results,
        "new_df": new_df,
        "remap": remap,
    }
