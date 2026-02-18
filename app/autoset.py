"""Auto Set — narrative-driven DJ set builder with multi-phase LLM pipeline.

Selects a track pool (from playlist or tree leaf), generates a narrative arc,
assigns tracks to phase acts, orders them for flow, and produces a Workshop Set.
"""

import json
import logging
import math
import re
from collections import Counter

import pandas as pd

from app.parser import parse_all_comments
from app.phases import get_profile
from app.setbuilder import (
    select_tracks_for_source,
    create_saved_set,
    normalize_camelot,
    camelot_distance,
)
from app.tree import (
    _call_llm,
    _extract_json,
    _get_tiered_model,
    COLLECTION_TREE_MODELS,
    load_tree,
    find_node,
    TREE_PROFILES,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TARGET_SET_SLOTS = 40  # 40 slots × 3 min = 2 hours
SLOT_MINUTES = 3

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_AUTOSET_SYSTEM_PROMPT = (
    "You are a world-class DJ and music programmer with deep understanding of "
    "set dramaturgy — how DJ sets tell stories through energy, mood, and genre "
    "progression. You understand the four layers of set construction:\n"
    "1. Technical compatibility (BPM, key)\n"
    "2. Emotional semantics (mood, energy, groove feel)\n"
    "3. Temporal dramaturgy (tension, release, pacing over time)\n"
    "4. Cultural narrative (genre journeys, scene references)\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_nan(val):
    try:
        return math.isnan(float(val))
    except (TypeError, ValueError):
        return False


def _safe_val(val):
    """JSON-safe value — handle numpy/pandas types."""
    if _is_nan(val):
        return ""
    if hasattr(val, "item"):
        return val.item()
    return val


def _parse_mood_tokens(mood_str):
    """Split a mood string into lowercase tokens."""
    if not mood_str or not isinstance(mood_str, str):
        return set()
    tokens = re.split(r"[,/&]+|\band\b", mood_str)
    return {t.strip().lower() for t in tokens if t.strip() and len(t.strip()) > 2}


def _parse_descriptor_tokens(desc_str):
    """Split a descriptor string into lowercase tokens."""
    if not desc_str or not isinstance(desc_str, str):
        return set()
    tokens = re.split(r"[,/&]+|\band\b", desc_str)
    return {t.strip().lower() for t in tokens if t.strip() and len(t.strip()) > 2}


# ---------------------------------------------------------------------------
# Phase 1 — Pool Analysis (algorithmic, no LLM)
# ---------------------------------------------------------------------------


def analyze_pool(df, track_ids, trees=None):
    """Analyze a track pool and produce a structured profile.

    Args:
        df: DataFrame with track data (facet columns will be ensured).
        track_ids: list of track indices to analyze.
        trees: dict with optional 'genre', 'scene', 'collection' tree dicts
               for context lookup.

    Returns:
        dict with pool statistics and context.
    """
    parse_all_comments(df)

    # Filter to valid track IDs
    valid_ids = [idx for idx in track_ids if idx in df.index]
    if not valid_ids:
        return {"error": "No valid tracks in pool", "track_count": 0}

    sub = df.loc[valid_ids]

    # --- BPM analysis ---
    bpms = []
    for idx in valid_ids:
        bpm = df.loc[idx].get("bpm")
        if bpm is not None and not _is_nan(bpm):
            bpms.append(float(bpm))

    bpm_stats = {}
    if bpms:
        bpms_sorted = sorted(bpms)
        bpm_stats = {
            "min": round(min(bpms), 1),
            "max": round(max(bpms), 1),
            "median": round(bpms_sorted[len(bpms_sorted) // 2], 1),
            "mean": round(sum(bpms) / len(bpms), 1),
            "count_with_bpm": len(bpms),
            "histogram": _bpm_histogram(bpms),
        }

    # --- Key distribution ---
    key_counts = Counter()
    for idx in valid_ids:
        key = normalize_camelot(str(df.loc[idx].get("key", "")))
        if key:
            key_counts[key] += 1
    key_dist = [{"key": k, "count": c} for k, c in key_counts.most_common(24)]

    # --- Genre breakdown ---
    g1 = sub["_genre1"][sub["_genre1"] != ""]
    g2 = sub["_genre2"][sub["_genre2"] != ""]
    all_genres = pd.concat([g1, g2])
    genre_counts = Counter(all_genres)
    top_genres = [{"genre": g, "count": c} for g, c in genre_counts.most_common(20)]

    # --- Mood spectrum ---
    mood_counter = Counter()
    for mood_val in sub["_mood"][sub["_mood"] != ""]:
        for token in _parse_mood_tokens(str(mood_val)):
            mood_counter[token] += 1
    top_moods = [{"mood": m, "count": c} for m, c in mood_counter.most_common(20)]

    # --- Descriptor frequency ---
    desc_counter = Counter()
    for desc_val in sub["_descriptors"][sub["_descriptors"] != ""]:
        for token in _parse_descriptor_tokens(str(desc_val)):
            desc_counter[token] += 1
    top_descriptors = [{"descriptor": d, "count": c}
                       for d, c in desc_counter.most_common(20)]

    # --- Location/era ---
    loc_counts = Counter(sub["_location"][sub["_location"] != ""])
    top_locations = [{"location": l, "count": c}
                     for l, c in loc_counts.most_common(10)]

    era_counts = Counter(sub["_era"][sub["_era"] != ""])
    top_eras = [{"era": e, "count": c} for e, c in era_counts.most_common(10)]

    # --- Tree context ---
    tree_context = _lookup_tree_context(valid_ids, trees) if trees else {}

    return {
        "track_count": len(valid_ids),
        "tracks_with_bpm": bpm_stats.get("count_with_bpm", 0),
        "bpm": bpm_stats,
        "keys": key_dist,
        "genres": top_genres,
        "moods": top_moods,
        "descriptors": top_descriptors,
        "locations": top_locations,
        "eras": top_eras,
        "tree_context": tree_context,
    }


def _bpm_histogram(bpms, bucket_size=5):
    """Create BPM histogram with given bucket size."""
    if not bpms:
        return []
    min_bpm = int(min(bpms) // bucket_size) * bucket_size
    max_bpm = int(max(bpms) // bucket_size + 1) * bucket_size
    buckets = {}
    for bpm in bpms:
        bucket = int(bpm // bucket_size) * bucket_size
        buckets[bucket] = buckets.get(bucket, 0) + 1
    return [{"bpm_range": f"{b}-{b + bucket_size}", "count": buckets.get(b, 0)}
            for b in range(min_bpm, max_bpm + 1, bucket_size)]


def _lookup_tree_context(track_ids, trees):
    """Find which tree leaves contain the pool tracks.

    Returns summary of genre/scene/collection context.
    """
    context = {}
    track_set = set(int(t) for t in track_ids)

    for tree_type in ("genre", "scene", "collection"):
        tree = trees.get(tree_type)
        if not tree:
            continue

        leaf_hits = []  # [{leaf_title, leaf_id, overlap_count, total_in_leaf}]

        if tree_type == "collection":
            # Flat structure: categories → leaves
            for cat in tree.get("categories", []):
                for leaf in cat.get("leaves", []):
                    leaf_ids = set(int(t) for t in leaf.get("track_ids", []))
                    overlap = track_set & leaf_ids
                    if overlap:
                        leaf_hits.append({
                            "leaf_id": leaf["id"],
                            "leaf_title": leaf.get("title", ""),
                            "category": cat.get("title", ""),
                            "overlap_count": len(overlap),
                            "total_in_leaf": len(leaf_ids),
                            "genre_context": leaf.get("genre_context", ""),
                            "scene_context": leaf.get("scene_context", ""),
                        })
        else:
            # Hierarchical: lineages → children → leaves
            for lineage in tree.get("lineages", []):
                _collect_leaf_hits(lineage, track_set, leaf_hits,
                                  lineage_title=lineage.get("title", ""))

        # Sort by overlap count descending, take top 10
        leaf_hits.sort(key=lambda x: x["overlap_count"], reverse=True)
        context[tree_type] = leaf_hits[:10]

    return context


def _collect_leaf_hits(node, track_set, hits, lineage_title=""):
    """Recursively collect leaf nodes that overlap with track_set."""
    node_ids = set(int(t) for t in node.get("track_ids", []))
    overlap = track_set & node_ids

    if node.get("is_leaf") and overlap:
        hits.append({
            "leaf_id": node["id"],
            "leaf_title": node.get("title", ""),
            "lineage": lineage_title,
            "overlap_count": len(overlap),
            "total_in_leaf": len(node_ids),
        })

    for child in node.get("children", []):
        _collect_leaf_hits(child, track_set, hits, lineage_title)


# ---------------------------------------------------------------------------
# Phase 2 — Narrative Arc Generation (LLM, creative)
# ---------------------------------------------------------------------------


def generate_narrative_arc(pool_profile, phase_profile, client, model_config,
                           progress_cb=None, stop_flag=None):
    """Generate a narrative arc and act definitions for the set.

    Args:
        pool_profile: dict from analyze_pool()
        phase_profile: dict from phases.get_profile() (phases list + metadata)
        client: LLM client
        model_config: dict with 'creative'/'mechanical' model names
        progress_cb: callable(phase, detail, pct)
        stop_flag: threading.Event

    Returns:
        dict with 'narrative' (str) and 'acts' (list of act dicts)
    """
    model, provider = _get_tiered_model("creative", model_config)

    phases = phase_profile.get("phases", [])
    total_tracks = TARGET_SET_SLOTS

    # Build the prompt
    phase_skeleton = []
    for p in phases:
        pct_range = p["pct"]
        slot_count = max(1, round(total_tracks * (pct_range[1] - pct_range[0]) / 100))
        phase_skeleton.append({
            "name": p["name"],
            "pct": pct_range,
            "description": p.get("desc", ""),
            "target_track_count": slot_count,
        })

    user_prompt = json.dumps({
        "task": "generate_narrative_arc",
        "instructions": (
            "You are programming a 2-hour DJ set from the track pool described below. "
            "The set follows the given phase structure. Your job is to:\n"
            "1. Write a 'narrative' — a 2-3 paragraph story describing the emotional "
            "and musical journey this set will take, specific to the music available.\n"
            "2. For each phase, define an 'act' with specific criteria calibrated to "
            "THIS pool's actual data ranges (not generic advice).\n\n"
            "IMPORTANT: BPM targets, mood targets, and genre guidance must be drawn "
            "from the actual pool statistics provided. Don't invent moods or genres "
            "that aren't in the pool."
        ),
        "pool_profile": {
            "track_count": pool_profile["track_count"],
            "bpm": pool_profile.get("bpm", {}),
            "genres": pool_profile.get("genres", [])[:15],
            "moods": pool_profile.get("moods", [])[:15],
            "descriptors": pool_profile.get("descriptors", [])[:15],
            "locations": pool_profile.get("locations", [])[:10],
            "eras": pool_profile.get("eras", [])[:10],
            "tree_context": _summarize_tree_context(
                pool_profile.get("tree_context", {})),
        },
        "phase_structure": phase_skeleton,
        "response_format": {
            "narrative": "string — 2-3 paragraphs describing the set's journey",
            "acts": [
                {
                    "name": "phase name (must match phase_structure)",
                    "pct": [0, 15],
                    "target_track_count": 6,
                    "bpm_range": [90, 105],
                    "energy_level": "1-10 integer",
                    "mood_targets": ["list of mood keywords from pool"],
                    "genre_guidance": ["list of genres to favor"],
                    "descriptor_guidance": ["list of descriptors to favor"],
                    "direction": "ascending|descending|steady|varied",
                    "transition_note": "how to transition INTO this act",
                }
            ],
        },
    }, indent=2)

    if progress_cb:
        progress_cb("narrative_arc", "Generating narrative arc...", 12)

    raw = _call_llm(client, model, provider, _AUTOSET_SYSTEM_PROMPT,
                    user_prompt, max_tokens=4096)

    if progress_cb:
        progress_cb("narrative_arc", "Parsing narrative response...", 25)

    result = _extract_json(raw)

    # Validate structure
    if not isinstance(result, dict) or "narrative" not in result or "acts" not in result:
        raise ValueError("LLM response missing 'narrative' or 'acts' fields")

    # Ensure act pcts and names match the phase structure
    acts = result["acts"]
    for i, act in enumerate(acts):
        if i < len(phases):
            act["pct"] = phases[i]["pct"]
            act["color"] = phases[i].get("color", "#888888")

    return result


def _summarize_tree_context(tree_context):
    """Compress tree context for the LLM prompt (avoid token bloat)."""
    summary = {}
    for tree_type, hits in tree_context.items():
        if not hits:
            continue
        summary[tree_type] = [
            {
                "title": h.get("leaf_title", ""),
                "overlap": h.get("overlap_count", 0),
                **({"genre_context": h["genre_context"]}
                   if h.get("genre_context") else {}),
                **({"scene_context": h["scene_context"]}
                   if h.get("scene_context") else {}),
                **({"lineage": h["lineage"]}
                   if h.get("lineage") else {}),
                **({"category": h["category"]}
                   if h.get("category") else {}),
            }
            for h in hits[:5]
        ]
    return summary


# ---------------------------------------------------------------------------
# Phase 3 — Track-to-Act Assignment (hybrid)
# ---------------------------------------------------------------------------


def assign_tracks_to_acts(df, track_ids, acts, client, model_config,
                          progress_cb=None, stop_flag=None):
    """Score and assign tracks to narrative acts.

    Args:
        df: DataFrame with parsed facet columns.
        track_ids: list of all track indices in the pool.
        acts: list of act dicts from generate_narrative_arc().
        client: LLM client.
        model_config: model config dict.
        progress_cb: callable(phase, detail, pct).
        stop_flag: threading.Event.

    Returns:
        dict mapping act index -> list of (track_id, score) tuples, sorted by score.
    """
    parse_all_comments(df)

    if progress_cb:
        progress_cb("track_assignment", f"Scoring {len(track_ids)} tracks against {len(acts)} acts...", 32)

    # Score every track against every act
    track_scores = {}  # track_id -> [(act_idx, score)]
    for idx in track_ids:
        if idx not in df.index:
            continue
        row = df.loc[idx]
        scores = []
        for act_idx, act in enumerate(acts):
            score = _score_track_for_act(row, act)
            scores.append((act_idx, score))
        track_scores[int(idx)] = scores

    # Greedy assignment: each track to its highest-scoring act
    assignments = {i: [] for i in range(len(acts))}
    for tid, scores in track_scores.items():
        best_act = max(scores, key=lambda x: x[1])
        assignments[best_act[0]].append((tid, best_act[1]))

    # Sort each act's tracks by score descending
    for act_idx in assignments:
        assignments[act_idx].sort(key=lambda x: x[1], reverse=True)

    if progress_cb:
        counts = {acts[i]["name"]: len(v) for i, v in assignments.items()}
        progress_cb("track_assignment", f"Initial assignment: {counts}", 38)

    # Balance check: redistribute from over-subscribed to under-subscribed
    assignments = _balance_assignments(assignments, acts, track_scores)

    if progress_cb:
        progress_cb("track_assignment", "Reviewing borderline assignments...", 42)

    # LLM review of borderline tracks
    borderline = _find_borderline_tracks(track_scores, assignments)
    if borderline and len(borderline) > 0:
        assignments = _llm_review_borderlines(
            df, borderline, acts, assignments, client, model_config)

    if progress_cb:
        counts = {acts[i]["name"]: len(v) for i, v in assignments.items()}
        progress_cb("track_assignment", f"Final assignment: {counts}", 52)

    return assignments


def _score_track_for_act(row, act):
    """Score a single track against an act's criteria. Returns 0.0-1.0."""
    score = 0.0
    weights_total = 0.0

    # --- BPM fit (weight: 30%) ---
    bpm = row.get("bpm")
    bpm_range = act.get("bpm_range", [])
    if bpm is not None and not _is_nan(bpm) and len(bpm_range) == 2:
        bpm_val = float(bpm)
        bpm_lo, bpm_hi = float(bpm_range[0]), float(bpm_range[1])
        bpm_mid = (bpm_lo + bpm_hi) / 2
        bpm_spread = max((bpm_hi - bpm_lo) / 2, 5)
        # Gaussian-ish: 1.0 at center, decays outward
        dist = abs(bpm_val - bpm_mid)
        bpm_score = max(0, 1.0 - (dist / (bpm_spread * 2)) ** 2)
        score += bpm_score * 0.30
        weights_total += 0.30

    # --- Mood alignment (weight: 30%) ---
    mood_targets = set(m.lower() for m in act.get("mood_targets", []))
    track_moods = _parse_mood_tokens(str(row.get("_mood", "")))
    if mood_targets and track_moods:
        overlap = mood_targets & track_moods
        jaccard = len(overlap) / max(len(mood_targets | track_moods), 1)
        score += jaccard * 0.30
        weights_total += 0.30
    elif mood_targets:
        weights_total += 0.30  # no mood on track = 0 score for this component

    # --- Genre match (weight: 25%) ---
    genre_guidance = set(g.lower() for g in act.get("genre_guidance", []))
    track_genres = set()
    g1 = str(row.get("_genre1", "")).strip().lower()
    g2 = str(row.get("_genre2", "")).strip().lower()
    if g1:
        track_genres.add(g1)
    if g2:
        track_genres.add(g2)
    if genre_guidance and track_genres:
        overlap = genre_guidance & track_genres
        genre_score = len(overlap) / max(len(genre_guidance), 1)
        score += genre_score * 0.25
        weights_total += 0.25
    elif genre_guidance:
        weights_total += 0.25

    # --- Descriptor match (weight: 15%) ---
    desc_guidance = set(d.lower() for d in act.get("descriptor_guidance", []))
    track_descs = _parse_descriptor_tokens(str(row.get("_descriptors", "")))
    if desc_guidance and track_descs:
        overlap = desc_guidance & track_descs
        desc_score = len(overlap) / max(len(desc_guidance), 1)
        score += desc_score * 0.15
        weights_total += 0.15
    elif desc_guidance:
        weights_total += 0.15

    # Normalize by actual weights used
    if weights_total > 0:
        return score / weights_total
    return 0.0


def _balance_assignments(assignments, acts, track_scores):
    """Redistribute tracks from over-subscribed acts to under-subscribed ones."""
    for _ in range(3):  # max 3 passes
        moved = 0
        for act_idx, act in enumerate(acts):
            target = act.get("target_track_count", 8)
            tracks = assignments[act_idx]

            # Only redistribute if we have >2× target (generous threshold)
            if len(tracks) <= target * 2:
                continue

            # Find acts that are under-subscribed
            under = [
                i for i, a in enumerate(acts)
                if len(assignments[i]) < a.get("target_track_count", 8) * 0.5
                and i != act_idx
            ]
            if not under:
                continue

            # Move lowest-scoring tracks from this act to their 2nd-best act
            excess = tracks[target * 2:]  # keep top 2× target
            for tid, _ in excess:
                all_scores = track_scores.get(tid, [])
                # Find best under-subscribed act for this track
                best_alt = None
                best_alt_score = -1
                for alt_idx, alt_score in all_scores:
                    if alt_idx in under and alt_score > best_alt_score:
                        best_alt = alt_idx
                        best_alt_score = alt_score

                if best_alt is not None:
                    assignments[act_idx] = [
                        (t, s) for t, s in assignments[act_idx] if t != tid
                    ]
                    assignments[best_alt].append((tid, best_alt_score))
                    moved += 1

        if moved == 0:
            break

    # Re-sort each act
    for act_idx in assignments:
        assignments[act_idx].sort(key=lambda x: x[1], reverse=True)

    return assignments


def _find_borderline_tracks(track_scores, assignments):
    """Find tracks whose top-2 act scores are within 10% of each other."""
    borderline = []
    assigned_act = {}
    for act_idx, tracks in assignments.items():
        for tid, _ in tracks:
            assigned_act[tid] = act_idx

    for tid, scores in track_scores.items():
        sorted_scores = sorted(scores, key=lambda x: x[1], reverse=True)
        if len(sorted_scores) >= 2:
            top_score = sorted_scores[0][1]
            second_score = sorted_scores[1][1]
            if top_score > 0 and (top_score - second_score) / top_score < 0.10:
                borderline.append({
                    "track_id": tid,
                    "assigned_act": assigned_act.get(tid),
                    "top_acts": [
                        {"act_idx": idx, "score": round(s, 3)}
                        for idx, s in sorted_scores[:3]
                    ],
                })

    return borderline[:30]  # Cap at 30 borderline tracks for LLM review


def _llm_review_borderlines(df, borderline, acts, assignments, client, model_config):
    """Ask LLM to adjudicate borderline track assignments."""
    model, provider = _get_tiered_model("mechanical", model_config)

    # Build compact track info for borderline tracks
    track_info = []
    for b in borderline:
        tid = b["track_id"]
        if tid not in df.index:
            continue
        row = df.loc[tid]
        track_info.append({
            "track_id": tid,
            "title": _safe_val(row.get("title", "")),
            "artist": _safe_val(row.get("artist", "")),
            "bpm": round(float(row.get("bpm", 0)), 1) if not _is_nan(row.get("bpm")) else None,
            "mood": _safe_val(row.get("_mood", "")),
            "genre1": _safe_val(row.get("_genre1", "")),
            "genre2": _safe_val(row.get("_genre2", "")),
            "currently_assigned_act": b["assigned_act"],
            "candidate_acts": b["top_acts"],
        })

    act_summaries = [
        {"index": i, "name": a["name"], "mood_targets": a.get("mood_targets", []),
         "bpm_range": a.get("bpm_range", []), "energy_level": a.get("energy_level", 5)}
        for i, a in enumerate(acts)
    ]

    user_prompt = json.dumps({
        "task": "review_borderline_assignments",
        "instructions": (
            "These tracks scored nearly equally across multiple acts. "
            "For each track, decide which act is the BEST fit based on the "
            "track's mood, genre, and BPM relative to the act's targets. "
            "Consider the overall set narrative — where would this track "
            "serve the story best?"
        ),
        "acts": act_summaries,
        "borderline_tracks": track_info,
        "response_format": {
            "reassignments": [
                {"track_id": 123, "new_act_idx": 2}
            ]
        },
    }, indent=2)

    try:
        raw = _call_llm(client, model, provider, _AUTOSET_SYSTEM_PROMPT,
                        user_prompt, max_tokens=2048)
        result = _extract_json(raw)
        reassignments = result.get("reassignments", [])

        for r in reassignments:
            tid = r["track_id"]
            new_act = r["new_act_idx"]
            if new_act < 0 or new_act >= len(acts):
                continue
            # Remove from current act
            for act_idx in assignments:
                assignments[act_idx] = [
                    (t, s) for t, s in assignments[act_idx] if t != tid
                ]
            # Add to new act (with a placeholder score)
            assignments[new_act].append((tid, 0.5))

        # Re-sort
        for act_idx in assignments:
            assignments[act_idx].sort(key=lambda x: x[1], reverse=True)

    except Exception as e:
        logger.warning("LLM borderline review failed (non-fatal): %s", e)

    return assignments


# ---------------------------------------------------------------------------
# Phase 4 — Track Ordering & Selection (hybrid)
# ---------------------------------------------------------------------------


def order_and_select_tracks(df, assignments, acts, client, model_config,
                            progress_cb=None, stop_flag=None):
    """Select target tracks per act and order them for flow.

    Args:
        df: DataFrame with track data.
        assignments: dict from assign_tracks_to_acts() — act_idx -> [(tid, score)].
        acts: list of act dicts from generate_narrative_arc().
        client: LLM client.
        model_config: model config dict.

    Returns:
        list of track dicts in play order, each with 'act_idx' and 'act_name'.
    """
    if progress_cb:
        progress_cb("track_ordering", "Selecting and ordering tracks...", 58)

    parse_all_comments(df)
    ordered_tracks = []

    for act_idx, act in enumerate(acts):
        target_count = act.get("target_track_count", 8)
        candidates = assignments.get(act_idx, [])

        # Select top tracks, ensuring BPM and key variety
        selected = _select_diverse_tracks(df, candidates, target_count, act)

        # Order within act by BPM direction + key compatibility
        direction = act.get("direction", "ascending")
        ordered = _order_within_act(df, selected, direction)

        for tid in ordered:
            row = df.loc[tid]
            ordered_tracks.append({
                "track_id": int(tid),
                "act_idx": act_idx,
                "act_name": act["name"],
                "title": _safe_val(row.get("title", "")),
                "artist": _safe_val(row.get("artist", "")),
                "bpm": round(float(row.get("bpm", 0)), 1) if not _is_nan(row.get("bpm")) else None,
                "key": _safe_val(row.get("key", "")),
                "mood": _safe_val(row.get("_mood", "")),
                "genre1": _safe_val(row.get("_genre1", "")),
            })

    if progress_cb:
        progress_cb("track_ordering", f"Selected {len(ordered_tracks)} tracks, reviewing sequence...", 65)

    # LLM review of full sequence
    ordered_tracks = _llm_review_sequence(
        df, ordered_tracks, acts, client, model_config)

    if progress_cb:
        progress_cb("track_ordering", f"Final tracklist: {len(ordered_tracks)} tracks", 78)

    return ordered_tracks


def _select_diverse_tracks(df, candidates, target_count, act):
    """Select tracks ensuring BPM and key diversity."""
    if len(candidates) <= target_count:
        return [tid for tid, _ in candidates]

    selected = []
    used_bpm_buckets = set()
    used_keys = Counter()

    for tid, score in candidates:
        if len(selected) >= target_count:
            break
        row = df.loc[tid]
        bpm = row.get("bpm")
        bpm_bucket = int(float(bpm) // 3) * 3 if bpm and not _is_nan(bpm) else None
        key = normalize_camelot(str(row.get("key", "")))

        # Prefer tracks that add BPM/key diversity
        if bpm_bucket in used_bpm_buckets and len(selected) > target_count * 0.5:
            continue  # Skip if we already have this BPM range and have enough tracks
        if key and used_keys.get(key, 0) >= 2 and len(selected) > target_count * 0.5:
            continue  # Skip if same key appears 3+ times

        selected.append(tid)
        if bpm_bucket is not None:
            used_bpm_buckets.add(bpm_bucket)
        if key:
            used_keys[key] += 1

    # If we still need more, fill from remaining candidates
    remaining = [tid for tid, _ in candidates if tid not in selected]
    while len(selected) < target_count and remaining:
        selected.append(remaining.pop(0))

    return selected


def _order_within_act(df, track_ids, direction="ascending"):
    """Order tracks within an act by BPM direction and key compatibility."""
    if len(track_ids) <= 1:
        return track_ids

    # Build track info
    tracks = []
    for tid in track_ids:
        row = df.loc[tid]
        bpm = row.get("bpm")
        bpm_val = float(bpm) if bpm and not _is_nan(bpm) else 0
        key = normalize_camelot(str(row.get("key", "")))
        tracks.append({"id": tid, "bpm": bpm_val, "key": key})

    # Sort by BPM based on direction
    if direction == "descending":
        tracks.sort(key=lambda t: t["bpm"], reverse=True)
    elif direction == "steady":
        # Group by similarity, no strong ordering
        tracks.sort(key=lambda t: t["bpm"])
    else:
        # ascending or varied — default to ascending BPM
        tracks.sort(key=lambda t: t["bpm"])

    # Optimize key adjacency (simple greedy swap)
    ordered = [tracks[0]]
    remaining = tracks[1:]

    while remaining:
        last_key = ordered[-1]["key"]
        # Find the closest key match among remaining
        best_idx = 0
        best_dist = 999
        for i, t in enumerate(remaining):
            dist = camelot_distance(last_key, t["key"]) if last_key and t["key"] else 6
            # Bias toward maintaining BPM order
            bpm_penalty = abs(i - 0) * 0.5  # penalize large jumps in order
            total = dist + bpm_penalty
            if total < best_dist:
                best_dist = total
                best_idx = i
        ordered.append(remaining.pop(best_idx))

    return [t["id"] for t in ordered]


def _llm_review_sequence(df, ordered_tracks, acts, client, model_config):
    """LLM reviews the full track sequence for narrative coherence."""
    model, provider = _get_tiered_model("creative", model_config)

    # Build compact tracklist for review
    tracklist = []
    for i, t in enumerate(ordered_tracks):
        tracklist.append({
            "position": i + 1,
            "track_id": t["track_id"],
            "title": t["title"],
            "artist": t["artist"],
            "bpm": t["bpm"],
            "key": t["key"],
            "mood": t["mood"],
            "act": t["act_name"],
        })

    act_summaries = [{"name": a["name"], "pct": a["pct"]} for a in acts]

    user_prompt = json.dumps({
        "task": "review_track_sequence",
        "instructions": (
            "Review this DJ set tracklist for flow and narrative coherence. "
            "Check for:\n"
            "1. Jarring BPM jumps between consecutive tracks (>5 BPM = flag)\n"
            "2. Poor transitions between acts (mood/energy mismatch)\n"
            "3. Key clashes between consecutive tracks\n\n"
            "Suggest up to 3 swaps to improve flow. Each swap moves a track "
            "to a different position. Only suggest swaps that meaningfully "
            "improve the set — if the sequence is already good, return empty swaps."
        ),
        "acts": act_summaries,
        "tracklist": tracklist,
        "response_format": {
            "assessment": "string — brief assessment of the sequence quality",
            "swaps": [
                {"from_position": 5, "to_position": 8,
                 "reason": "why this swap improves the set"}
            ]
        },
    }, indent=2)

    try:
        raw = _call_llm(client, model, provider, _AUTOSET_SYSTEM_PROMPT,
                        user_prompt, max_tokens=2048)
        result = _extract_json(raw)
        swaps = result.get("swaps", [])

        # Apply swaps
        for swap in swaps[:3]:
            from_pos = swap.get("from_position", 0) - 1  # 1-indexed to 0-indexed
            to_pos = swap.get("to_position", 0) - 1
            if (0 <= from_pos < len(ordered_tracks) and
                    0 <= to_pos < len(ordered_tracks)):
                ordered_tracks[from_pos], ordered_tracks[to_pos] = \
                    ordered_tracks[to_pos], ordered_tracks[from_pos]
                logger.info("[autoset] Swap: pos %d <-> %d: %s",
                            from_pos + 1, to_pos + 1,
                            swap.get("reason", ""))

    except Exception as e:
        logger.warning("LLM sequence review failed (non-fatal): %s", e)

    return ordered_tracks


# ---------------------------------------------------------------------------
# Phase 5 — Workshop Assembly (algorithmic, no LLM)
# ---------------------------------------------------------------------------


def assemble_workshop_set(df, ordered_tracks, acts, assignments, set_name,
                          phase_profile_id=None, progress_cb=None):
    """Convert ordered tracklist into a Workshop Set with BPM slot options.

    Args:
        df: DataFrame with track data.
        ordered_tracks: list of track dicts from order_and_select_tracks().
        acts: list of act dicts.
        assignments: dict from assign_tracks_to_acts() (for alternative track pools).
        set_name: name for the saved set.
        phase_profile_id: ID of the phase profile used.

    Returns:
        dict with 'set' (saved set dict) and 'slots' (list of slot dicts).
    """
    if progress_cb:
        progress_cb("assembly", "Building workshop slots...", 82)

    slots = []
    used_ids = set()

    for i, track in enumerate(ordered_tracks):
        tid = track["track_id"]
        act_idx = track["act_idx"]
        used_ids.add(tid)

        # Pool for BPM alternatives: all tracks assigned to the same act
        act_track_ids = [t for t, _ in assignments.get(act_idx, [])]

        # Use existing slot-filling logic
        bpm_options = select_tracks_for_source(
            df, act_track_ids,
            used_track_ids=used_ids - {tid},
            anchor_track_id=tid,
        )

        # Find which BPM level the anchor landed on
        selected_idx = 0
        for j, opt in enumerate(bpm_options):
            if opt and opt.get("id") == tid:
                selected_idx = j
                break

        slot = {
            "id": f"autoset-slot-{i}",
            "source": {
                "type": "autoset",
                "id": f"act-{act_idx}",
                "name": track["act_name"],
            },
            "tracks": bpm_options,
            "selectedTrackIndex": selected_idx,
        }
        slots.append(slot)

        if progress_cb and i % 5 == 0:
            progress_cb("assembly",
                         f"Built slot {i + 1}/{len(ordered_tracks)}...",
                         82 + int(16 * i / len(ordered_tracks)))

    # Save as a named set
    saved = create_saved_set(set_name, slots)

    # Attach phase profile
    if phase_profile_id:
        saved["phase_profile_id"] = phase_profile_id

    if progress_cb:
        progress_cb("assembly", f"Set '{set_name}' saved with {len(slots)} slots", 98)

    return {
        "set": saved,
        "slots": slots,
    }


# ---------------------------------------------------------------------------
# Main pipeline orchestrator
# ---------------------------------------------------------------------------


def build_autoset(df, track_ids, phase_profile_id, client, model_config,
                  set_name="Auto Set", trees=None,
                  progress_cb=None, stop_flag=None):
    """Run the full 5-phase Auto Set pipeline.

    Args:
        df: DataFrame with track data.
        track_ids: list of track indices for the source pool.
        phase_profile_id: phase profile ID (e.g. 'classic_arc').
        client: LLM API client.
        model_config: dict with 'creative'/'mechanical' model names.
        set_name: name for the output set.
        trees: dict with 'genre'/'scene'/'collection' tree dicts (optional).
        progress_cb: callable(phase, detail, pct) for SSE updates.
        stop_flag: threading.Event for graceful cancellation.

    Returns:
        dict with full pipeline result (narrative, acts, tracklist, set).
    """

    def should_stop():
        return stop_flag and stop_flag.is_set()

    def progress(phase, detail, pct):
        logger.info("[autoset] %s (%d%%) — %s", phase, pct, detail)
        if progress_cb:
            progress_cb(phase, detail, pct)

    # --- Phase 1: Pool Analysis ---
    progress("pool_analysis", f"Analyzing {len(track_ids)} tracks...", 2)
    pool_profile = analyze_pool(df, track_ids, trees=trees)

    if pool_profile.get("error"):
        raise ValueError(pool_profile["error"])

    progress("pool_analysis",
             f"Pool: {pool_profile['track_count']} tracks, "
             f"BPM {pool_profile.get('bpm', {}).get('min', '?')}-"
             f"{pool_profile.get('bpm', {}).get('max', '?')}, "
             f"{len(pool_profile.get('genres', []))} genres, "
             f"{len(pool_profile.get('moods', []))} moods",
             8)

    if should_stop():
        return {"stopped": True}

    # --- Phase 2: Narrative Arc Generation ---
    progress("narrative_arc", "Generating narrative arc...", 10)
    phase_profile = get_profile(phase_profile_id)
    if not phase_profile:
        raise ValueError(f"Phase profile '{phase_profile_id}' not found")

    arc = generate_narrative_arc(pool_profile, phase_profile, client, model_config,
                                 progress_cb=progress, stop_flag=stop_flag)

    progress("narrative_arc",
             f"Narrative generated — {len(arc['acts'])} acts defined", 28)

    if should_stop():
        return {"stopped": True}

    # --- Phase 3: Track-to-Act Assignment ---
    progress("track_assignment", "Assigning tracks to acts...", 30)
    assignments = assign_tracks_to_acts(df, track_ids, arc["acts"], client,
                                         model_config, progress_cb=progress,
                                         stop_flag=stop_flag)

    if should_stop():
        return {"stopped": True}

    # --- Phase 4: Track Ordering & Selection ---
    progress("track_ordering", "Ordering tracks for flow...", 55)
    ordered_tracks = order_and_select_tracks(df, assignments, arc["acts"], client,
                                              model_config, progress_cb=progress,
                                              stop_flag=stop_flag)

    if should_stop():
        return {"stopped": True}

    # --- Phase 5: Workshop Assembly ---
    progress("assembly", "Assembling workshop set...", 80)
    assembly = assemble_workshop_set(df, ordered_tracks, arc["acts"], assignments,
                                      set_name, phase_profile_id=phase_profile_id,
                                      progress_cb=progress)

    return {
        "narrative": arc["narrative"],
        "acts": arc["acts"],
        "ordered_tracks": ordered_tracks,
        "pool_profile": pool_profile,
        "set": assembly["set"],
    }
