"""Set Workshop — DJ set builder with energy wave, key flow, and vibe progression."""

import math
import re
from app.tree import find_node

# ---------------------------------------------------------------------------
# Camelot Wheel
# ---------------------------------------------------------------------------

# Map Camelot keys to (number, letter) for distance/compat calculations
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
        return True  # can't parse → don't filter
    if k1 == k2:
        return True
    n1, l1 = _CAMELOT[k1]
    n2, l2 = _CAMELOT[k2]
    # Same letter, adjacent number (wrapping 12↔1)
    if l1 == l2:
        diff = abs(n1 - n2)
        if diff <= 1 or diff == 11:
            return True
    # Same number, different letter (relative major/minor)
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
# Energy Wave Presets
# ---------------------------------------------------------------------------

ENERGY_PRESETS = {
    "classic_arc": {
        "label": "Classic Arc",
        "description": "Build → peak → wind down",
    },
    "double_peak": {
        "label": "Double Peak",
        "description": "Two crescendos with valley between",
    },
    "slow_burn": {
        "label": "Slow Burn",
        "description": "Gradual build throughout",
    },
    "steady_groove": {
        "label": "Steady Groove",
        "description": "Constant mid-tempo throughout",
    },
}


def generate_energy_wave(preset_name, num_slots, bpm_min=70, bpm_max=140):
    """Generate a list of target BPMs for each slot."""
    bpm_range = bpm_max - bpm_min
    n = max(num_slots, 1)

    if preset_name == "classic_arc":
        # Sine arc peaking around 60%
        return [
            round(bpm_min + bpm_range * math.sin(math.pi * i / (n - 1)), 1)
            if n > 1 else bpm_min + bpm_range * 0.5
            for i in range(n)
        ]

    if preset_name == "double_peak":
        peak1 = max(int(n * 0.3), 1)
        valley = max(int(n * 0.5), 2)
        peak2 = max(int(n * 0.75), 3)
        result = []
        for i in range(n):
            if i <= peak1:
                t = i / peak1
                result.append(round(bpm_min + bpm_range * t, 1))
            elif i <= valley:
                t = (i - peak1) / max(valley - peak1, 1)
                result.append(round(bpm_max - bpm_range * 0.3 * t, 1))
            elif i <= peak2:
                t = (i - valley) / max(peak2 - valley, 1)
                result.append(round(bpm_min + bpm_range * 0.7 + bpm_range * 0.3 * t, 1))
            else:
                t = (i - peak2) / max(n - 1 - peak2, 1)
                result.append(round(bpm_max - bpm_range * 0.6 * t, 1))
        return result

    if preset_name == "slow_burn":
        return [round(bpm_min + bpm_range * i / max(n - 1, 1), 1) for i in range(n)]

    if preset_name == "steady_groove":
        mid = round((bpm_min + bpm_max) / 2, 1)
        return [mid] * n

    # fallback
    return [round((bpm_min + bpm_max) / 2, 1)] * n


# ---------------------------------------------------------------------------
# Key Wave Presets
# ---------------------------------------------------------------------------

KEY_PRESETS = {
    "harmonic_flow": {
        "label": "Harmonic Flow",
        "description": "Walk the Camelot wheel smoothly",
    },
    "key_lock": {
        "label": "Key Lock",
        "description": "Stay in one key region",
    },
    "free": {
        "label": "Free",
        "description": "No key constraint (widest pool)",
    },
}

_CAMELOT_ORDER = [f"{n}{l}" for n in range(1, 13) for l in ("A", "B")]


def generate_key_wave(preset_name, num_slots, start_key="8B"):
    """Generate target Camelot keys per slot."""
    start = normalize_camelot(start_key) or "8B"
    n = max(num_slots, 1)

    if preset_name == "key_lock":
        # Alternate between start key and its relative major/minor
        num, letter = _CAMELOT[start]
        alt = f"{num}{'A' if letter == 'B' else 'B'}"
        return [start if i % 4 < 2 else alt for i in range(n)]

    if preset_name == "free":
        return [start] * n  # placeholder — selection ignores key

    # harmonic_flow: walk ±1 on Camelot wheel
    keys = [start]
    num, letter = _CAMELOT[start]
    direction = 1
    for _ in range(n - 1):
        num += direction
        if num > 12:
            num = 1
        elif num < 1:
            num = 12
        # Occasionally switch letter (every 4 steps)
        if len(keys) % 4 == 0:
            letter = "A" if letter == "B" else "B"
        keys.append(f"{num}{letter}")
    return keys


# ---------------------------------------------------------------------------
# Vibe Layout Helpers
# ---------------------------------------------------------------------------

def compute_vibe_layout(num_slots):
    """Compute 2-row offset vibe grid positions.

    Returns list of {row: 0|1, col_start: int, col_end: int} (0-indexed, inclusive).
    Pattern: row 0 at [0..2], [4..6], [8..10], ...
             row 1 at [2..4], [6..8], [10..12], ...
    """
    positions = []
    # Row 0: start at 0, step 4
    for start in range(0, num_slots, 4):
        end = min(start + 2, num_slots - 1)
        positions.append({"row": 0, "col_start": start, "col_end": end})
    # Row 1: start at 2, step 4
    for start in range(2, num_slots, 4):
        end = min(start + 2, num_slots - 1)
        positions.append({"row": 1, "col_start": start, "col_end": end})
    return sorted(positions, key=lambda p: (p["row"], p["col_start"]))


def get_slot_vibe_ids(slot_index, vibe_assignments):
    """Return list of node_ids that apply to a given slot (1 or 2 for overlap)."""
    ids = []
    for v in vibe_assignments:
        if v["col_start"] <= slot_index <= v["col_end"] and v.get("node_id"):
            ids.append(v["node_id"])
    return ids


def get_vibe_options(tree):
    """Extract leaves and branches from tree for vibe dropdown options."""
    if not tree:
        return []
    options = []
    for lineage in tree.get("lineages", []):
        _collect_vibe_nodes(lineage, options, parent_title=None, depth=0)
    return options


def _collect_vibe_nodes(node, options, parent_title, depth):
    options.append({
        "id": node.get("id"),
        "title": node.get("title", ""),
        "track_count": node.get("track_count", len(node.get("track_ids", []))),
        "depth": depth,
        "parent_title": parent_title or "",
        "is_leaf": node.get("is_leaf", False),
    })
    for child in node.get("children", []):
        _collect_vibe_nodes(child, options, node.get("title", ""), depth + 1)


def auto_fill_vibes(tree, num_slots, start_node_id=None):
    """Auto-fill vibe progression from tree leaves.

    Returns list of {row, col_start, col_end, node_id, title}.
    """
    layout = compute_vibe_layout(num_slots)

    # Collect all leaves in tree order
    leaves = []
    for lineage in tree.get("lineages", []):
        _collect_leaves(lineage, leaves)

    if not leaves:
        return [{"row": p["row"], "col_start": p["col_start"],
                 "col_end": p["col_end"], "node_id": None, "title": ""}
                for p in layout]

    # If start_node_id given, rotate leaves to start there
    if start_node_id:
        idx = next((i for i, l in enumerate(leaves) if l["id"] == start_node_id), 0)
        leaves = leaves[idx:] + leaves[:idx]

    # Assign leaves to positions, cycling if needed
    result = []
    for i, pos in enumerate(layout):
        leaf = leaves[i % len(leaves)]
        result.append({
            "row": pos["row"],
            "col_start": pos["col_start"],
            "col_end": pos["col_end"],
            "node_id": leaf["id"],
            "title": leaf.get("title", ""),
        })
    return result


def _collect_leaves(node, leaves):
    if node.get("is_leaf"):
        leaves.append(node)
    for child in node.get("children", []):
        _collect_leaves(child, leaves)


# ---------------------------------------------------------------------------
# Track Selection
# ---------------------------------------------------------------------------

def select_tracks_for_slot(df, target_bpm, target_key, vibe_node_ids,
                           tree, used_track_ids=None, num_tracks=5,
                           bpm_tolerance=10, key_mode="harmonic_flow"):
    """Select candidate tracks for one time slot.

    Returns list of track dicts [{id, title, artist, bpm, key, year}].
    """
    if used_track_ids is None:
        used_track_ids = set()

    # Step 1: gather candidate track ids from vibe nodes
    candidate_sets = []
    parent_node_ids = []
    for nid in vibe_node_ids:
        node = find_node(tree, nid)
        if node:
            candidate_sets.append(set(node.get("track_ids", [])))
            # Stash parent for fallback
            parent = _find_parent(tree, nid)
            if parent:
                parent_node_ids.append(parent.get("id"))

    if not candidate_sets:
        return []

    # Intersection for overlap slots, union otherwise
    if len(candidate_sets) == 1:
        candidates = candidate_sets[0]
    else:
        candidates = candidate_sets[0].intersection(*candidate_sets[1:])
        # If intersection too small, fall back to union
        if len(candidates) < num_tracks:
            candidates = set().union(*candidate_sets)

    # Remove already-used tracks
    candidates = candidates - set(used_track_ids)

    # Step 2-3: Filter by BPM and key with progressive relaxation
    for bpm_tol, key_dist in [(bpm_tolerance, 1), (bpm_tolerance * 2, 2),
                               (bpm_tolerance * 3, 99)]:
        filtered = _filter_and_score(df, candidates, target_bpm, target_key,
                                     bpm_tol, key_dist, key_mode)
        if len(filtered) >= num_tracks:
            break

    # Step 4: If still not enough, expand to parent branch tracks
    if len(filtered) < num_tracks and parent_node_ids:
        for pid in parent_node_ids:
            pnode = find_node(tree, pid)
            if pnode:
                parent_tracks = set(pnode.get("track_ids", [])) - set(used_track_ids)
                extra = _filter_and_score(df, parent_tracks, target_bpm, target_key,
                                          bpm_tolerance * 2, 99, key_mode)
                # Merge, avoiding duplicates
                seen = {t["id"] for t in filtered}
                for t in extra:
                    if t["id"] not in seen:
                        filtered.append(t)
                        seen.add(t["id"])
                if len(filtered) >= num_tracks:
                    break

    return filtered[:num_tracks]


def _filter_and_score(df, candidate_ids, target_bpm, target_key,
                      bpm_tolerance, max_key_dist, key_mode):
    """Filter candidate track ids by BPM/key and return scored list."""
    results = []
    for idx in candidate_ids:
        if idx not in df.index:
            continue
        row = df.loc[idx]

        # BPM filter
        bpm = row.get("bpm")
        if bpm is not None and not _is_nan(bpm):
            bpm_val = float(bpm)
            if abs(bpm_val - target_bpm) > bpm_tolerance:
                continue
            bpm_score = 1.0 - abs(bpm_val - target_bpm) / max(bpm_tolerance, 1)
        else:
            bpm_val = target_bpm
            bpm_score = 0.3  # unknown BPM gets low score

        # Key filter
        if key_mode != "free":
            track_key = str(row.get("key", ""))
            dist = camelot_distance(target_key, track_key)
            if dist > max_key_dist:
                continue
            key_score = 1.0 - dist * 0.3
        else:
            key_score = 1.0
            track_key = str(row.get("key", ""))

        score = bpm_score * 0.6 + key_score * 0.4

        results.append({
            "id": int(idx),
            "title": _sv(row.get("title", "")),
            "artist": _sv(row.get("artist", "")),
            "bpm": round(float(bpm_val), 1),
            "key": _sv(track_key),
            "year": _sv(row.get("year", "")),
            "_score": score,
        })

    results.sort(key=lambda t: t["_score"], reverse=True)
    # Remove internal score field
    for t in results:
        t.pop("_score", None)
    return results


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


# ---------------------------------------------------------------------------
# Full Set Generation
# ---------------------------------------------------------------------------

def generate_set(df, tree, tree_type, duration_minutes=60,
                 energy_preset="classic_arc", key_preset="harmonic_flow",
                 start_key="8B", vibe_assignments=None,
                 bpm_min=70, bpm_max=140, track_minutes=3):
    """Generate a complete DJ set.

    Returns dict with slots, energy_wave, key_wave, vibes, metadata.
    """
    num_slots = max(duration_minutes // track_minutes, 1)

    # Generate waves
    energy_wave = generate_energy_wave(energy_preset, num_slots, bpm_min, bpm_max)
    key_wave = generate_key_wave(key_preset, num_slots, start_key)

    # Vibe assignments: use provided or auto-fill
    if not vibe_assignments:
        vibes = auto_fill_vibes(tree, num_slots)
    else:
        vibes = vibe_assignments

    # Build slots
    used_ids = set()
    slots = []

    for i in range(num_slots):
        target_bpm = energy_wave[i]
        target_key = key_wave[i]
        vibe_ids = get_slot_vibe_ids(i, vibes)

        # Get vibe titles for display
        vibe_titles = []
        for vid in vibe_ids:
            node = find_node(tree, vid)
            if node:
                vibe_titles.append(node.get("title", vid))

        tracks = select_tracks_for_slot(
            df, target_bpm, target_key, vibe_ids,
            tree, used_track_ids=used_ids,
            bpm_tolerance=10, key_mode=key_preset,
        )

        # Add selected tracks to used set (only the default-selected one)
        if tracks:
            default_selected = min(2, len(tracks) - 1)
            used_ids.add(tracks[default_selected]["id"])
        else:
            default_selected = 0

        # Time label
        mins = i * track_minutes
        time_label = f"{mins // 60}:{mins % 60:02d}"

        slots.append({
            "index": i,
            "time_label": time_label,
            "target_bpm": round(target_bpm, 1),
            "target_key": target_key,
            "vibe_ids": vibe_ids,
            "vibe_titles": vibe_titles,
            "tracks": tracks,
            "selected_index": default_selected,
        })

    return {
        "slots": slots,
        "energy_wave": [round(v, 1) for v in energy_wave],
        "key_wave": key_wave,
        "vibes": vibes,
        "metadata": {
            "duration": duration_minutes,
            "num_slots": num_slots,
            "energy_preset": energy_preset,
            "key_preset": key_preset,
            "start_key": start_key,
            "tree_type": tree_type,
            "bpm_min": bpm_min,
            "bpm_max": bpm_max,
        },
    }
