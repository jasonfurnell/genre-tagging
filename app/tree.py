"""Music Collection Tree — hierarchical lineage builder with LLM-driven subdivision."""

import json
import logging
import os
import re
import uuid
from collections import Counter
from datetime import datetime, timezone

import pandas as pd
from tenacity import retry, wait_fixed, stop_after_attempt, retry_if_exception_type

from app.parser import (
    parse_all_comments, build_genre_landscape_summary, scored_search,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_TREE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "collection_tree.json"
)


def save_tree(tree):
    os.makedirs(os.path.dirname(_TREE_FILE), exist_ok=True)
    with open(_TREE_FILE, "w") as f:
        json.dump(tree, f, indent=2)


def load_tree():
    if os.path.exists(_TREE_FILE):
        try:
            with open(_TREE_FILE) as f:
                return json.load(f)
        except Exception:
            return None
    return None


def delete_tree():
    if os.path.exists(_TREE_FILE):
        os.remove(_TREE_FILE)
        return True
    return False


# ---------------------------------------------------------------------------
# LLM helpers (reuse patterns from playlist.py)
# ---------------------------------------------------------------------------

_TREE_SYSTEM_PROMPT = (
    "You are a music historian, DJ, and cultural curator with encyclopedic knowledge "
    "of musical evolution and influence. You understand how genres branch and evolve, "
    "how scenes develop in specific places and times, and how production techniques "
    "and cultural movements shape musical identity.\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

_FILTER_FIELDS_HELP = """Available filter fields:
- genres: list of genre names (matches primary or secondary genre)
- mood: list of mood/atmosphere keywords
- descriptors: list of production descriptor keywords
- location: list of location/origin keywords
- era: list of era keywords (e.g. "2010s", "late 1990s")
- bpm_min, bpm_max: BPM range (optional)
- year_min, year_max: year range (optional)"""


def _extract_json(text):
    """Extract a JSON array or object from LLM response."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return json.loads(text.strip())


def _call_llm(client, model, provider, system_prompt, user_prompt):
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


# ---------------------------------------------------------------------------
# Mini-landscape for track subsets
# ---------------------------------------------------------------------------

def build_mini_landscape(df):
    """Build a compact landscape summary for a subset DataFrame."""
    if "_genre1" not in df.columns:
        parse_all_comments(df)

    total = len(df)
    all_genres = pd.concat([df["_genre1"], df["_genre2"]])
    all_genres = all_genres[all_genres != ""]
    genre_counts = Counter(all_genres)
    top_genres = genre_counts.most_common(20)

    pair_counts = Counter()
    for _, row in df.iterrows():
        g1, g2 = row["_genre1"], row["_genre2"]
        if g1 and g2:
            pair = tuple(sorted([g1, g2]))
            pair_counts[pair] += 1
    top_pairs = pair_counts.most_common(15)

    locations = df["_location"][df["_location"] != ""]
    loc_counts = Counter(locations).most_common(10)

    eras = df["_era"][df["_era"] != ""]
    era_counts = Counter(eras).most_common(10)

    mood_terms = Counter()
    for mood_val in df["_mood"][df["_mood"] != ""]:
        tokens = re.split(r"[,/&]+|\band\b", str(mood_val))
        for token in tokens:
            t = token.strip().lower()
            if t and len(t) > 2:
                mood_terms[t] += 1
    top_moods = mood_terms.most_common(15)

    desc_terms = Counter()
    for desc_val in df["_descriptors"][df["_descriptors"] != ""]:
        tokens = re.split(r"[,/&]+|\band\b", str(desc_val))
        for token in tokens:
            t = token.strip().lower()
            if t and len(t) > 2:
                desc_terms[t] += 1
    top_descriptors = desc_terms.most_common(15)

    lines = [f"{total} tracks in this group."]
    if top_genres:
        lines.append("Genres: " + ", ".join(f"{g} ({c})" for g, c in top_genres))
    if top_pairs:
        lines.append("Genre pairings: " + ", ".join(
            f"{g1}+{g2} ({c})" for (g1, g2), c in top_pairs[:10]
        ))
    if loc_counts:
        lines.append("Locations: " + ", ".join(f"{l} ({c})" for l, c in loc_counts))
    if era_counts:
        lines.append("Eras: " + ", ".join(f"{e} ({c})" for e, c in era_counts))
    if top_moods:
        lines.append("Moods: " + ", ".join(f"{m} ({c})" for m, c in top_moods))
    if top_descriptors:
        lines.append("Descriptors: " + ", ".join(f"{d} ({c})" for d, c in top_descriptors))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Track assignment
# ---------------------------------------------------------------------------

def assign_tracks_to_branches(df, branches, min_score=0.05):
    """Assign tracks from df to branches using scored_search (greedy best-match).

    Each track goes to the branch where it scores highest.
    Returns dict mapping branch_id -> list of track indices,
    plus "ungrouped" -> list of unassigned indices.
    """
    # Score every track against every branch
    branch_scores = {}  # branch_id -> {track_idx: score}
    for branch in branches:
        filters = branch.get("filters", {})
        if not filters:
            continue
        results = scored_search(df, filters, min_score=min_score, max_results=len(df))
        branch_scores[branch["id"]] = {idx: score for idx, score, _ in results}

    # Greedy assignment: each track -> highest scoring branch
    all_indices = set(df.index.tolist())
    assignments = {b["id"]: [] for b in branches}
    assigned = set()

    for idx in all_indices:
        best_branch = None
        best_score = min_score
        for branch in branches:
            score = branch_scores.get(branch["id"], {}).get(idx, 0)
            if score > best_score:
                best_score = score
                best_branch = branch["id"]
        if best_branch:
            assignments[best_branch].append(int(idx))
            assigned.add(idx)

    ungrouped = [int(idx) for idx in all_indices - assigned]
    return assignments, ungrouped


# ---------------------------------------------------------------------------
# LLM Prompts
# ---------------------------------------------------------------------------

_LINEAGE_PROMPT = """Here is a summary of a music collection:

{landscape}

Identify the Major Lineages in this collection — the top-level music family trees
representing distinct evolutionary paths in music history. These are the big organizing
categories (e.g., "Hip-Hop Lineage", "House Music Evolution", "Soul/R&B Heritage",
"Reggae & Soundsystem Culture").

Rules:
- Identify 3-8 lineages depending on collection diversity
- Each lineage should represent a SIGNIFICANT portion of the collection (at least ~30 tracks)
- Lineages should be broad enough to encompass sub-genres but distinct from each other
- Order by collection size (largest first)

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Evocative Lineage Title",
  "subtitle": "~N tracks spanning X",
  "description": "2-3 sentence overview of this musical tradition and its significance.",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""


_BRANCH_PROMPT = """Within the "{title}" lineage, there are {track_count} tracks:

{mini_landscape}

Subdivide this lineage into {target_count} Primary Branches organized by era, geography,
style, or movement — whichever best captures the natural groupings in this collection.

Rules:
- Each branch should ideally contain 20-100 tracks
- Use evocative, specific titles (think record store sections, not Wikipedia categories)
  e.g., "Golden Era NYC: Boom Bap to New Jack" not just "1990s Hip-Hop"
- Descriptions should be vivid, 2-3 sentences, written with DJ/curator knowledge
- Branches should cover the full scope of tracks in this lineage
- Order by era (earliest first) when possible

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Evocative Branch Title",
  "description": "Rich 2-3 sentence description with cultural context...",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""


_SUBDIVIDE_PROMPT = """Within "{title}", there are {track_count} tracks:

{mini_landscape}

This branch needs further subdivision into {target_count} sub-branches.
Organize by era, geography, style, or movement — whichever creates the most
meaningful groupings.

Rules:
- Each sub-branch should ideally contain 20-50 tracks
- Evocative titles and descriptions (think knowledgeable record shop clerk)
- Cover the full range of tracks in this branch

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Evocative Sub-branch Title",
  "description": "Rich 2-3 sentence description...",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""


_LEAF_PROMPT = """Finalize these leaf-node playlists. For each, write a compelling description
paragraph that a music enthusiast would love to read. Think record-store-clerk-who-knows-
everything energy. Also select 3 representative example tracks from the provided track lists.

The titles should be evocative and specific, like:
- "Golden Era NYC: Boom Bap to New Jack"
- "Soundsystem Meditation"
- "Nu-Disco Renaissance: 2010s Revival"

Nodes to finalize:
{nodes_json}

Return a JSON array:
[{{
  "id": "the-node-id",
  "title": "Refined Evocative Title",
  "description": "A paragraph description — evocative, knowledgeable, specific. Describe the sound, the scene, the feeling. What connects these tracks? What era, place, or movement do they represent? Why does this corner of music matter?",
  "examples": [
    {{"title": "Track Title", "artist": "Artist Name", "year": 2001}},
    {{"title": "Track Title", "artist": "Artist Name", "year": 1995}},
    {{"title": "Track Title", "artist": "Artist Name", "year": 2008}}
  ]
}}]"""


_LINEAGE_EXAMPLES_PROMPT = """For each lineage below, choose 3 tracks that best exemplify
and represent the entire lineage. Pick tracks that a knowledgeable listener would instantly
recognise as quintessential to that musical family tree — iconic, genre-defining, or
perfectly representative of the lineage's core identity.

Lineages:
{lineages_json}

Return a JSON array:
[{{
  "id": "the-lineage-id",
  "examples": [
    {{"title": "Track Title", "artist": "Artist Name", "year": 2001}},
    {{"title": "Track Title", "artist": "Artist Name", "year": 1995}},
    {{"title": "Track Title", "artist": "Artist Name", "year": 2008}}
  ]
}}]"""


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_identify_lineages(landscape, client, model, provider):
    prompt = _LINEAGE_PROMPT.format(
        landscape=landscape, filter_help=_FILTER_FIELDS_HELP
    )
    raw = _call_llm(client, model, provider, _TREE_SYSTEM_PROMPT, prompt)
    lineages = _extract_json(raw)
    # Validate
    for lin in lineages:
        lin.setdefault("id", str(uuid.uuid4())[:8])
        lin.setdefault("title", "Untitled Lineage")
        lin.setdefault("subtitle", "")
        lin.setdefault("description", "")
        lin.setdefault("filters", {})
    return lineages


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_generate_branches(title, track_count, mini_landscape, target_count,
                            client, model, provider, is_primary=True):
    template = _BRANCH_PROMPT if is_primary else _SUBDIVIDE_PROMPT
    prompt = template.format(
        title=title,
        track_count=track_count,
        mini_landscape=mini_landscape,
        target_count=target_count,
        filter_help=_FILTER_FIELDS_HELP,
    )
    raw = _call_llm(client, model, provider, _TREE_SYSTEM_PROMPT, prompt)
    branches = _extract_json(raw)
    for b in branches:
        b.setdefault("id", str(uuid.uuid4())[:8])
        b.setdefault("title", "Untitled Branch")
        b.setdefault("description", "")
        b.setdefault("filters", {})
    return branches


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_finalize_leaves(nodes_json, client, model, provider):
    prompt = _LEAF_PROMPT.format(nodes_json=nodes_json)
    raw = _call_llm(client, model, provider, _TREE_SYSTEM_PROMPT, prompt)
    return _extract_json(raw)


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_pick_lineage_examples(lineages_json, client, model, provider):
    prompt = _LINEAGE_EXAMPLES_PROMPT.format(lineages_json=lineages_json)
    raw = _call_llm(client, model, provider, _TREE_SYSTEM_PROMPT, prompt)
    return _extract_json(raw)


def _finalize_lineage_examples(lineages, df, client, model, provider, delay,
                                progress, should_stop):
    """Pick 3 exemplar tracks for each lineage (algorithmic shortlist → LLM pick)."""
    import time

    lineages_for_llm = []
    shortlists = {}  # lineage_id -> [(tid, score), ...]

    for lineage in lineages:
        if should_stop():
            return
        filters = lineage.get("filters", {})
        track_ids = lineage.get("track_ids", [])
        valid_ids = [tid for tid in track_ids if tid in df.index]
        if not valid_ids:
            continue

        # Stage 1: scored_search for top 50 from this lineage's tracks
        df_subset = df.loc[valid_ids]
        results = scored_search(df_subset, filters, min_score=0.01, max_results=50)

        candidates = []
        fallback_examples = []
        for idx, score, _ in results[:50]:
            row = df.loc[idx]
            track = {
                "title": str(row.get("title", "?")),
                "artist": str(row.get("artist", "?")),
                "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                "comment": str(row.get("comment", ""))[:150],
            }
            candidates.append(track)
            if len(fallback_examples) < 3:
                fallback_examples.append({
                    "title": track["title"],
                    "artist": track["artist"],
                    "year": track["year"],
                })

        shortlists[lineage["id"]] = fallback_examples

        if candidates:
            lineages_for_llm.append({
                "id": lineage["id"],
                "title": lineage["title"],
                "description": lineage.get("description", ""),
                "candidates": candidates,
            })

    if not lineages_for_llm:
        return

    # Stage 2: LLM picks 3 exemplars from each lineage's shortlist
    progress("lineage_examples", "Selecting exemplar tracks for lineages...", 96)
    try:
        results = _llm_pick_lineage_examples(
            json.dumps(lineages_for_llm, indent=2),
            client, model, provider,
        )
        if delay > 0:
            time.sleep(delay)

        result_map = {r["id"]: r for r in results}
        for lineage in lineages:
            res = result_map.get(lineage["id"])
            if res and res.get("examples"):
                lineage["examples"] = res["examples"][:3]
            elif lineage["id"] in shortlists:
                lineage["examples"] = shortlists[lineage["id"]]
    except Exception:
        logger.exception("Failed to pick lineage examples via LLM, using algorithmic fallback")
        for lineage in lineages:
            if lineage["id"] in shortlists:
                lineage["examples"] = shortlists[lineage["id"]]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

SUBDIVISION_THRESHOLD = 50
MAX_DEPTH = 4  # lineage -> primary -> secondary -> tertiary
LEAF_BATCH_SIZE = 5


def _target_branch_count(track_count):
    """Decide how many branches to create based on track count."""
    if track_count < 80:
        return 2
    if track_count < 150:
        return 3
    if track_count < 300:
        return 4
    if track_count < 600:
        return 5
    return 6


def _build_node(branch_def, track_ids, depth):
    """Build a tree node dict from a branch definition."""
    return {
        "id": branch_def["id"],
        "title": branch_def["title"],
        "description": branch_def.get("description", ""),
        "filters": branch_def.get("filters", {}),
        "track_ids": track_ids,
        "track_count": len(track_ids),
        "is_leaf": True,
        "children": [],
        "examples": [],
        "_depth": depth,
    }


def build_collection_tree(df, client, model, provider, delay,
                          progress_cb=None, stop_flag=None):
    """Build the full collection tree. Main orchestrator.

    Args:
        df: DataFrame with parsed facet columns
        client: LLM client (Anthropic or OpenAI)
        model: model name string
        provider: "anthropic" or "openai"
        delay: seconds between LLM calls
        progress_cb: callable(phase, detail, percent) for SSE updates
        stop_flag: threading.Event to check for graceful stop

    Returns:
        tree dict
    """
    import time

    parse_all_comments(df)
    total_tracks = len(df)

    def progress(phase, detail, pct):
        if progress_cb:
            progress_cb(phase, detail, pct)

    def should_stop():
        return stop_flag and stop_flag.is_set()

    def pause():
        if delay > 0:
            time.sleep(delay)

    # --- Phase 1: Identify Lineages ---
    progress("analyzing", "Building collection landscape...", 2)
    landscape = build_genre_landscape_summary(df)

    progress("lineages", "Identifying major musical lineages...", 5)
    if should_stop():
        return _make_partial_tree(total_tracks, [], [], "stopped")

    lineage_defs = _llm_identify_lineages(landscape, client, model, provider)
    pause()

    progress("lineages", f"Found {len(lineage_defs)} lineages", 10)

    # --- Phase 2: Assign tracks to lineages ---
    progress("assigning", "Assigning tracks to lineages...", 12)
    assignments, top_ungrouped = assign_tracks_to_branches(df, lineage_defs,
                                                            min_score=0.05)

    lineages = []
    for lin_def in lineage_defs:
        tids = assignments.get(lin_def["id"], [])
        node = _build_node(lin_def, tids, depth=0)
        node["subtitle"] = lin_def.get("subtitle", f"~{len(tids)} tracks")
        node["is_leaf"] = False  # lineages always get subdivided
        lineages.append(node)

    progress("assigning", f"Assigned {total_tracks - len(top_ungrouped)}/{total_tracks} tracks", 15)

    # --- Phase 3-5: Recursive branch building ---
    # Process each lineage
    total_lineages = len(lineages)
    base_pct = 15
    branch_pct_range = 65  # 15% -> 80%

    all_ungrouped = list(top_ungrouped)

    for li, lineage in enumerate(lineages):
        if should_stop():
            break

        lineage_pct_start = base_pct + (li / total_lineages) * branch_pct_range
        lineage_pct_end = base_pct + ((li + 1) / total_lineages) * branch_pct_range

        progress("primary_branches",
                 f"Building branches for {lineage['title']}...",
                 int(lineage_pct_start))

        _subdivide_node(
            node=lineage,
            df=df,
            client=client,
            model=model,
            provider=provider,
            delay=delay,
            depth=1,
            progress_cb=progress_cb,
            stop_flag=stop_flag,
            pct_start=lineage_pct_start,
            pct_end=lineage_pct_end,
            all_ungrouped=all_ungrouped,
        )

    # --- Phase 6: Finalize leaf nodes ---
    if not should_stop():
        progress("finalizing_leaves", "Writing leaf node descriptions...", 80)
        _finalize_all_leaves(lineages, df, client, model, provider, delay,
                             progress, should_stop)

    # --- Phase 6b: Pick lineage example tracks ---
    if not should_stop():
        _finalize_lineage_examples(lineages, df, client, model, provider, delay,
                                    progress, should_stop)

    # --- Phase 7: Collect final ungrouped ---
    assigned_in_leaves = set()
    _collect_leaf_track_ids(lineages, assigned_in_leaves)
    final_ungrouped = [int(idx) for idx in df.index if idx not in assigned_in_leaves]

    # Build tree
    tree = {
        "id": str(uuid.uuid4())[:8],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_tracks": total_tracks,
        "assigned_tracks": total_tracks - len(final_ungrouped),
        "ungrouped_track_ids": final_ungrouped,
        "lineages": _clean_nodes(lineages),
        "status": "stopped" if should_stop() else "complete",
    }

    save_tree(tree)
    progress("complete", "Collection tree built!", 100)
    return tree


# ---------------------------------------------------------------------------
# Expand tree from ungrouped tracks
# ---------------------------------------------------------------------------

def expand_tree_from_ungrouped(tree, df, client, model, provider, delay,
                                progress_cb=None, stop_flag=None):
    """Create new lineage(s) from the ungrouped tracks and merge into the existing tree.

    Runs a mini version of the full build pipeline on only the ungrouped tracks.
    Existing lineages and leaf playlists are not modified.
    """
    import time

    parse_all_comments(df)

    ungrouped_ids = tree.get("ungrouped_track_ids", [])
    valid_ids = [tid for tid in ungrouped_ids if tid in df.index]
    if not valid_ids:
        if progress_cb:
            progress_cb("complete", "No valid ungrouped tracks to process.", 100)
        return tree

    df_ungrouped = df.loc[valid_ids]

    def progress(phase, detail, pct):
        if progress_cb:
            progress_cb(phase, detail, pct)

    def should_stop():
        return stop_flag and stop_flag.is_set()

    def pause():
        if delay > 0:
            time.sleep(delay)

    # --- Phase 1: Analyse ungrouped landscape ---
    progress("analyzing", "Analyzing ungrouped track landscape...", 2)
    landscape = (
        "NOTE: These are tracks that did not fit into the main collection lineages. "
        "They may represent niche areas, crossover material, or outlier styles.\n\n"
        + build_mini_landscape(df_ungrouped)
    )

    if should_stop():
        progress("stopped", "Stopped.", 0)
        return tree

    # --- Phase 2: Identify new lineages ---
    progress("lineages", "Identifying new lineages from ungrouped tracks...", 5)
    lineage_defs = _llm_identify_lineages(landscape, client, model, provider)
    pause()

    if not lineage_defs:
        progress("complete", "No new lineages could be identified.", 100)
        return tree

    progress("lineages", f"Found {len(lineage_defs)} new lineages", 10)

    if should_stop():
        progress("stopped", "Stopped.", 0)
        return tree

    # --- Phase 3: Assign ungrouped tracks to new lineages ---
    progress("assigning", "Assigning ungrouped tracks to new lineages...", 12)
    assignments, still_ungrouped = assign_tracks_to_branches(
        df_ungrouped, lineage_defs, min_score=0.05
    )

    new_lineages = []
    for lin_def in lineage_defs:
        tids = assignments.get(lin_def["id"], [])
        if not tids:
            continue  # skip empty lineages
        node = _build_node(lin_def, tids, depth=0)
        node["subtitle"] = lin_def.get("subtitle", f"~{len(tids)} tracks")
        node["is_leaf"] = False
        new_lineages.append(node)

    if not new_lineages:
        progress("complete", "No tracks matched the new lineages.", 100)
        return tree

    assigned_count = sum(len(n["track_ids"]) for n in new_lineages)
    progress("assigning",
             f"Assigned {assigned_count}/{len(valid_ids)} ungrouped tracks",
             15)

    # --- Phase 4: Recursive branch building ---
    total_lineages = len(new_lineages)
    base_pct = 15
    branch_pct_range = 60  # 15% -> 75%

    all_sub_ungrouped = list(still_ungrouped)

    for li, lineage in enumerate(new_lineages):
        if should_stop():
            break

        lineage_pct_start = base_pct + (li / total_lineages) * branch_pct_range
        lineage_pct_end = base_pct + ((li + 1) / total_lineages) * branch_pct_range

        progress("primary_branches",
                 f"Building branches for {lineage['title']}...",
                 int(lineage_pct_start))

        _subdivide_node(
            node=lineage,
            df=df,
            client=client,
            model=model,
            provider=provider,
            delay=delay,
            depth=1,
            progress_cb=progress_cb,
            stop_flag=stop_flag,
            pct_start=lineage_pct_start,
            pct_end=lineage_pct_end,
            all_ungrouped=all_sub_ungrouped,
        )

    # --- Phase 5: Finalize leaf nodes ---
    if not should_stop():
        progress("finalizing_leaves", "Finalizing new leaf nodes...", 75)
        _finalize_all_leaves(new_lineages, df, client, model, provider, delay,
                             progress, should_stop)

    # --- Phase 5b: Pick lineage example tracks ---
    if not should_stop():
        _finalize_lineage_examples(new_lineages, df, client, model, provider, delay,
                                    progress, should_stop)

    # --- Phase 6: Merge into existing tree ---
    progress("merging", "Merging new lineages into collection tree...", 92)

    new_assigned = set()
    _collect_leaf_track_ids(new_lineages, new_assigned)

    remaining_ungrouped = [tid for tid in ungrouped_ids if tid not in new_assigned]

    tree["lineages"].extend(_clean_nodes(new_lineages))
    tree["ungrouped_track_ids"] = remaining_ungrouped
    tree["assigned_tracks"] = tree["total_tracks"] - len(remaining_ungrouped)

    save_tree(tree)
    progress("complete", "New lineages added to tree!", 100)
    return tree


def _subdivide_node(node, df, client, model, provider, delay, depth,
                    progress_cb, stop_flag, pct_start, pct_end, all_ungrouped):
    """Recursively subdivide a node if it has too many tracks."""
    import time

    if stop_flag and stop_flag.is_set():
        return

    track_ids = node["track_ids"]
    track_count = len(track_ids)

    # Don't subdivide small groups or at max depth
    if track_count <= SUBDIVISION_THRESHOLD or depth >= MAX_DEPTH:
        node["is_leaf"] = True
        return

    # Get subset DataFrame for this node's tracks
    valid_ids = [tid for tid in track_ids if tid in df.index]
    if not valid_ids:
        node["is_leaf"] = True
        return
    df_subset = df.loc[valid_ids]

    mini_land = build_mini_landscape(df_subset)
    target = _target_branch_count(track_count)

    phase = {1: "primary_branches", 2: "secondary_branches", 3: "tertiary_branches"}.get(depth, "tertiary_branches")

    try:
        branches = _llm_generate_branches(
            title=node["title"],
            track_count=track_count,
            mini_landscape=mini_land,
            target_count=target,
            client=client,
            model=model,
            provider=provider,
            is_primary=(depth == 1),
        )
        if delay > 0:
            time.sleep(delay)
    except Exception:
        logger.exception("Failed to generate branches for %s", node["title"])
        node["is_leaf"] = True
        node["status"] = "error"
        return

    # Assign tracks to branches
    assignments, sub_ungrouped = assign_tracks_to_branches(df_subset, branches,
                                                           min_score=0.05)
    all_ungrouped.extend(sub_ungrouped)

    children = []
    for branch_def in branches:
        tids = assignments.get(branch_def["id"], [])
        if not tids:
            continue  # skip empty branches
        child = _build_node(branch_def, tids, depth)
        children.append(child)

    if not children:
        node["is_leaf"] = True
        return

    node["children"] = children
    node["is_leaf"] = False

    # Recurse into children that are large enough
    num_children = len(children)
    for ci, child in enumerate(children):
        if stop_flag and stop_flag.is_set():
            break

        child_pct_start = pct_start + (ci / num_children) * (pct_end - pct_start)
        child_pct_end = pct_start + ((ci + 1) / num_children) * (pct_end - pct_start)

        if progress_cb:
            progress_cb(phase, f"Processing: {child['title']}", int(child_pct_start))

        _subdivide_node(
            node=child,
            df=df,
            client=client,
            model=model,
            provider=provider,
            delay=delay,
            depth=depth + 1,
            progress_cb=progress_cb,
            stop_flag=stop_flag,
            pct_start=child_pct_start,
            pct_end=child_pct_end,
            all_ungrouped=all_ungrouped,
        )


def _finalize_all_leaves(lineages, df, client, model, provider, delay,
                          progress, should_stop):
    """Batch-finalize leaf nodes with rich descriptions and examples."""
    import time

    leaves = []
    _collect_leaves(lineages, leaves)

    total = len(leaves)
    if total == 0:
        return

    # Process in batches
    for batch_start in range(0, total, LEAF_BATCH_SIZE):
        if should_stop():
            break

        batch = leaves[batch_start:batch_start + LEAF_BATCH_SIZE]
        batch_pct = 80 + int((batch_start / total) * 15)
        progress("finalizing_leaves",
                 f"Finalizing leaves {batch_start + 1}-{min(batch_start + LEAF_BATCH_SIZE, total)} of {total}...",
                 batch_pct)

        # Build node summaries for the LLM
        nodes_for_llm = []
        for leaf in batch:
            valid_ids = [tid for tid in leaf["track_ids"] if tid in df.index]
            sample_tracks = []
            for tid in valid_ids[:15]:  # up to 15 tracks for context
                row = df.loc[tid]
                sample_tracks.append({
                    "title": str(row.get("title", "?")),
                    "artist": str(row.get("artist", "?")),
                    "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                    "comment": str(row.get("comment", ""))[:150],
                })
            nodes_for_llm.append({
                "id": leaf["id"],
                "title": leaf["title"],
                "track_count": leaf["track_count"],
                "sample_tracks": sample_tracks,
            })

        try:
            finalized = _llm_finalize_leaves(
                json.dumps(nodes_for_llm, indent=2),
                client, model, provider,
            )
            if delay > 0:
                time.sleep(delay)

            # Apply finalized data back to leaf nodes
            fin_map = {f["id"]: f for f in finalized}
            for leaf in batch:
                fin = fin_map.get(leaf["id"])
                if fin:
                    leaf["title"] = fin.get("title", leaf["title"])
                    leaf["description"] = fin.get("description", leaf["description"])
                    leaf["examples"] = fin.get("examples", [])[:3]
        except Exception:
            logger.exception("Failed to finalize leaf batch starting at %d", batch_start)
            # Leave existing descriptions in place


def _collect_leaves(nodes, result):
    """Recursively collect all leaf nodes from a tree."""
    for node in nodes:
        if node.get("is_leaf") or not node.get("children"):
            result.append(node)
        else:
            _collect_leaves(node["children"], result)


def _collect_leaf_track_ids(nodes, result_set):
    """Recursively collect all track IDs from leaf nodes."""
    for node in nodes:
        if node.get("is_leaf") or not node.get("children"):
            for tid in node.get("track_ids", []):
                result_set.add(tid)
        else:
            _collect_leaf_track_ids(node["children"], result_set)


def _clean_nodes(nodes):
    """Remove internal fields before persisting."""
    cleaned = []
    for node in nodes:
        n = {k: v for k, v in node.items() if not k.startswith("_")}
        if n.get("children"):
            n["children"] = _clean_nodes(n["children"])
        cleaned.append(n)
    return cleaned


def _make_partial_tree(total_tracks, lineages, ungrouped, status):
    """Build a partial tree for when stopped or errored."""
    return {
        "id": str(uuid.uuid4())[:8],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_tracks": total_tracks,
        "assigned_tracks": 0,
        "ungrouped_track_ids": ungrouped,
        "lineages": _clean_nodes(lineages),
        "status": status,
    }


# ---------------------------------------------------------------------------
# Find a node by ID in the tree
# ---------------------------------------------------------------------------

def find_node(tree, node_id):
    """Find a node by ID anywhere in the tree. Returns the node dict or None."""
    for lineage in tree.get("lineages", []):
        result = _find_in_subtree(lineage, node_id)
        if result:
            return result
    return None


def _find_in_subtree(node, node_id):
    if node.get("id") == node_id:
        return node
    for child in node.get("children", []):
        result = _find_in_subtree(child, node_id)
        if result:
            return result
    return None
