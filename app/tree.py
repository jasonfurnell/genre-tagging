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


def save_tree(tree, file_path=None):
    fp = file_path or _TREE_FILE
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w") as f:
        json.dump(tree, f, indent=2)


def load_tree(file_path=None):
    fp = file_path or _TREE_FILE
    if os.path.exists(fp):
        try:
            with open(fp) as f:
                return json.load(f)
        except Exception:
            return None
    return None


def delete_tree(file_path=None):
    fp = file_path or _TREE_FILE
    if os.path.exists(fp):
        os.remove(fp)
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


def _call_llm(client, model, provider, system_prompt, user_prompt, max_tokens=4096):
    if provider == "anthropic":
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
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
everything energy. Also select 7 representative example tracks from the provided track lists.

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


_LINEAGE_EXAMPLES_PROMPT = """For each lineage below, choose 7 tracks that best exemplify
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
# Scene Tree prompts — scene-based organisation (place + era)
# ---------------------------------------------------------------------------

_SCENE_SYSTEM_PROMPT = (
    "You are a music historian and cultural geographer with encyclopedic knowledge "
    "of how music scenes develop in specific places and times. You understand the "
    "interplay between location, era, community, and sound that creates distinct "
    "musical movements. You think in terms of scenes — cohesive cultural moments "
    "anchored to geography and time — not broad genre categories.\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

_SCENE_LINEAGE_PROMPT = """Here is a summary of a music collection:

{landscape}

Identify 10-15 distinct Musical Scenes and Movements represented in this collection.
Each scene should be anchored to a specific geographic location AND time period,
representing a cohesive cultural moment (e.g., "Chicago House Origins 1984-1992",
"Berlin Minimal Techno 2000-2008", "UK Garage to Dubstep 1997-2004",
"Detroit Techno First Wave 1985-1993", "Kingston Dub & Roots 1970-1980").

Rules:
- Identify 10-15 scenes depending on collection diversity
- Each scene MUST be anchored to a specific place AND era
- Scenes should represent cohesive cultural moments, not broad genre categories
- A scene can span 3-15 years of a particular movement
- Smaller is better: prefer specific movements over umbrella terms
- Each scene should represent at least ~15 tracks from the collection
- Order by era (earliest first)
- Think like a music journalist writing about specific movements, not a Wikipedia editor categorizing genres

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Place + Movement + Era Title",
  "subtitle": "~N tracks spanning X",
  "description": "2-3 sentences about this scene: where it happened, when, who drove it, what it sounded like, and why it mattered.",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""

_SCENE_BRANCH_PROMPT = """Within the "{title}" scene, there are {track_count} tracks:

{mini_landscape}

Subdivide this scene into {target_count} distinct phases, sub-scenes, or stylistic
strands — whichever best captures the natural evolution within this movement.

Rules:
- Each sub-scene should ideally contain 15-60 tracks
- Titles should reference specific micro-eras, venues, labels, or stylistic shifts
  e.g., "Warehouse Era: Raw Jacking Tracks 1985-1988" not just "Early House"
- Descriptions should evoke the time and place — name key artists, venues, labels
- Sub-scenes should cover the full scope of tracks in this scene
- Order chronologically when possible

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Evocative Sub-scene Title",
  "description": "Rich 2-3 sentence description with cultural and geographic context...",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""

_SCENE_SUBDIVIDE_PROMPT = """Within "{title}", there are {track_count} tracks:

{mini_landscape}

This sub-scene needs further subdivision into {target_count} micro-movements or
stylistic clusters.

Rules:
- Each cluster should ideally contain 15-40 tracks
- Focus on what makes each cluster sonically or culturally distinct
- Evocative titles that a music enthusiast would recognise
- Cover the full range of tracks

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Evocative Micro-movement Title",
  "description": "Rich 2-3 sentence description...",
  "filters": {{ "genres": [...], "era": [...], "location": [...], "mood": [...], "descriptors": [...] }}
}}]"""


# ---------------------------------------------------------------------------
# Tree profiles — prompt sets + thresholds per tree type
# ---------------------------------------------------------------------------

TREE_PROFILES = {
    "genre": {
        "system_prompt": _TREE_SYSTEM_PROMPT,
        "lineage_prompt": _LINEAGE_PROMPT,
        "branch_prompt": _BRANCH_PROMPT,
        "subdivide_prompt": _SUBDIVIDE_PROMPT,
        "leaf_prompt": _LEAF_PROMPT,
        "examples_prompt": _LINEAGE_EXAMPLES_PROMPT,
        "subdivision_threshold": 50,
        "max_depth": 4,
        "leaf_batch_size": 5,
        "file": _TREE_FILE,
    },
    "scene": {
        "system_prompt": _SCENE_SYSTEM_PROMPT,
        "lineage_prompt": _SCENE_LINEAGE_PROMPT,
        "branch_prompt": _SCENE_BRANCH_PROMPT,
        "subdivide_prompt": _SCENE_SUBDIVIDE_PROMPT,
        "leaf_prompt": _LEAF_PROMPT,
        "examples_prompt": _LINEAGE_EXAMPLES_PROMPT,
        "subdivision_threshold": 40,
        "max_depth": 4,
        "leaf_batch_size": 5,
        "file": os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "output", "scene_tree.json",
        ),
    },
}


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_identify_lineages(landscape, client, model, provider, profile=None):
    profile = profile or TREE_PROFILES["genre"]
    prompt = profile["lineage_prompt"].format(
        landscape=landscape, filter_help=_FILTER_FIELDS_HELP
    )
    raw = _call_llm(client, model, provider, profile["system_prompt"], prompt)
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
                            client, model, provider, is_primary=True,
                            profile=None):
    profile = profile or TREE_PROFILES["genre"]
    template = profile["branch_prompt"] if is_primary else profile["subdivide_prompt"]
    prompt = template.format(
        title=title,
        track_count=track_count,
        mini_landscape=mini_landscape,
        target_count=target_count,
        filter_help=_FILTER_FIELDS_HELP,
    )
    raw = _call_llm(client, model, provider, profile["system_prompt"], prompt)
    branches = _extract_json(raw)
    for b in branches:
        b.setdefault("id", str(uuid.uuid4())[:8])
        b.setdefault("title", "Untitled Branch")
        b.setdefault("description", "")
        b.setdefault("filters", {})
    return branches


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_finalize_leaves(nodes_json, client, model, provider, profile=None):
    profile = profile or TREE_PROFILES["genre"]
    prompt = profile["leaf_prompt"].format(nodes_json=nodes_json)
    raw = _call_llm(client, model, provider, profile["system_prompt"], prompt)
    return _extract_json(raw)


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_pick_lineage_examples(lineages_json, client, model, provider,
                                profile=None):
    profile = profile or TREE_PROFILES["genre"]
    prompt = profile["examples_prompt"].format(lineages_json=lineages_json)
    raw = _call_llm(client, model, provider, profile["system_prompt"], prompt)
    return _extract_json(raw)


def _finalize_lineage_examples(lineages, df, client, model, provider, delay,
                                progress, should_stop, profile=None):
    """Pick 7 exemplar tracks for each lineage (algorithmic shortlist → LLM pick)."""
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
            if len(fallback_examples) < 7:
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

    # Stage 2: LLM picks 7 exemplars from each lineage's shortlist
    progress("lineage_examples", "Selecting exemplar tracks for lineages...", 96)
    try:
        results = _llm_pick_lineage_examples(
            json.dumps(lineages_for_llm, indent=2),
            client, model, provider, profile=profile,
        )
        if delay > 0:
            time.sleep(delay)

        result_map = {r["id"]: r for r in results}
        for lineage in lineages:
            res = result_map.get(lineage["id"])
            if res and res.get("examples"):
                lineage["examples"] = res["examples"][:7]
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
                          progress_cb=None, stop_flag=None, tree_type="genre"):
    """Build the full collection tree. Main orchestrator.

    Args:
        df: DataFrame with parsed facet columns
        client: LLM client (Anthropic or OpenAI)
        model: model name string
        provider: "anthropic" or "openai"
        delay: seconds between LLM calls
        progress_cb: callable(phase, detail, percent) for SSE updates
        stop_flag: threading.Event to check for graceful stop
        tree_type: "genre" or "scene"

    Returns:
        tree dict
    """
    profile = TREE_PROFILES[tree_type]
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

    lineage_defs = _llm_identify_lineages(landscape, client, model, provider,
                                           profile=profile)
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
            profile=profile,
        )

    # --- Phase 6: Finalize leaf nodes ---
    if not should_stop():
        progress("finalizing_leaves", "Writing leaf node descriptions...", 80)
        _finalize_all_leaves(lineages, df, client, model, provider, delay,
                             progress, should_stop, profile=profile)

    # --- Phase 6b: Pick lineage example tracks ---
    if not should_stop():
        _finalize_lineage_examples(lineages, df, client, model, provider, delay,
                                    progress, should_stop, profile=profile)

    # --- Phase 6c: Pick branch example tracks ---
    if not should_stop():
        branches = []
        for lineage in lineages:
            _collect_all_descendants(lineage, branches)
        branches = [b for b in branches if not b.get("is_leaf") and b.get("children")]
        if branches:
            progress("branch_examples", "Selecting exemplar tracks for branches...", 97)
            _finalize_lineage_examples(branches, df, client, model, provider, delay,
                                        progress, should_stop, profile=profile)

    # --- Phase 7: Collect final ungrouped ---
    assigned_in_leaves = set()
    _collect_leaf_track_ids(lineages, assigned_in_leaves)
    final_ungrouped = [int(idx) for idx in df.index if idx not in assigned_in_leaves]

    # Build tree
    tree = {
        "id": str(uuid.uuid4())[:8],
        "tree_type": tree_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_tracks": total_tracks,
        "assigned_tracks": total_tracks - len(final_ungrouped),
        "ungrouped_track_ids": final_ungrouped,
        "lineages": _clean_nodes(lineages),
        "status": "stopped" if should_stop() else "complete",
    }

    save_tree(tree, file_path=profile["file"])
    progress("complete", "Collection tree built!", 100)
    return tree


# ---------------------------------------------------------------------------
# Expand tree from ungrouped tracks
# ---------------------------------------------------------------------------

def expand_tree_from_ungrouped(tree, df, client, model, provider, delay,
                                progress_cb=None, stop_flag=None,
                                tree_type="genre"):
    """Create new lineage(s) from the ungrouped tracks and merge into the existing tree.

    Runs a mini version of the full build pipeline on only the ungrouped tracks.
    Existing lineages and leaf playlists are not modified.
    """
    profile = TREE_PROFILES[tree_type]
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
    lineage_defs = _llm_identify_lineages(landscape, client, model, provider,
                                           profile=profile)
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
            profile=profile,
        )

    # --- Phase 5: Finalize leaf nodes ---
    if not should_stop():
        progress("finalizing_leaves", "Finalizing new leaf nodes...", 75)
        _finalize_all_leaves(new_lineages, df, client, model, provider, delay,
                             progress, should_stop, profile=profile)

    # --- Phase 5b: Pick lineage example tracks ---
    if not should_stop():
        _finalize_lineage_examples(new_lineages, df, client, model, provider, delay,
                                    progress, should_stop, profile=profile)

    # --- Phase 5c: Pick branch example tracks ---
    if not should_stop():
        branches = []
        for lineage in new_lineages:
            _collect_all_descendants(lineage, branches)
        branches = [b for b in branches if not b.get("is_leaf") and b.get("children")]
        if branches:
            progress("branch_examples", "Selecting exemplar tracks for branches...", 90)
            _finalize_lineage_examples(branches, df, client, model, provider, delay,
                                        progress, should_stop, profile=profile)

    # --- Phase 6: Merge into existing tree ---
    progress("merging", "Merging new lineages into collection tree...", 92)

    new_assigned = set()
    _collect_leaf_track_ids(new_lineages, new_assigned)

    remaining_ungrouped = [tid for tid in ungrouped_ids if tid not in new_assigned]

    tree["lineages"].extend(_clean_nodes(new_lineages))
    tree["ungrouped_track_ids"] = remaining_ungrouped
    tree["assigned_tracks"] = tree["total_tracks"] - len(remaining_ungrouped)

    save_tree(tree, file_path=profile["file"])
    progress("complete", "New lineages added to tree!", 100)
    return tree


def _subdivide_node(node, df, client, model, provider, delay, depth,
                    progress_cb, stop_flag, pct_start, pct_end, all_ungrouped,
                    profile=None):
    """Recursively subdivide a node if it has too many tracks."""
    import time
    profile = profile or TREE_PROFILES["genre"]

    if stop_flag and stop_flag.is_set():
        return

    track_ids = node["track_ids"]
    track_count = len(track_ids)

    # Don't subdivide small groups or at max depth
    if track_count <= profile["subdivision_threshold"] or depth >= profile["max_depth"]:
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
            profile=profile,
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
            profile=profile,
        )


def _finalize_all_leaves(lineages, df, client, model, provider, delay,
                          progress, should_stop, profile=None):
    """Batch-finalize leaf nodes with rich descriptions and examples."""
    import time
    profile = profile or TREE_PROFILES["genre"]

    leaves = []
    _collect_leaves(lineages, leaves)

    total = len(leaves)
    if total == 0:
        return

    # Process in batches
    batch_size = profile["leaf_batch_size"]
    for batch_start in range(0, total, batch_size):
        if should_stop():
            break

        batch = leaves[batch_start:batch_start + batch_size]
        batch_pct = 80 + int((batch_start / total) * 15)
        progress("finalizing_leaves",
                 f"Finalizing leaves {batch_start + 1}-{min(batch_start + batch_size, total)} of {total}...",
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
                client, model, provider, profile=profile,
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
                    leaf["examples"] = fin.get("examples", [])[:7]
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


def _collect_all_descendants(node, result):
    """Recursively collect all descendant nodes."""
    for child in node.get("children", []):
        result.append(child)
        _collect_all_descendants(child, result)


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
# Refresh exemplar tracks for all nodes in an existing tree
# ---------------------------------------------------------------------------

def refresh_all_examples(tree, df, client, model, provider, delay,
                          progress_cb=None, stop_flag=None, tree_type="genre"):
    """Re-run exemplar track selection for ALL nodes in the tree (7 per node)."""
    import time
    profile = TREE_PROFILES[tree_type]
    parse_all_comments(df)

    def progress(phase, detail, pct):
        if progress_cb:
            progress_cb(phase, detail, pct)

    def should_stop():
        return stop_flag and stop_flag.is_set()

    # Collect ALL nodes in the tree
    all_nodes = []
    for lineage in tree.get("lineages", []):
        all_nodes.append(lineage)
        _collect_all_descendants(lineage, all_nodes)

    total = len(all_nodes)
    if total == 0:
        progress("complete", "No nodes to process.", 100)
        return tree

    progress("refreshing_examples",
             f"Refreshing exemplar tracks for {total} nodes...", 2)

    batch_size = 5
    for batch_start in range(0, total, batch_size):
        if should_stop():
            break

        batch = all_nodes[batch_start:batch_start + batch_size]
        pct = 2 + int((batch_start / total) * 93)
        progress("refreshing_examples",
                 f"Processing nodes {batch_start + 1}-"
                 f"{min(batch_start + batch_size, total)} of {total}...",
                 pct)

        nodes_for_llm = []
        shortlists = {}

        for node in batch:
            filters = node.get("filters", {})
            track_ids = node.get("track_ids", [])
            valid_ids = [tid for tid in track_ids if tid in df.index]
            if not valid_ids:
                continue

            df_subset = df.loc[valid_ids]
            results = scored_search(df_subset, filters,
                                     min_score=0.01, max_results=50)

            candidates = []
            fallback = []
            for idx, score, _ in results[:50]:
                row = df.loc[idx]
                track = {
                    "title": str(row.get("title", "?")),
                    "artist": str(row.get("artist", "?")),
                    "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                    "comment": str(row.get("comment", ""))[:150],
                }
                candidates.append(track)
                if len(fallback) < 7:
                    fallback.append({
                        "title": track["title"],
                        "artist": track["artist"],
                        "year": track["year"],
                    })

            shortlists[node["id"]] = fallback
            if candidates:
                nodes_for_llm.append({
                    "id": node["id"],
                    "title": node["title"],
                    "description": node.get("description", ""),
                    "candidates": candidates,
                })

        if not nodes_for_llm:
            continue

        try:
            results = _llm_pick_lineage_examples(
                json.dumps(nodes_for_llm, indent=2),
                client, model, provider, profile=profile,
            )
            if delay > 0:
                time.sleep(delay)

            result_map = {r["id"]: r for r in results}
            for node in batch:
                res = result_map.get(node["id"])
                if res and res.get("examples"):
                    node["examples"] = res["examples"][:7]
                elif node["id"] in shortlists:
                    node["examples"] = shortlists[node["id"]]
        except Exception:
            logger.exception("Failed to refresh examples for batch at %d",
                             batch_start)
            for node in batch:
                if node["id"] in shortlists:
                    node["examples"] = shortlists[node["id"]]

    save_tree(tree, file_path=profile["file"])
    progress("complete", f"Exemplar tracks refreshed for {total} nodes!", 100)
    return tree


# ---------------------------------------------------------------------------
# Find a node by ID in the tree
# ---------------------------------------------------------------------------

def find_node(tree, node_id):
    """Find a node by ID anywhere in the tree. Returns the node dict or None.
    Supports both hierarchical trees (lineages/children) and flat collection
    trees (categories/leaves)."""
    for lineage in tree.get("lineages", []):
        result = _find_in_subtree(lineage, node_id)
        if result:
            return result
    # Flat collection tree search
    for category in tree.get("categories", []):
        if category.get("id") == node_id:
            return category
        for leaf in category.get("leaves", []):
            if leaf.get("id") == node_id:
                return leaf
    return None


def _find_in_subtree(node, node_id):
    if node.get("id") == node_id:
        return node
    for child in node.get("children", []):
        result = _find_in_subtree(child, node_id)
        if result:
            return result
    return None


# ===========================================================================
# Collection Tree — curated cross-reference of Genre + Scene trees
# ===========================================================================

_COLLECTION_TREE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "curated_collection.json"
)
_COLLECTION_CHECKPOINT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "collection_checkpoint.json"
)


def _save_checkpoint(phase_completed, data):
    """Save intermediate pipeline state after a phase completes."""
    checkpoint = {"phase_completed": phase_completed, **data}
    with open(_COLLECTION_CHECKPOINT_FILE, "w") as f:
        json.dump(checkpoint, f)
    logger.info("[collection] Checkpoint saved after phase %d", phase_completed)


def _load_checkpoint():
    """Load checkpoint if it exists, return (phase_completed, data) or (0, {})."""
    if not os.path.exists(_COLLECTION_CHECKPOINT_FILE):
        return 0, {}
    try:
        with open(_COLLECTION_CHECKPOINT_FILE) as f:
            data = json.load(f)
        phase = data.pop("phase_completed", 0)
        logger.info("[collection] Checkpoint found — resuming from phase %d", phase)
        return phase, data
    except Exception:
        logger.exception("Failed to load checkpoint")
        return 0, {}


def _clear_checkpoint():
    """Remove checkpoint file after successful completion."""
    if os.path.exists(_COLLECTION_CHECKPOINT_FILE):
        os.remove(_COLLECTION_CHECKPOINT_FILE)
        logger.info("[collection] Checkpoint cleared")

# Model tiering defaults
COLLECTION_TREE_MODELS = {
    "creative": "claude-sonnet-4-5-20250929",
    "mechanical": "claude-3-5-haiku-20241022",
}


def _get_tiered_model(tier, model_config=None):
    """Return (model_name, provider) for a given tier ('creative' or 'mechanical')."""
    config = model_config or COLLECTION_TREE_MODELS
    model = config.get(tier, config.get("creative"))
    provider = "anthropic" if model.startswith("claude") else "openai"
    return model, provider


# ---------------------------------------------------------------------------
# Collection Tree prompts
# ---------------------------------------------------------------------------

_COLLECTION_SYSTEM_PROMPT = (
    "You are a music curator with encyclopedic knowledge of genres, scenes, and "
    "cultural movements. You create vivid, evocative playlist descriptions that "
    "capture the feeling of a specific corner of music. You think about what "
    "connects tracks beyond simple genre labels — mood, era, geography, production "
    "style, cultural context, and dancefloor energy.\n\n"
    "You must respond with valid JSON only. No markdown, no code fences, no "
    "additional text before or after the JSON."
)

_CLUSTER_NAMING_PROMPT = """You are naming and describing music clusters. Each cluster is an
intersection of a genre lineage and a cultural scene — tracks that belong to both.

For each cluster:
1. Create an evocative, specific name (NOT generic — think "Late-Night NYC Boogie Revival"
   not "Dance Music"). The name should capture the unique identity of this intersection.
2. Write a rich scene description (3-4 sentences) that captures:
   - The sound and production style
   - The cultural moment, place, and era
   - What connects these tracks beyond just genre
   - Influential artists or movements (even if not in the collection)
3. Flag any tracks that seem like poor fits for this specific intersection
4. Assign a coherence score (1-10) — how well do these tracks belong together?

Clusters to name:
{clusters_json}

Return a JSON array:
[{{
  "id": "<cluster-id>",
  "title": "Evocative Cluster Name",
  "description": "Rich 3-4 sentence scene description capturing sound, culture, and feeling...",
  "coherence_score": 8,
  "poor_fit_track_ids": []
}}]"""

_REASSIGNMENT_PROMPT = """Assign each track to the single best-matching cluster based on its
genre tags, descriptors, mood, location, and era. Choose the cluster where the track would
feel most at home musically and culturally.

Available clusters:
{cluster_summary}

Tracks to assign:
{tracks_json}

For each track, return the best cluster. If truly no cluster fits at all, use "unassigned".

Return a JSON array:
[{{
  "track_id": 123,
  "cluster_id": "best-matching-cluster-id",
  "confidence": 0.85
}}]"""

_QUALITY_SCORING_PROMPT = """Evaluate these music clusters for quality and coherence.

For each cluster, score 1-10 on:
- Musical coherence: Do the tracks share a sound, style, or production approach?
- Thematic unity: Is there a clear unifying concept (scene, movement, era)?
- Distinctiveness: Is this cluster clearly different from others?

Also identify:
- MERGE candidates: pairs of clusters that are too similar and should be combined
- SPLIT candidates: clusters that are too diverse (>60 tracks) or contain distinct sub-groups

Clusters:
{clusters_json}

Return JSON:
{{
  "scores": [{{ "id": "cluster-id", "score": 8, "reason": "brief explanation" }}],
  "merge_suggestions": [{{ "ids": ["id-a", "id-b"], "reason": "why these are too similar" }}],
  "split_suggestions": [{{ "id": "cluster-id", "into": 2, "reason": "why this should split" }}]
}}"""

_SPLIT_CLUSTER_PROMPT = """This music cluster needs to be split into {split_count} distinct
sub-clusters because it's too diverse.

Cluster: {cluster_title}
Description: {cluster_description}
Track count: {track_count}

Track landscape:
{mini_landscape}

Create {split_count} focused sub-clusters. Each should have:
- A distinct identity within the parent cluster
- Clear filter criteria to assign tracks

{filter_help}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Sub-cluster Name",
  "description": "What makes this sub-group distinct",
  "filters": {{ "genres": [...], "mood": [...], "descriptors": [...], "location": [...], "era": [...] }}
}}]"""

_GROUPING_PROMPT = """Group these {count} music collections into 8-12 natural families/categories.

Each family should:
- Group collections that share musical DNA, cultural affinity, or dancefloor energy
- Have an evocative family name and 2-3 sentence description
- Contain roughly 10-20 collections each (aim for balance, but prioritise coherence)
- Feel like a curated section in a world-class record store

Collections:
{clusters_json}

Return a JSON array:
[{{
  "id": "kebab-case-id",
  "title": "Family Name",
  "description": "2-3 sentence description of what unifies this family...",
  "cluster_ids": ["cluster-id-1", "cluster-id-2", ...]
}}]"""

_COLLECTION_LEAF_PROMPT = """Write rich, evocative descriptions for each of these music
collections. Think like a passionate DJ and cultural historian describing their favourite
corners of music to an enthusiastic listener.

For each collection:
1. Refine the title if a better one emerges from the tracks
2. Write a vivid paragraph (4-6 sentences) describing:
   - The sound: production style, rhythms, textures
   - The scene: where and when this music lives
   - The feeling: what it's like to hear this on a dancefloor or in headphones
   - The lineage: who pioneered this sound, what influenced it, where it led
   - Artists or tracks that define this corner (even if not in the collection)
3. Select 7 exemplar tracks from the candidates provided — tracks that best
   represent the essence of this collection

Collections:
{nodes_json}

Return a JSON array:
[{{
  "id": "collection-id",
  "title": "Refined Title",
  "description": "A rich paragraph — evocative, knowledgeable, vivid...",
  "examples": [
    {{"title": "Track Title", "artist": "Artist Name", "year": 2001}},
    ...
  ]
}}]"""

_ENRICHMENT_PROMPT = """Analyse these tracks in the context of their collection cluster and
suggest metadata improvements. Only suggest changes where you're confident they improve
accuracy and specificity.

Cluster: {cluster_title}
Cluster description: {cluster_description}

Tracks:
{tracks_json}

For each track, suggest improvements to its comment metadata:
- genre_refinement: a more specific sub-genre than the current tags (or null)
- scene_tags: cultural/geographic/temporal tags to add (or null)
- descriptors: production or sonic descriptors to add (or null)
- era_refinement: more precise era information (or null)

Return a JSON array:
[{{
  "track_id": 123,
  "suggestions": {{
    "genre_refinement": "Acid House" or null,
    "scene_tags": ["Chicago warehouse", "1987 Summer of Love"] or null,
    "descriptors": ["303 squelch", "hypnotic"] or null,
    "era_refinement": "late 1980s" or null
  }},
  "confidence": 0.9,
  "reasoning": "Brief explanation"
}}]"""


# ---------------------------------------------------------------------------
# Phase 1: Intersection Matrix (pure Python)
# ---------------------------------------------------------------------------

def _build_intersection_matrix(genre_tree, scene_tree, min_tracks=5):
    """Compute intersections between genre and scene tree leaves.

    Returns list of seed cluster dicts sorted by track count descending.
    """
    genre_leaves = []
    _collect_leaves(genre_tree.get("lineages", []), genre_leaves)
    scene_leaves = []
    _collect_leaves(scene_tree.get("lineages", []), scene_leaves)

    # Pre-build sets for O(1) intersection
    genre_sets = {}
    genre_info = {}
    for leaf in genre_leaves:
        lid = leaf["id"]
        genre_sets[lid] = set(leaf.get("track_ids", []))
        genre_info[lid] = {
            "id": lid,
            "title": leaf.get("title", ""),
            "description": leaf.get("description", ""),
            "filters": leaf.get("filters", {}),
        }

    scene_sets = {}
    scene_info = {}
    for leaf in scene_leaves:
        lid = leaf["id"]
        scene_sets[lid] = set(leaf.get("track_ids", []))
        scene_info[lid] = {
            "id": lid,
            "title": leaf.get("title", ""),
            "description": leaf.get("description", ""),
            "filters": leaf.get("filters", {}),
        }

    seeds = []
    for g_id, g_set in genre_sets.items():
        for s_id, s_set in scene_sets.items():
            intersection = g_set & s_set
            if len(intersection) >= min_tracks:
                seeds.append({
                    "id": f"{g_id}__{s_id}",
                    "genre_leaf": genre_info[g_id],
                    "scene_leaf": scene_info[s_id],
                    "track_ids": sorted(intersection),
                    "track_count": len(intersection),
                })

    seeds.sort(key=lambda s: s["track_count"], reverse=True)
    return seeds


# ---------------------------------------------------------------------------
# Phase 2: Cluster Naming (creative model)
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_name_cluster_batch(clusters_for_llm, client, model, provider):
    prompt = _CLUSTER_NAMING_PROMPT.format(
        clusters_json=json.dumps(clusters_for_llm, indent=2)
    )
    raw = _call_llm(client, model, provider, _COLLECTION_SYSTEM_PROMPT, prompt,
                    max_tokens=8192)
    return _extract_json(raw)


def _name_all_clusters(seeds, df, client, model_config, delay,
                       progress, should_stop):
    """Phase 2: Name and describe all seed clusters using creative model.
    Runs up to 4 LLM calls in parallel for speed."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    model, provider = _get_tiered_model("creative", model_config)
    batch_size = 8  # bigger batches = fewer calls
    max_workers = 4
    named_clusters = []
    total = len(seeds)
    completed = [0]  # mutable counter for progress

    def _prepare_batch(batch):
        """Build LLM payload for a batch of seed clusters."""
        clusters_for_llm = []
        for cluster in batch:
            valid_ids = [tid for tid in cluster["track_ids"] if tid in df.index]
            sample_tracks = []
            for tid in valid_ids[:20]:
                row = df.loc[tid]
                sample_tracks.append({
                    "title": str(row.get("title", "?")),
                    "artist": str(row.get("artist", "?")),
                    "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                    "comment": str(row.get("comment", ""))[:150],
                })
            clusters_for_llm.append({
                "id": cluster["id"],
                "genre_context": f"{cluster['genre_leaf']['title']}: "
                                 f"{cluster['genre_leaf']['description'][:200]}",
                "scene_context": f"{cluster['scene_leaf']['title']}: "
                                 f"{cluster['scene_leaf']['description'][:200]}",
                "track_count": cluster["track_count"],
                "sample_tracks": sample_tracks,
            })
        return clusters_for_llm

    def _call_and_parse(batch, clusters_for_llm):
        """Call LLM and return named cluster dicts."""
        results_list = []
        try:
            results = _llm_name_cluster_batch(clusters_for_llm, client, model, provider)
            result_map = {r["id"]: r for r in results}
            for cluster in batch:
                res = result_map.get(cluster["id"], {})
                results_list.append({
                    "id": cluster["id"],
                    "title": res.get("title", cluster["genre_leaf"]["title"]),
                    "description": res.get("description", ""),
                    "coherence_score": res.get("coherence_score", 5),
                    "poor_fit_track_ids": [
                        (p["track_id"] if isinstance(p, dict) else p)
                        for p in res.get("poor_fit_track_ids", [])
                    ],
                    "track_ids": cluster["track_ids"],
                    "track_count": cluster["track_count"],
                    "genre_context": cluster["genre_leaf"]["title"],
                    "scene_context": cluster["scene_leaf"]["title"],
                    "filters": {
                        **cluster["genre_leaf"].get("filters", {}),
                        **cluster["scene_leaf"].get("filters", {}),
                    },
                })
        except Exception as exc:
            logger.exception("Failed to name cluster batch")
            for cluster in batch:
                results_list.append({
                    "id": cluster["id"],
                    "title": f"{cluster['genre_leaf']['title']} × "
                             f"{cluster['scene_leaf']['title']}",
                    "description": "",
                    "coherence_score": 5,
                    "poor_fit_track_ids": [],
                    "track_ids": cluster["track_ids"],
                    "track_count": cluster["track_count"],
                    "genre_context": cluster["genre_leaf"]["title"],
                    "scene_context": cluster["scene_leaf"]["title"],
                    "filters": {},
                })
        return results_list

    # Build all batches first
    batches = []
    for batch_start in range(0, total, batch_size):
        batch = seeds[batch_start:batch_start + batch_size]
        payload = _prepare_batch(batch)
        batches.append((batch_start, batch, payload))

    progress("cluster_naming",
             f"Naming {total} clusters in {len(batches)} batches "
             f"({max_workers} parallel)...", 5)

    # Submit in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {}
        for batch_start, batch, payload in batches:
            if should_stop():
                break
            fut = pool.submit(_call_and_parse, batch, payload)
            futures[fut] = batch_start

        for fut in as_completed(futures):
            if should_stop():
                break
            results_list = fut.result()
            named_clusters.extend(results_list)
            completed[0] += len(results_list)
            pct = 5 + int((completed[0] / total) * 20)
            progress("cluster_naming",
                     f"Named {completed[0]} of {total} clusters...", pct)

    return named_clusters


# ---------------------------------------------------------------------------
# Phase 3: Deduplicate & Reassign (mechanical model)
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_reassign_batch(cluster_summary, tracks_json, client, model, provider):
    prompt = _REASSIGNMENT_PROMPT.format(
        cluster_summary=cluster_summary,
        tracks_json=tracks_json,
    )
    raw = _call_llm(client, model, provider, _COLLECTION_SYSTEM_PROMPT, prompt,
                    max_tokens=8192)
    return _extract_json(raw)


def _deduplicate_and_reassign(named_clusters, df, all_track_ids, client,
                               model_config, delay, progress, should_stop):
    """Phase 3: Ensure every track is in exactly one cluster.

    Steps:
    1. Greedy dedup — assign each track to highest-scoring cluster
    2. LLM reassignment for poor-fit + orphan tracks (multi-pass)

    Returns: list of clusters with deduplicated track_ids
    """
    import time
    model, provider = _get_tiered_model("mechanical", model_config)

    progress("reassignment", "Deduplicating track assignments...", 26)

    # --- Step 1: greedy dedup ---
    # Build track → cluster assignments, prioritising higher coherence clusters
    # Sort clusters by coherence score descending so better clusters win
    sorted_clusters = sorted(named_clusters, key=lambda c: c["coherence_score"],
                              reverse=True)
    track_to_cluster = {}  # track_id -> cluster_id
    for cluster in sorted_clusters:
        for tid in cluster["track_ids"]:
            if tid not in track_to_cluster:
                track_to_cluster[tid] = cluster["id"]

    # Rebuild cluster track_ids from assignments
    cluster_map = {c["id"]: c for c in named_clusters}
    for c in named_clusters:
        c["track_ids"] = []
    for tid, cid in track_to_cluster.items():
        if cid in cluster_map:
            cluster_map[cid]["track_ids"].append(tid)
    for c in named_clusters:
        c["track_ids"].sort()
        c["track_count"] = len(c["track_ids"])

    # Remove empty clusters
    named_clusters = [c for c in named_clusters if c["track_count"] > 0]

    # --- Step 2: identify orphans + poor fits ---
    assigned = set(track_to_cluster.keys())
    orphans = sorted(set(all_track_ids) - assigned)

    poor_fits = set()
    for c in named_clusters:
        for tid in c.get("poor_fit_track_ids", []):
            if tid in assigned:
                poor_fits.add(tid)

    tracks_to_reassign = sorted(set(orphans) | poor_fits)
    progress("reassignment",
             f"{len(orphans)} orphans, {len(poor_fits)} poor fits to reassign", 28)

    if not tracks_to_reassign:
        return named_clusters

    # --- Step 3: LLM-based reassignment (multi-pass) ---
    # Build compact cluster summary
    cluster_summary = json.dumps([
        {"id": c["id"], "title": c["title"], "track_count": c["track_count"]}
        for c in named_clusters
    ], indent=1)

    batch_size = 80
    max_passes = 3
    for pass_num in range(max_passes):
        if should_stop() or not tracks_to_reassign:
            break

        total_in_pass = len(tracks_to_reassign)
        num_batches = (total_in_pass + batch_size - 1) // batch_size
        progress("reassignment",
                 f"Pass {pass_num + 1}: reassigning {total_in_pass} tracks "
                 f"in {num_batches} batches...",
                 28 + pass_num * 4)

        moved = 0
        for batch_start in range(0, total_in_pass, batch_size):
            if should_stop():
                break
            batch_num = batch_start // batch_size + 1
            pct = 28 + pass_num * 4 + int((batch_num / num_batches) * 3)
            progress("reassignment",
                     f"Pass {pass_num + 1}: batch {batch_num}/{num_batches} "
                     f"({moved} moved so far)...", pct)
            batch_ids = tracks_to_reassign[batch_start:batch_start + batch_size]
            valid_ids = [tid for tid in batch_ids if tid in df.index]
            if not valid_ids:
                continue

            tracks_json = json.dumps([
                {
                    "track_id": int(tid),
                    "title": str(df.loc[tid].get("title", "?")),
                    "artist": str(df.loc[tid].get("artist", "?")),
                    "comment": str(df.loc[tid].get("comment", ""))[:150],
                }
                for tid in valid_ids
            ], indent=1)

            try:
                results = _llm_reassign_batch(cluster_summary, tracks_json,
                                               client, model, provider)
                if delay > 0:
                    time.sleep(delay)

                for res in results:
                    tid = res.get("track_id")
                    cid = res.get("cluster_id")
                    if tid is None or cid == "unassigned" or cid not in cluster_map:
                        continue
                    # Remove from current cluster if poor fit
                    old_cid = track_to_cluster.get(tid)
                    if old_cid and old_cid in cluster_map and tid in cluster_map[old_cid]["track_ids"]:
                        cluster_map[old_cid]["track_ids"].remove(tid)
                        cluster_map[old_cid]["track_count"] = len(cluster_map[old_cid]["track_ids"])
                    # Add to new cluster
                    cluster_map[cid]["track_ids"].append(tid)
                    cluster_map[cid]["track_count"] = len(cluster_map[cid]["track_ids"])
                    track_to_cluster[tid] = cid
                    moved += 1
            except Exception as exc:
                logger.exception("Reassignment batch failed at %d pass %d",
                                 batch_start, pass_num)
                progress("reassignment",
                         f"Batch {batch_start + 1} pass {pass_num + 1} failed: {exc}",
                         28 + pass_num * 4)

        # Check stability — stop if fewer than 5% of tracks moved
        if moved < max(1, len(tracks_to_reassign) * 0.05):
            break

        # Recalculate remaining orphans for next pass
        assigned = set(track_to_cluster.keys())
        tracks_to_reassign = sorted(set(all_track_ids) - assigned)

    # Final cleanup: assign any remaining orphans to nearest cluster by scored_search
    assigned = set(track_to_cluster.keys())
    final_orphans = sorted(set(all_track_ids) - assigned)
    if final_orphans:
        progress("reassignment",
                 f"Assigning {len(final_orphans)} remaining orphans by scoring...", 38)
        for tid in final_orphans:
            if tid not in df.index:
                continue
            best_cluster = None
            best_score = -1
            track_row = df.loc[[tid]]
            for c in named_clusters:
                if not c.get("filters"):
                    continue
                results = scored_search(track_row, c["filters"],
                                         min_score=0.0, max_results=1)
                if results and results[0][1] > best_score:
                    best_score = results[0][1]
                    best_cluster = c["id"]
            if best_cluster and best_cluster in cluster_map:
                cluster_map[best_cluster]["track_ids"].append(tid)
                cluster_map[best_cluster]["track_count"] = len(
                    cluster_map[best_cluster]["track_ids"])
                track_to_cluster[tid] = best_cluster

    # Remove empty clusters again
    named_clusters = [c for c in named_clusters if c["track_count"] > 0]
    progress("reassignment",
             f"Reassignment complete — {len(named_clusters)} clusters", 40)
    return named_clusters


# ---------------------------------------------------------------------------
# Phase 4: Quality scoring & merge/split (mechanical model)
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_score_clusters(clusters_json, client, model, provider):
    prompt = _QUALITY_SCORING_PROMPT.format(clusters_json=clusters_json)
    raw = _call_llm(client, model, provider, _COLLECTION_SYSTEM_PROMPT, prompt,
                    max_tokens=8192)
    return _extract_json(raw)


@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_split_cluster(cluster, mini_landscape, split_count, client, model, provider):
    prompt = _SPLIT_CLUSTER_PROMPT.format(
        cluster_title=cluster["title"],
        cluster_description=cluster.get("description", ""),
        track_count=cluster["track_count"],
        mini_landscape=mini_landscape,
        split_count=split_count,
        filter_help=_FILTER_FIELDS_HELP,
    )
    raw = _call_llm(client, model, provider, _COLLECTION_SYSTEM_PROMPT, prompt)
    return _extract_json(raw)


def _quality_pass(clusters, df, client, model_config, delay,
                  progress, should_stop):
    """Phase 4: Score cluster quality, merge similar, split diverse. Iterate."""
    import time
    model_mech, provider_mech = _get_tiered_model("mechanical", model_config)
    model_cre, provider_cre = _get_tiered_model("creative", model_config)
    max_iterations = 3
    batch_size = 15

    for iteration in range(max_iterations):
        if should_stop():
            break

        pct = 40 + iteration * 5
        progress("quality_scoring",
                 f"Iteration {iteration + 1}: scoring {len(clusters)} clusters...", pct)

        # --- Score all clusters in batches ---
        all_scores = {}
        merge_suggestions = []
        split_suggestions = []

        num_batches = (len(clusters) + batch_size - 1) // batch_size
        for batch_start in range(0, len(clusters), batch_size):
            if should_stop():
                break
            batch_num = batch_start // batch_size + 1
            progress("quality_scoring",
                     f"Iteration {iteration + 1}: scoring batch {batch_num}/{num_batches} "
                     f"({len(all_scores)} scored so far)...", pct)
            batch = clusters[batch_start:batch_start + batch_size]
            clusters_for_scoring = [
                {
                    "id": c["id"],
                    "title": c["title"],
                    "description": c.get("description", "")[:200],
                    "track_count": c["track_count"],
                }
                for c in batch
            ]

            try:
                result = _llm_score_clusters(
                    json.dumps(clusters_for_scoring, indent=1),
                    client, model_mech, provider_mech,
                )
                if delay > 0:
                    time.sleep(delay)

                for s in result.get("scores", []):
                    raw_score = s.get("score", 5)
                    # Normalize: LLM sometimes returns {"score": {...}} instead of int
                    if isinstance(raw_score, dict):
                        raw_score = raw_score.get("score", raw_score.get("value", 5))
                    try:
                        raw_score = int(raw_score)
                    except (TypeError, ValueError):
                        raw_score = 5
                    all_scores[s["id"]] = raw_score
                merge_suggestions.extend(result.get("merge_suggestions", []))
                split_suggestions.extend(result.get("split_suggestions", []))
            except Exception as exc:
                logger.exception("Quality scoring batch failed at %d", batch_start)
                progress("quality_scoring",
                         f"Scoring batch {batch_start + 1} failed: {exc}",
                         pct)

        # Check if all scores are good enough
        low_scores = [cid for cid, score in all_scores.items() if score < 7]
        if not low_scores and not merge_suggestions and not split_suggestions:
            break  # All clusters are good

        # --- Execute merges ---
        cluster_map = {c["id"]: c for c in clusters}
        merged_ids = set()
        for merge in merge_suggestions[:5]:  # Cap at 5 merges per iteration
            if should_stop():
                break
            ids = merge.get("ids", [])
            if len(ids) < 2:
                continue
            existing = [cid for cid in ids if cid in cluster_map and cid not in merged_ids]
            if len(existing) < 2:
                continue

            # Merge into first cluster
            target = cluster_map[existing[0]]
            for cid in existing[1:]:
                source = cluster_map[cid]
                target["track_ids"].extend(source["track_ids"])
                merged_ids.add(cid)
            target["track_ids"] = sorted(set(target["track_ids"]))
            target["track_count"] = len(target["track_ids"])
            # Re-name merged cluster with creative model
            try:
                valid_ids = [tid for tid in target["track_ids"][:20] if tid in df.index]
                sample = [
                    {
                        "title": str(df.loc[tid].get("title", "?")),
                        "artist": str(df.loc[tid].get("artist", "?")),
                        "comment": str(df.loc[tid].get("comment", ""))[:100],
                    }
                    for tid in valid_ids
                ]
                rename_result = _llm_name_cluster_batch(
                    [{"id": target["id"], "genre_context": target.get("genre_context", ""),
                      "scene_context": target.get("scene_context", ""),
                      "track_count": target["track_count"], "sample_tracks": sample}],
                    client, model_cre, provider_cre,
                )
                if rename_result:
                    r = rename_result[0]
                    target["title"] = r.get("title", target["title"])
                    target["description"] = r.get("description", target["description"])
                if delay > 0:
                    time.sleep(delay)
            except Exception as exc:
                logger.exception("Failed to rename merged cluster %s", target["id"])
                progress("quality_scoring",
                         f"Rename failed for {target['id']}: {exc}", pct)

        clusters = [c for c in clusters if c["id"] not in merged_ids]

        # --- Execute splits ---
        new_clusters = []
        split_ids = set()
        for split in split_suggestions[:3]:  # Cap at 3 splits per iteration
            if should_stop():
                break
            cid = split.get("id")
            split_count = split.get("into", 2)
            if cid not in cluster_map or cid in split_ids:
                continue
            cluster = cluster_map[cid]
            if cluster["track_count"] < 30:  # Don't split small clusters
                continue

            valid_ids = [tid for tid in cluster["track_ids"] if tid in df.index]
            if not valid_ids:
                continue

            df_subset = df.loc[valid_ids]
            mini_land = build_mini_landscape(df_subset)

            try:
                sub_defs = _llm_split_cluster(
                    cluster, mini_land, split_count,
                    client, model_mech, provider_mech,
                )
                if delay > 0:
                    time.sleep(delay)

                # Assign tracks to sub-clusters
                assignments, _ = assign_tracks_to_branches(df_subset, sub_defs,
                                                            min_score=0.01)
                for sub_def in sub_defs:
                    tids = assignments.get(sub_def["id"], [])
                    if tids:
                        new_clusters.append({
                            "id": sub_def["id"],
                            "title": sub_def.get("title", "Untitled"),
                            "description": sub_def.get("description", ""),
                            "track_ids": sorted(tids),
                            "track_count": len(tids),
                            "genre_context": cluster.get("genre_context", ""),
                            "scene_context": cluster.get("scene_context", ""),
                            "filters": sub_def.get("filters", {}),
                            "coherence_score": 5,
                            "poor_fit_track_ids": [],
                        })
                split_ids.add(cid)
            except Exception as exc:
                logger.exception("Failed to split cluster %s", cid)
                progress("quality_scoring",
                         f"Split failed for {cid}: {exc}", pct)

        clusters = [c for c in clusters if c["id"] not in split_ids]
        clusters.extend(new_clusters)

        progress("quality_scoring",
                 f"Iteration {iteration + 1} done: {len(merged_ids)} merged, "
                 f"{len(split_ids)} split — {len(clusters)} clusters remain", pct + 3)

    return clusters


# ---------------------------------------------------------------------------
# Phase 5: Top-level grouping (creative model)
# ---------------------------------------------------------------------------

@retry(wait=wait_fixed(3), stop=stop_after_attempt(3),
       retry=retry_if_exception_type(Exception))
def _llm_group_categories(clusters_json, count, client, model, provider):
    prompt = _GROUPING_PROMPT.format(clusters_json=clusters_json, count=count)
    raw = _call_llm(client, model, provider, _COLLECTION_SYSTEM_PROMPT, prompt,
                    max_tokens=8192)
    return _extract_json(raw)


def _group_into_categories(clusters, client, model_config, delay,
                            progress, should_stop):
    """Phase 5: Group clusters into 8-12 top-level categories."""
    import time
    model, provider = _get_tiered_model("creative", model_config)

    progress("grouping",
             f"Grouping {len(clusters)} collections into categories...", 56)

    # Build compact summary for LLM
    summaries = [
        {
            "id": c["id"],
            "title": c["title"],
            "description": c.get("description", "")[:150],
            "track_count": c["track_count"],
            "genre_context": c.get("genre_context", ""),
            "scene_context": c.get("scene_context", ""),
        }
        for c in clusters
    ]

    try:
        categories = _llm_group_categories(
            json.dumps(summaries, indent=1), len(clusters),
            client, model, provider,
        )
        if delay > 0:
            time.sleep(delay)
    except Exception:
        logger.exception("Failed to group into categories")
        # Fallback: single category with all clusters
        categories = [{
            "id": "all-collections",
            "title": "All Collections",
            "description": "All music collections in your library.",
            "cluster_ids": [c["id"] for c in clusters],
        }]

    # Validate: ensure every cluster is assigned to exactly one category
    cluster_map = {c["id"]: c for c in clusters}
    assigned_cluster_ids = set()
    for cat in categories:
        cat_cluster_ids = cat.get("cluster_ids", [])
        # Only keep valid cluster IDs
        cat["cluster_ids"] = [cid for cid in cat_cluster_ids if cid in cluster_map]
        assigned_cluster_ids.update(cat["cluster_ids"])

    # Any unassigned clusters go into an "Other" category or the largest category
    unassigned = set(cluster_map.keys()) - assigned_cluster_ids
    if unassigned:
        if categories:
            # Add to largest category
            largest = max(categories, key=lambda c: len(c.get("cluster_ids", [])))
            largest["cluster_ids"].extend(sorted(unassigned))
        else:
            categories.append({
                "id": "uncategorised",
                "title": "Uncategorised",
                "description": "",
                "cluster_ids": sorted(unassigned),
            })

    progress("grouping",
             f"Created {len(categories)} categories", 64)
    return categories


# ---------------------------------------------------------------------------
# Phase 6: Final descriptions & exemplars (creative model)
# ---------------------------------------------------------------------------

def _finalize_collection_leaves(categories, cluster_map, df, client,
                                 model_config, delay, progress, should_stop):
    """Phase 6: Write rich descriptions and pick exemplars for all leaves.
    Runs up to 4 LLM calls in parallel for speed."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    model, provider = _get_tiered_model("creative", model_config)
    batch_size = 5
    max_workers = 4

    # Collect all leaves
    all_leaves = []
    for cat in categories:
        for cid in cat.get("cluster_ids", []):
            if cid in cluster_map:
                all_leaves.append(cluster_map[cid])

    total = len(all_leaves)
    completed = [0]

    def _process_batch(batch):
        """Prepare data + call LLM for one batch, return (shortlists, finalized)."""
        nodes_for_llm = []
        shortlists = {}

        for cluster in batch:
            valid_ids = [tid for tid in cluster["track_ids"] if tid in df.index]
            if not valid_ids:
                continue
            df_subset = df.loc[valid_ids]
            filters = cluster.get("filters", {})
            if filters:
                results = scored_search(df_subset, filters,
                                         min_score=0.01, max_results=50)
            else:
                results = [(idx, 0.5, {}) for idx in valid_ids[:50]]

            candidates = []
            fallback = []
            for idx, score, _ in results[:50]:
                if idx not in df.index:
                    continue
                row = df.loc[idx]
                track = {
                    "title": str(row.get("title", "?")),
                    "artist": str(row.get("artist", "?")),
                    "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                    "comment": str(row.get("comment", ""))[:150],
                }
                candidates.append(track)
                if len(fallback) < 7:
                    fallback.append({
                        "title": track["title"],
                        "artist": track["artist"],
                        "year": track["year"],
                    })

            shortlists[cluster["id"]] = fallback
            nodes_for_llm.append({
                "id": cluster["id"],
                "title": cluster["title"],
                "description": cluster.get("description", ""),
                "track_count": cluster["track_count"],
                "candidates": candidates[:30],
            })

        if not nodes_for_llm:
            return shortlists, None

        try:
            finalized = _llm_finalize_leaves(
                json.dumps(nodes_for_llm, indent=2),
                client, model, provider,
                profile={"leaf_prompt": _COLLECTION_LEAF_PROMPT,
                          "system_prompt": _COLLECTION_SYSTEM_PROMPT},
            )
            return shortlists, finalized
        except Exception as exc:
            logger.exception("Failed to finalize leaf batch")
            return shortlists, None

    # Build all batches
    batch_items = []
    for batch_start in range(0, total, batch_size):
        batch = all_leaves[batch_start:batch_start + batch_size]
        batch_items.append(batch)

    progress("final_descriptions",
             f"Writing descriptions for {total} collections in {len(batch_items)} "
             f"batches ({max_workers} parallel)...", 66)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {}
        for batch in batch_items:
            if should_stop():
                break
            fut = pool.submit(_process_batch, batch)
            futures[fut] = batch

        for fut in as_completed(futures):
            if should_stop():
                break
            batch = futures[fut]
            shortlists, finalized = fut.result()

            if finalized:
                fin_map = {f["id"]: f for f in finalized}
                for cluster in batch:
                    fin = fin_map.get(cluster["id"])
                    if fin:
                        cluster["title"] = fin.get("title", cluster["title"])
                        cluster["description"] = fin.get("description",
                                                          cluster["description"])
                        cluster["examples"] = fin.get("examples", [])[:7]
                    elif cluster["id"] in shortlists:
                        cluster["examples"] = shortlists[cluster["id"]]
            else:
                for cluster in batch:
                    if cluster["id"] in shortlists:
                        cluster["examples"] = shortlists.get(cluster["id"], [])

            completed[0] += len(batch)
            pct = 66 + int((completed[0] / total) * 19)
            progress("final_descriptions",
                     f"Described {completed[0]} of {total} collections...", pct)


# ---------------------------------------------------------------------------
# Phase 7: Metadata enrichment (creative model)
# ---------------------------------------------------------------------------

def _enrich_metadata(categories, cluster_map, df, client, model_config,
                     delay, progress, should_stop):
    """Phase 7: Suggest metadata improvements for tracks in each cluster.
    Runs up to 4 LLM calls in parallel for speed."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    model, provider = _get_tiered_model("creative", model_config)
    max_workers = 4

    all_leaves = []
    for cat in categories:
        for cid in cat.get("cluster_ids", []):
            if cid in cluster_map:
                all_leaves.append(cluster_map[cid])

    total = len(all_leaves)
    completed = [0]

    def _enrich_one(cluster):
        """Enrich a single cluster, return (cluster_id, suggestions)."""
        valid_ids = [tid for tid in cluster["track_ids"] if tid in df.index]
        if not valid_ids:
            return cluster["id"], []

        tracks_json = json.dumps([
            {
                "track_id": int(tid),
                "title": str(df.loc[tid].get("title", "?")),
                "artist": str(df.loc[tid].get("artist", "?")),
                "comment": str(df.loc[tid].get("comment", ""))[:200],
            }
            for tid in valid_ids[:30]
        ], indent=1)

        prompt = _ENRICHMENT_PROMPT.format(
            cluster_title=cluster["title"],
            cluster_description=cluster.get("description", "")[:300],
            tracks_json=tracks_json,
        )

        try:
            raw = _call_llm(client, model, provider,
                            _COLLECTION_SYSTEM_PROMPT, prompt,
                            max_tokens=8192)
            suggestions = _extract_json(raw)
            return cluster["id"], [
                s for s in suggestions
                if s.get("confidence", 0) >= 0.7
            ]
        except Exception as exc:
            logger.exception("Enrichment failed for cluster %s", cluster["id"])
            return cluster["id"], []

    progress("enrichment",
             f"Enriching metadata for {total} collections "
             f"({max_workers} parallel)...", 86)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {}
        for cluster in all_leaves:
            if should_stop():
                break
            fut = pool.submit(_enrich_one, cluster)
            futures[fut] = cluster

        for fut in as_completed(futures):
            if should_stop():
                break
            cluster = futures[fut]
            cid, suggestions = fut.result()
            cluster["metadata_suggestions"] = suggestions
            completed[0] += 1
            pct = 86 + int((completed[0] / total) * 12)
            progress("enrichment",
                     f"Enriched {completed[0]} of {total} collections...", pct)


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def build_curated_collection(df, client, model_config, delay,
                              progress_cb=None, stop_flag=None,
                              test_mode=False):
    """Build the curated Collection Tree by cross-referencing Genre + Scene trees.

    Args:
        df: DataFrame with parsed facet columns
        client: Anthropic client (used for both model tiers)
        model_config: dict with 'creative' and 'mechanical' model names
        delay: seconds between LLM calls
        progress_cb: callable(phase, detail, percent) for SSE updates
        stop_flag: threading.Event for graceful stop
        test_mode: if True, cap seeds at 20 and skip Phase 7 for fast validation

    Returns:
        tree dict with flat categories/leaves structure
    """
    import time
    parse_all_comments(df)
    total_tracks = len(df)
    all_track_ids = sorted(df.index.tolist())

    def progress(phase, detail, pct):
        logger.info("[collection] %s (%d%%) — %s", phase, pct, detail)
        if progress_cb:
            progress_cb(phase, detail, pct)

    def should_stop():
        return stop_flag and stop_flag.is_set()

    # --- Load source trees ---
    genre_tree = load_tree(TREE_PROFILES["genre"]["file"])
    scene_tree = load_tree(TREE_PROFILES["scene"]["file"])
    if not genre_tree or not scene_tree:
        raise ValueError("Both Genre and Scene trees must be built first")

    # --- Check for checkpoint to resume from ---
    checkpoint_phase, checkpoint_data = _load_checkpoint() if not test_mode else (0, {})
    named_clusters = checkpoint_data.get("named_clusters")
    clusters = checkpoint_data.get("clusters")
    categories = checkpoint_data.get("categories")

    if checkpoint_phase > 0:
        progress("intersection_matrix",
                 f"Resuming from checkpoint (phase {checkpoint_phase} complete)", 5)

    # === Phase 1: Intersection Matrix ===
    if checkpoint_phase < 1:
        progress("intersection_matrix", "Computing genre × scene intersections...", 1)
        seeds = _build_intersection_matrix(genre_tree, scene_tree, min_tracks=5)
        if test_mode:
            full_count = len(seeds)
            seeds = seeds[:20]
            test_track_ids = set()
            for s in seeds:
                test_track_ids.update(s["track_ids"])
            all_track_ids = sorted(test_track_ids & set(all_track_ids))
            total_tracks = len(all_track_ids)
            progress("intersection_matrix",
                     f"TEST MODE: using top 20 of {full_count} seeds "
                     f"({total_tracks} tracks) for fast validation", 5)
        else:
            progress("intersection_matrix",
                     f"Found {len(seeds)} seed clusters from leaf intersections", 5)
    else:
        seeds = None  # Not needed — Phase 2 already done

    if should_stop():
        return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)

    # === Phase 2: Cluster Naming ===
    if checkpoint_phase < 2:
        named_clusters = _name_all_clusters(
            seeds, df, client, model_config, delay, progress, should_stop,
        )
        if should_stop():
            return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)
        progress("cluster_naming",
                 f"Named {len(named_clusters)} clusters", 25)
        if not test_mode:
            _save_checkpoint(2, {"named_clusters": named_clusters,
                                  "all_track_ids": all_track_ids})
    else:
        all_track_ids = checkpoint_data.get("all_track_ids", all_track_ids)
        progress("cluster_naming",
                 "Skipped — loaded from checkpoint", 25)

    # === Phase 3: Deduplicate & Reassign ===
    if checkpoint_phase < 3:
        clusters = _deduplicate_and_reassign(
            named_clusters, df, all_track_ids, client,
            model_config, delay, progress, should_stop,
        )
        if should_stop():
            return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)
        if not test_mode:
            _save_checkpoint(3, {"clusters": clusters,
                                  "all_track_ids": all_track_ids})
    else:
        progress("reassignment",
                 f"Skipped — {len(clusters)} clusters from checkpoint", 40)

    # === Phase 4: Quality Scoring ===
    if checkpoint_phase < 4:
        clusters = _quality_pass(
            clusters, df, client, model_config, delay, progress, should_stop,
        )
        if should_stop():
            return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)
        progress("quality_scoring",
                 f"Quality pass complete — {len(clusters)} clusters", 55)
        if not test_mode:
            _save_checkpoint(4, {"clusters": clusters,
                                  "all_track_ids": all_track_ids})
    else:
        progress("quality_scoring",
                 f"Skipped — {len(clusters)} clusters from checkpoint", 55)

    # === Phase 5: Top-Level Grouping ===
    if checkpoint_phase < 5:
        categories = _group_into_categories(
            clusters, client, model_config, delay, progress, should_stop,
        )
        if should_stop():
            return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)
        if not test_mode:
            _save_checkpoint(5, {"clusters": clusters, "categories": categories,
                                  "all_track_ids": all_track_ids})
    else:
        progress("grouping",
                 f"Skipped — {len(categories)} categories from checkpoint", 64)

    # Build cluster lookup for phases 6 & 7
    cluster_map = {c["id"]: c for c in clusters}

    # === Phase 6: Final Descriptions & Exemplars ===
    if checkpoint_phase < 6:
        _finalize_collection_leaves(
            categories, cluster_map, df, client,
            model_config, delay, progress, should_stop,
        )
        if should_stop():
            return _make_collection_tree(total_tracks, [], "stopped", genre_tree, scene_tree)
        if not test_mode:
            _save_checkpoint(6, {"clusters": clusters, "categories": categories,
                                  "all_track_ids": all_track_ids})
    else:
        progress("final_descriptions",
                 f"Skipped — descriptions from checkpoint", 85)

    # === Phase 7: Metadata Enrichment ===
    if test_mode:
        progress("enrichment", "TEST MODE: skipping enrichment phase", 98)
    elif checkpoint_phase < 7:
        _enrich_metadata(
            categories, cluster_map, df, client,
            model_config, delay, progress, should_stop,
        )
    else:
        progress("enrichment", "Skipped — enrichment from checkpoint", 98)

    # === Assemble final tree ===
    progress("complete", "Assembling final collection tree...", 98)

    # Build category objects with nested leaves
    final_categories = []
    all_assigned = set()
    for cat in categories:
        cat_leaves = []
        cat_track_ids = []
        for cid in cat.get("cluster_ids", []):
            c = cluster_map.get(cid)
            if not c:
                continue
            leaf = {
                "id": c["id"],
                "title": c["title"],
                "description": c.get("description", ""),
                "track_ids": c["track_ids"],
                "track_count": c["track_count"],
                "examples": c.get("examples", []),
                "genre_context": c.get("genre_context", ""),
                "scene_context": c.get("scene_context", ""),
                "metadata_suggestions": c.get("metadata_suggestions", []),
            }
            cat_leaves.append(leaf)
            cat_track_ids.extend(c["track_ids"])
            all_assigned.update(c["track_ids"])

        final_categories.append({
            "id": cat["id"],
            "title": cat["title"],
            "description": cat.get("description", ""),
            "track_ids": sorted(set(cat_track_ids)),
            "track_count": len(set(cat_track_ids)),
            "leaves": cat_leaves,
        })

    ungrouped = sorted(set(all_track_ids) - all_assigned)

    tree = {
        "id": str(uuid.uuid4())[:8],
        "tree_type": "collection",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_tracks": total_tracks,
        "assigned_tracks": total_tracks - len(ungrouped),
        "ungrouped_track_ids": ungrouped,
        "source_trees": {
            "genre": {
                "id": genre_tree.get("id", ""),
                "created_at": genre_tree.get("created_at", ""),
            },
            "scene": {
                "id": scene_tree.get("id", ""),
                "created_at": scene_tree.get("created_at", ""),
            },
        },
        "categories": final_categories,
        "status": "complete",
    }

    save_tree(tree, file_path=_COLLECTION_TREE_FILE)
    _clear_checkpoint()
    progress("complete", "Collection tree built!", 100)
    return tree


def _make_collection_tree(total_tracks, categories, status,
                           genre_tree=None, scene_tree=None):
    """Build a partial/stopped collection tree."""
    return {
        "id": str(uuid.uuid4())[:8],
        "tree_type": "collection",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_tracks": total_tracks,
        "assigned_tracks": 0,
        "ungrouped_track_ids": [],
        "source_trees": {
            "genre": {"id": genre_tree.get("id", "") if genre_tree else "",
                       "created_at": genre_tree.get("created_at", "") if genre_tree else ""},
            "scene": {"id": scene_tree.get("id", "") if scene_tree else "",
                       "created_at": scene_tree.get("created_at", "") if scene_tree else ""},
        },
        "categories": categories,
        "status": status,
    }
