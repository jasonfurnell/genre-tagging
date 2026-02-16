# Collection Tree Pipeline — Technical Reference

## Overview

The Collection Tree is a curated, cross-referenced view of a music collection that combines insights from two existing tree types:

- **Genre Tree**: organises tracks by musical lineage (House → Deep House → Lo-Fi House)
- **Scene Tree**: organises tracks by cultural moment (Berlin Minimal 2000-2008)

By intersecting these two lenses, the Collection Tree reveals **natural clusters** — groups of tracks that share both a genre identity and a cultural context. The result is a shallow, browsable hierarchy: categories containing leaf playlists.

### Prerequisites
- Both Genre and Scene trees must be built before the Collection Tree can be generated
- All tracks must have comments parsed (facet columns populated)
- Music file must be uploaded (DataFrame in memory)

### Model Tiering
The pipeline uses two Claude models to balance cost and quality:
- **Creative** (`claude-sonnet-4-5-20250929`): Naming, descriptions, grouping, enrichment — tasks requiring cultural knowledge and eloquence
- **Mechanical** (`claude-3-5-haiku-20241022`): Scoring, classification, reassignment — structured analytical tasks

Both models are Anthropic, so a single client instance is used. The tier is selected per-phase via `_get_tiered_model(tier, model_config)` which returns `(model_name, provider)`.

Model config can be overridden in `config.json` with `creative_model` and `mechanical_model` keys, falling back to `COLLECTION_TREE_MODELS` defaults.

---

## Pipeline Phases

### Phase 1: Intersection Matrix (0-5%) — Pure Python

**Function**: `_build_intersection_matrix(genre_tree, scene_tree, min_tracks=5)`
**Input**: Genre tree JSON, Scene tree JSON
**Output**: Seed clusters (actual: ~298 for a 6,303 track collection)

Algorithm:
1. Extract all leaf nodes from both trees using `_collect_leaves()`
2. Build `set(track_ids)` per leaf for O(1) intersection
3. Compute Cartesian product: every genre_leaf × scene_leaf pair
4. For each pair, compute `set.intersection()`
5. Keep pairs with ≥ `min_tracks` (default 5) shared tracks
6. Sort by track count descending

Each seed cluster contains:
- `id`: `"{genre_leaf_id}__{scene_leaf_id}"`
- `track_ids`: sorted list of shared track IDs
- `track_count`: number of shared tracks
- `genre_leaf` / `scene_leaf`: context objects (title, description, filters) from source trees
- `filters`: merged from both leaf filters

**Complexity**: O(G × S) where G = genre leaves (~233), S = scene leaves (~275) = ~64K pairs
**Duration**: Seconds (no LLM calls)
**Checkpoint**: Not saved (too fast to be worth it)

**Key insight**: Tracks appear in multiple seed clusters at this stage — a single track can sit at the intersection of several genre/scene pairs. Deduplication happens in Phase 3.

---

### Phase 2: Cluster Naming (5-25%) — Creative Model

**Function**: `_name_all_clusters(seeds, df, client, model_config, delay, progress, should_stop)`
**Input**: Seed clusters + DataFrame
**Output**: Named clusters with descriptions, coherence scores, and poor-fit flags

| Setting | Value |
|---------|-------|
| Model | Creative (Sonnet 4.5) |
| Batch size | 8 clusters per LLM call |
| Parallel workers | 4 (`ThreadPoolExecutor`) |
| Max tokens | 8192 |
| Sample tracks per cluster | 20 |

Process:
1. Divide all seed clusters into batches of 8
2. Submit up to 4 batches in parallel via `ThreadPoolExecutor(max_workers=4)`
3. For each cluster in a batch, sample up to 20 tracks with: title, artist, year, first 150 chars of comment
4. Include genre/scene context (first 200 chars each) for the LLM
5. LLM returns per cluster:
   - `title`: evocative name (not just "Genre × Scene")
   - `description`: 3-4 sentence scene description
   - `coherence_score`: 1-10
   - `poor_fit_track_ids`: tracks that don't belong
6. **Fallback**: If LLM fails for a batch, use `"{genre_title} × {scene_title}"` as name

**LLM normalisation**: `poor_fit_track_ids` are normalised to plain integers — the LLM sometimes returns dicts like `{"track_id": 123}` instead of `123`.

**Checkpoint**: Saved after completion. Stores `named_clusters` and `all_track_ids`.

---

### Phase 3: Reassignment (25-40%) — Mechanical Model

**Function**: `_deduplicate_and_reassign(named_clusters, df, all_track_ids, client, model_config, delay, progress, should_stop)`
**Input**: Named clusters (with overlapping tracks) + orphan tracks
**Output**: Clusters where every track appears in exactly one cluster

| Setting | Value |
|---------|-------|
| Model | Mechanical (Haiku 3.5) |
| Batch size | 80 tracks per LLM call |
| Max passes | 3 |
| Stability threshold | Stop if < 5% of tracks moved |
| Parallelism | Serial (each batch affects subsequent assignments) |

Steps:

**Step 1 — Greedy deduplication:**
- Sort clusters by `coherence_score` descending
- Walk through all clusters; assign each track to the first (highest-scoring) cluster that contains it
- Rebuild each cluster's `track_ids` to remove duplicates
- Remove any clusters that end up empty

**Step 2 — Identify orphans & poor fits:**
- `orphans`: tracks from `all_track_ids` not in any cluster
- `poor_fits`: tracks flagged by Phase 2's `poor_fit_track_ids`
- Union these into a `to_reassign` set

**Step 3 — LLM multi-pass reassignment:**
- For up to 3 passes:
  - Batch `to_reassign` tracks into groups of 80
  - Build compact cluster summary (id, title, track_count) for context
  - For each track: include title, artist, year, first 100 chars of comment
  - LLM returns `cluster_id` per track (or `"unassigned"`)
  - Move tracks to their assigned clusters
  - Track how many moved; if < 5% moved, stop early (converged)
  - Recalculate orphans for next pass
  - Per-batch progress reported to UI

**Step 4 — Final orphan fallback:**
- Any remaining unassigned tracks are assigned via `scored_search()` — a filter-based scoring function that picks the highest-coherence cluster

**Observed convergence** (6,303 track collection):
- Pass 1: 3,651 tracks → 2,060 moved (56%)
- Pass 2: 328 tracks → 165 moved (50%)
- Pass 3: 107 tracks → 20 moved (19%) — converged
- Final orphan assignment: 74 remaining tracks assigned by scoring
- Result: 298 clusters

**Constraint**: Every track ends up in exactly one cluster. No duplicates, no orphans.

**Checkpoint**: Saved after completion. Stores `clusters` and `all_track_ids`.

---

### Phase 4: Quality Scoring (40-55%) — Mechanical Model

**Function**: `_quality_pass(clusters, df, client, model_config, delay, progress, should_stop)`
**Input**: Deduplicated clusters
**Output**: Refined clusters (some merged, some split)

| Setting | Value |
|---------|-------|
| Scoring model | Mechanical (Haiku 3.5) |
| Rename model | Creative (Sonnet 4.5) — used when merging |
| Split model | Mechanical (Haiku 3.5) |
| Batch size | 15 clusters per scoring call |
| Max iterations | 3 |
| Max merges per iteration | 5 |
| Max splits per iteration | 3 |
| Min cluster size for split | 30 tracks |

Iterative process (up to 3 iterations):

**1. Scoring phase:**
- Batch all clusters into groups of 15
- Send compact summaries (id, title, description truncated to 200 chars, track_count)
- LLM returns: scores (1-10), merge_suggestions, split_suggestions
- Scores are normalised — LLM sometimes returns nested dicts instead of plain integers
- Per-batch progress reported to UI

**2. Quality check:**
- If all scores ≥ 7 AND no merge/split suggestions → stop early

**3. Merge phase (up to 5 per iteration):**
- For each merge suggestion with ≥ 2 valid cluster IDs:
  - Combine all track_ids into the first cluster
  - Deduplicate and re-sort track_ids
  - Re-name the merged cluster using Creative model (sample 20 tracks)
  - Mark source clusters for removal

**4. Split phase (up to 3 per iteration):**
- For each split suggestion (only if cluster > 30 tracks):
  - Build `mini_landscape` from the cluster's tracks
  - Call Mechanical LLM to generate sub-cluster definitions
  - Assign tracks to sub-clusters via `assign_tracks_to_branches(min_score=0.01)`
  - Create new cluster objects with inherited genre/scene context

**Observed results** (6,303 track collection):
- Iteration 1: 5 merged, 3 split → 297 clusters
- Iteration 2: converged → 292 clusters
- Final: 292 clusters

**Checkpoint**: Saved after completion. Stores `clusters` and `all_track_ids`.

---

### Phase 5: Top-Level Grouping (55-65%) — Creative Model

**Function**: `_group_into_categories(clusters, client, model_config, delay, progress, should_stop)`
**Input**: ~292 finalized clusters
**Output**: 8-12 category families

| Setting | Value |
|---------|-------|
| Model | Creative (Sonnet 4.5) |
| LLM calls | 1 (single call with all clusters) |
| Max tokens | 8192 |

Process:
1. Build compact cluster summaries: id, title, description (150 chars max), track_count, genre/scene contexts
2. Single LLM call with all summaries — prompt asks LLM to group "like a world-class record store"
3. LLM returns 8-12 categories, each with: id, title, description, cluster_ids
4. Validation: ensure every cluster assigned to exactly one category
5. Any unassigned clusters added to the largest category

**Fallback**: If LLM fails entirely, creates a single "All Collections" category containing all clusters.

**Known issue**: With 292 clusters, the single-call approach can exceed context limits or produce poor groupings. The first successful build fell back to a single "All Collections" category. This is the primary optimisation target — see Future Optimisation section.

**Checkpoint**: Saved after completion. Stores `clusters`, `categories`, and `all_track_ids`.

---

### Phase 6: Final Descriptions & Exemplars (65-85%) — Creative Model

**Function**: `_finalize_collection_leaves(categories, cluster_map, df, client, model_config, delay, progress, should_stop)`
**Input**: Categories with clusters
**Output**: Rich descriptions + exemplar tracks per leaf

| Setting | Value |
|---------|-------|
| Model | Creative (Sonnet 4.5) |
| Batch size | 5 clusters per LLM call |
| Parallel workers | 4 (`ThreadPoolExecutor`) |

Process:
1. Flatten all clusters from all categories into a single list
2. Batch into groups of 5 clusters
3. For each cluster in a batch:
   - Filter valid track IDs against DataFrame index
   - Run `scored_search()` with cluster filters to get top 50 candidates
   - Build candidate list (up to 30 tracks) with title, artist, year
   - Build 7-track fallback shortlist
4. Submit batch to LLM — asks for rich description (4-6 sentences) + 7 exemplar picks
5. LLM returns per cluster: title, description, examples array
6. Fallback to shortlist if LLM fails
7. Up to 4 batches processed in parallel

**Checkpoint**: Saved after completion.

---

### Phase 7: Metadata Enrichment (85-98%) — Creative Model

**Function**: `_enrich_metadata(categories, cluster_map, df, client, model_config, delay, progress, should_stop)`
**Input**: Finalized leaves with tracks
**Output**: Per-track metadata improvement suggestions

| Setting | Value |
|---------|-------|
| Model | Creative (Sonnet 4.5) |
| Parallel workers | 4 (`ThreadPoolExecutor`) |
| Max tokens | 8192 |
| Granularity | 1 LLM call per cluster (not batched) |
| Confidence filter | Only suggestions ≥ 0.7 kept |

Process:
1. Flatten all clusters from all categories
2. For each cluster, submit to thread pool:
   - Build track list (up to 30 tracks, comments truncated to 200 chars)
   - Send cluster title, description, and track list to LLM
   - LLM analyses tracks in context and suggests improvements:
     - **Genre refinement**: More specific sub-genre (e.g., "House" → "Acid House")
     - **Scene tags**: Cultural/geographic/temporal context to add
     - **Descriptors**: Production or sonic descriptors to add
     - **Era refinement**: More precise era information
   - Filter to confidence ≥ 0.7
   - Store as `metadata_suggestions` array on the cluster
3. Up to 4 clusters processed in parallel
4. Per-cluster progress reported to UI

Suggestions are stored on each leaf node — **NOT auto-applied**. They are available for user review.

**Observed output**: 4,541 suggestions across 292 clusters.

**Checkpoint**: Not saved (final phase — next step is assembly).

**Skipped in test mode.**

---

## Checkpointing & Resume

The pipeline saves intermediate state to `output/collection_checkpoint.json` after each major phase, enabling resume after crashes.

### Checkpoint File Format
```json
{
  "phase_completed": 3,
  "clusters": [...],
  "all_track_ids": [...]
}
```

### What's Saved When

| After Phase | Data Saved |
|-------------|-----------|
| Phase 2 | `named_clusters`, `all_track_ids` |
| Phase 3 | `clusters`, `all_track_ids` |
| Phase 4 | `clusters`, `all_track_ids` |
| Phase 5 | `clusters`, `categories`, `all_track_ids` |
| Phase 6 | `clusters`, `categories`, `all_track_ids` |

Phase 1 is not checkpointed (runs in seconds). Phase 7 is not checkpointed (final phase).

### Resume Behaviour
- On build start, `_load_checkpoint()` checks for existing checkpoint
- Each phase is guarded by `if checkpoint_phase < N` — completed phases are skipped
- Skipped phases log a message and advance the progress bar
- Checkpoint is cleared on successful completion
- Checkpoint is cleared when the collection tree is deleted (DELETE endpoint)
- Test mode (`?test=1`) ignores checkpoints

### Frontend Resume UI
- GET `/api/collection-tree` returns `has_checkpoint: true` and `checkpoint_phase: N` when no tree exists but a checkpoint is present
- A "Resume (from Phase Name)" button appears in the UI
- Clicking Resume triggers the same build endpoint — the backend handles the skip logic

---

## Test Mode

Triggered by `POST /api/collection-tree/build?test=1` or the "Test Run (20 clusters)" button.

Behaviour:
- Caps seed clusters to 20 (from the top of the sorted list)
- Limits `all_track_ids` to only those appearing in the 20 seeds
- Skips Phase 7 (enrichment)
- Skips checkpointing
- Runs end-to-end for validation

---

## Parallelism Strategy

| Phase | Parallelism | Workers | Why |
|-------|-------------|---------|-----|
| 1 (Intersection) | N/A | — | Pure Python, no LLM |
| 2 (Naming) | Parallel batches | 4 | Independent batches, no cross-dependencies |
| 3 (Reassignment) | **Serial** | 1 | Each batch affects subsequent assignments — inherently sequential |
| 4 (Quality) | Serial | 1 | Merge/split decisions depend on full scoring results |
| 5 (Grouping) | N/A | — | Single LLM call |
| 6 (Descriptions) | Parallel batches | 4 | Independent per-cluster, no cross-dependencies |
| 7 (Enrichment) | Parallel per-cluster | 4 | Independent per-cluster |

The `delay` between LLM calls is set to `0` for collection builds (configured in the route handler). Rate limiting is handled by the API itself.

---

## Data Structures

### Collection Tree JSON

```json
{
  "id": "uuid",
  "tree_type": "collection",
  "created_at": "ISO timestamp",
  "total_tracks": 6303,
  "assigned_tracks": 6260,
  "ungrouped_track_ids": [43 track IDs],
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
          "track_ids": [5-153 track IDs],
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

### Observed Output Stats (6,303 track collection)

| Metric | Value |
|--------|-------|
| Total categories | 1 (grouping fell back — see known issues) |
| Total leaves | 292 |
| Tracks assigned | 6,260 (99.3%) |
| Ungrouped tracks | 43 (0.7%) |
| Leaf size range | 5-153 tracks |
| Leaf median size | 13 tracks |
| Leaf mean size | 21.4 tracks |
| Metadata suggestions | 4,541 |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collection-tree` | Load tree, or checkpoint status if no tree |
| POST | `/api/collection-tree/build` | Start build (supports `?test=1`) |
| GET | `/api/collection-tree/progress` | SSE progress stream |
| POST | `/api/collection-tree/stop` | Stop build gracefully |
| GET | `/api/collection-tree/ungrouped` | Get ungrouped track IDs |
| POST | `/api/collection-tree/create-playlist` | Create workshop playlist from leaf |
| POST | `/api/collection-tree/create-all-playlists` | Batch create all leaf playlists |
| GET | `/api/collection-tree/node/<id>/export/m3u` | Export node tracks as M3U8 |
| DELETE | `/api/collection-tree` | Delete tree + clear checkpoint |

### SSE Progress Events

The progress stream (`/progress`) emits JSON events:
- `{"event": "progress", "phase": "cluster_naming", "detail": "...", "percent": 15}`
- `{"event": "done"}`
- `{"event": "error", "detail": "error message"}`
- `{"event": "stopped"}`

---

## Frontend

### Progress UI Components

The collection build has a richer progress UI than Genre/Scene builds:

1. **Phase timeline**: 7 numbered circles showing done/active/pending states with pulse animation
2. **Narrative panel**: Explains what each phase does and why, with fade transitions between phases
3. **Activity log**: Scrollable, timestamped feed of per-batch progress (last 50 entries)
4. **Inline error display**: Errors shown in-context instead of alert() popups

### Collection Tree Display

Unlike Genre and Scene trees which use a nested collapsible tree layout, the Collection Tree uses a **category sidebar + flat card grid**:

- **Left sidebar**: Category buttons (always visible, sticky)
- **Main area**: Leaf cards in a responsive CSS grid (`repeat(auto-fill, minmax(320px, 1fr))`)
- Each card shows: title, track count, genre/scene context tags, description, exemplar tracks, action buttons, metadata suggestion badge

---

## Error Handling & Robustness

### LLM Response Normalisation
The LLM doesn't always return clean structured data. Known issues and fixes:

| Problem | Where | Fix |
|---------|-------|-----|
| `poor_fit_track_ids` as dicts | Phase 2 | Normalise: `p["track_id"] if isinstance(p, dict) else p` |
| Scores as nested dicts | Phase 4 | Extract int from dict, fallback to 5 |
| Category grouping failure | Phase 5 | Fallback to single "All Collections" category |
| Description/exemplar failure | Phase 6 | Fallback to `scored_search()` shortlist |

### Graceful Stop
- `stop_flag` (threading.Event) checked between every phase and within batch loops
- On stop: returns partial tree with `status: "stopped"`
- Checkpoint is preserved, so Resume is available

### Process Crashes
- Flask `debug=True` auto-reloader kills the build thread if any Python file is edited during the build
- The checkpoint system was built specifically to handle OOM crashes and process deaths during Phase 3 (the longest serial phase)
- Background thread runs independently of browser connection — navigating away doesn't stop the build

---

## File Locations

| File | Purpose |
|------|---------|
| `app/tree.py` | Pipeline implementation (all 7 phases, orchestrator, prompts) |
| `app/routes.py` | API endpoints, background thread management, SSE |
| `app/static/tree.js` | Frontend: tree type switching, progress UI, collection view |
| `app/static/style.css` | Collection layout styles (sidebar, cards, phases, narrative) |
| `app/templates/index.html` | HTML structure for tree tab |
| `output/curated_collection.json` | Persisted collection tree |
| `output/collection_checkpoint.json` | Intermediate checkpoint (deleted on completion) |

---

## Known Issues & Optimisation Targets

### Phase 5 Grouping Failure
The single-call approach to group 292 clusters into 8-12 categories failed on the first full build, falling back to "All Collections". This is likely because:
- 292 cluster summaries exceed the effective context window for good grouping
- The prompt may need to be chunked or use a hierarchical approach
- **Fix options**: Pre-group by genre_context similarity before calling LLM, use multiple calls, or increase max_tokens

### Phase 3 Performance
Reassignment is the slowest phase because it's inherently serial — each batch's assignments affect the next batch. With 3,651 tracks at 80/batch, that's 46 sequential LLM calls (~55s each = ~42 minutes for Pass 1 alone).
- **Fix options**: Larger batches (160?), reduce to 2 passes max, pre-filter obvious assignments with `scored_search()` before calling LLM

### Phase 7 Cost
Enrichment makes one LLM call per cluster (292 calls with Creative model). This is the most expensive phase in token usage.
- **Fix options**: Batch multiple clusters per call, use Mechanical model for initial suggestions and Creative only for low-confidence ones, skip clusters with high coherence scores

### General Optimisation Paths
1. **Intersection threshold tuning**: The `min_tracks=5` threshold could be adjusted based on collection size — higher threshold = fewer seeds = faster pipeline but potentially less coverage
2. **Incremental updates**: When new tracks are added, only recompute affected intersections rather than rebuilding everything
3. **Quality scoring refinement**: Use track-level features (BPM, key, energy) in addition to comment-based facets
4. **Auto-apply metadata**: Build a UI to review and apply metadata suggestions from Phase 7
5. **Cross-collection learning**: Use enrichment suggestions to improve future Genre/Scene tree builds
6. **Checkpoint granularity**: Save mid-phase checkpoints (e.g., per-batch in Phase 3) to avoid repeating long phases
7. **Phase 3 parallelism**: Split tracks into independent groups (by genre?) that can be reassigned in parallel without cross-contamination
