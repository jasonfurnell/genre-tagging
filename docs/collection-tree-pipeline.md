# Collection Tree Pipeline

## Overview

The Collection Tree is a curated, cross-referenced view of a music collection that combines insights from two existing tree types:

- **Genre Tree**: organises tracks by musical lineage (House → Deep House → Lo-Fi House)
- **Scene Tree**: organises tracks by cultural moment (Berlin Minimal 2000-2008)

By intersecting these two lenses, the Collection Tree reveals **natural clusters** — groups of tracks that share both a genre identity and a cultural context. The result is a shallow, browsable hierarchy: 8-12 top-level categories, each containing ~15 leaf playlists (~150 total).

### Prerequisites
- Both Genre and Scene trees must be built before the Collection Tree can be generated
- All tracks must have comments parsed (facet columns populated)

### Model Tiering
The pipeline uses two Claude models to balance cost and quality:
- **Creative** (`claude-sonnet-4-5-20250929`): Naming, descriptions, grouping, enrichment — tasks requiring cultural knowledge and eloquence
- **Mechanical** (`claude-3-5-haiku-20241022`): Scoring, classification, reassignment — structured analytical tasks

---

## Pipeline Phases

### Phase 1: Intersection Matrix (0-5%) — Pure Python

**Input**: Genre tree JSON, Scene tree JSON
**Output**: ~200-500 seed clusters

Algorithm:
1. Extract all leaf nodes from both trees
2. Build `set(track_ids)` per leaf for O(1) intersection
3. For every genre_leaf × scene_leaf pair, compute set intersection
4. Keep pairs with ≥ 5 shared tracks
5. Sort by size descending

Each seed cluster contains:
- Combined track IDs from the intersection
- Context from both parent leaves (title, description, filters)

**Key insight**: Tracks may appear in multiple seed clusters at this stage. Deduplication happens in Phase 3.

### Phase 2: Cluster Naming (5-25%) — Creative Model

**Input**: Seed clusters + track data
**Output**: Named clusters with descriptions and coherence scores

Process:
1. Batch clusters in groups of 6
2. For each batch, sample 20 tracks per cluster (title, artist, year, comment)
3. LLM creates: evocative name, 3-4 sentence scene description, coherence score (1-10), poor-fit flags
4. Fallback: use "{genre_title} × {scene_title}" as name if LLM fails

### Phase 3: Reassignment (25-40%) — Mechanical Model

**Input**: Named clusters (with overlapping tracks) + orphan tracks
**Output**: Clusters with exactly one track per cluster

Steps:
1. **Greedy dedup**: Assign each track to its highest-coherence cluster
2. **Identify problems**: Collect poor-fit tracks + tracks in no cluster
3. **LLM reassignment**: Batch 40 tracks at a time, ask Haiku to pick the best cluster
4. **Multi-pass**: Up to 3 passes; stop when <5% of tracks move
5. **Final fallback**: Any remaining orphans assigned by `scored_search()` scoring

**Constraint**: Every track must end up in exactly one cluster.

### Phase 4: Quality Scoring (40-55%) — Mechanical Model

**Input**: Deduplicated clusters
**Output**: Refined clusters (some merged, some split)

Iterative process (up to 3 iterations):
1. Score all clusters for coherence (1-10) in batches of 15
2. LLM identifies merge candidates (too similar) and split candidates (too diverse / >60 tracks)
3. **Merge**: Combine track_ids, regenerate name with creative model
4. **Split**: Build mini-landscape, LLM generates sub-clusters, reassign tracks via `assign_tracks_to_branches()`
5. Stop when all scores ≥ 7 or max iterations reached

**Target**: ~120-180 clusters (accept this range, aim for ~150)

### Phase 5: Top-Level Grouping (55-65%) — Creative Model

**Input**: ~150 finalized clusters
**Output**: 8-12 category families

Single LLM call with all cluster summaries. The LLM groups bottom-up based on shared musical DNA, cultural affinity, or dancefloor energy. Each category gets a name and 2-3 sentence description.

Validation ensures every cluster is assigned to exactly one category.

### Phase 6: Final Descriptions & Exemplars (65-85%) — Creative Model

**Input**: Categories with clusters
**Output**: Rich descriptions + 7 exemplar tracks per leaf

Process:
1. Two-stage exemplar selection: `scored_search()` shortlist (50 candidates) → LLM picks 7
2. LLM writes rich paragraph descriptions (4-6 sentences) for each leaf
3. Processed in batches of 5 leaves
4. Category descriptions also finalized

### Phase 7: Metadata Enrichment (85-98%) — Creative Model

**Input**: Finalized leaves with tracks
**Output**: Per-track metadata improvement suggestions

For each leaf, the LLM analyses tracks in context of the cluster and suggests:
- **Genre refinement**: More specific sub-genre (e.g., "House" → "Acid House")
- **Scene tags**: Cultural/geographic/temporal context to add
- **Descriptors**: Production or sonic descriptors to add
- **Era refinement**: More precise era information

Suggestions are stored on each leaf node (NOT auto-applied) for user review.
Only high-confidence suggestions (≥ 0.7) are kept.

---

## Data Structures

### Collection Tree JSON
```json
{
  "id": "uuid",
  "tree_type": "collection",
  "created_at": "ISO timestamp",
  "total_tracks": 6303,
  "assigned_tracks": 6303,
  "ungrouped_track_ids": [],
  "source_trees": {
    "genre": { "id": "...", "created_at": "..." },
    "scene": { "id": "...", "created_at": "..." }
  },
  "categories": [
    {
      "id": "kebab-case-id",
      "title": "Category Name",
      "description": "2-3 sentences...",
      "track_ids": [all track IDs in category],
      "track_count": 250,
      "leaves": [
        {
          "id": "leaf-id",
          "title": "Leaf Name",
          "description": "Rich paragraph...",
          "track_ids": [20-50 track IDs],
          "track_count": 35,
          "examples": [{"title": "...", "artist": "...", "year": 2001}, ...],
          "genre_context": "Parent genre leaf title",
          "scene_context": "Parent scene leaf title",
          "metadata_suggestions": [
            {
              "track_id": 123,
              "suggestions": {
                "genre_refinement": "Acid House",
                "scene_tags": ["Chicago warehouse"],
                "descriptors": ["303 squelch"],
                "era_refinement": "late 1980s"
              },
              "confidence": 0.9,
              "reasoning": "Brief explanation"
            }
          ]
        }
      ]
    }
  ],
  "status": "complete"
}
```

Note: This uses `categories` with flat `leaves` — NOT the `lineages` with recursive `children` structure used by Genre and Scene trees.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collection-tree` | Load existing collection tree |
| POST | `/api/collection-tree/build` | Start build (requires Genre + Scene trees) |
| GET | `/api/collection-tree/progress` | SSE progress stream |
| POST | `/api/collection-tree/stop` | Stop build gracefully |
| GET | `/api/collection-tree/ungrouped` | Get ungrouped tracks |
| POST | `/api/collection-tree/create-playlist` | Create workshop playlist from leaf |
| POST | `/api/collection-tree/create-all-playlists` | Batch create all leaf playlists |
| GET | `/api/collection-tree/node/<id>/export/m3u` | Export node tracks as M3U8 |
| DELETE | `/api/collection-tree` | Delete collection tree |

---

## Frontend Display

Unlike Genre and Scene trees which use a nested collapsible tree layout, the Collection Tree uses a **category sidebar + flat card grid**:

- **Left sidebar**: 8-12 category buttons (always visible, sticky)
- **Main area**: Leaf cards for the selected category in a responsive CSS grid
- Each card shows: title, track count, genre/scene context tags, description, exemplar tracks, action buttons, metadata suggestion badge

---

## Estimated LLM Calls

For a ~6,300 track collection producing ~150 leaves:

| Phase | Calls | Model |
|-------|-------|-------|
| Phase 2 (naming) | ~50-80 | Sonnet 4.5 |
| Phase 3 (reassignment) | ~20-50 | Haiku 3.5 |
| Phase 4 (quality) | ~20-30 | Haiku 3.5 |
| Phase 5 (grouping) | ~1-2 | Sonnet 4.5 |
| Phase 6 (descriptions) | ~30-40 | Sonnet 4.5 |
| Phase 7 (enrichment) | ~50-80 | Sonnet 4.5 |
| **Total** | **~170-280** | Mixed |

Estimated cost: $8-15 (with model tiering)

---

## Future Optimisation Paths

1. **Intersection threshold tuning**: The `min_tracks=5` threshold could be adjusted based on collection size
2. **Parallel LLM calls**: Phases 2, 3, 6, and 7 are embarrassingly parallelisable at the batch level
3. **Incremental updates**: When new tracks are added, only recompute affected intersections
4. **Quality scoring refinement**: Use track-level features (BPM, key) in addition to comment-based facets
5. **Auto-apply metadata**: Build a UI to review and apply metadata suggestions
6. **Cross-collection learning**: Use enrichment suggestions from Phase 7 to improve future Genre/Scene tree builds
