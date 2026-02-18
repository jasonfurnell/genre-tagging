# Music Collection Tree - Implementation Plan

> An interactive map of musical history and influence, built from the user's own collection.

## Overview

A new **Collection Tree** tab that analyses the user's uploaded tracks and builds a hierarchical tree of musical lineages, branches, and leaf-node playlists. The tree reveals the distinct evolutionary paths in music history represented by the user's collection, creates exportable playlists at each leaf, and highlights ungrouped tracks that don't fit neatly anywhere.

---

## 1. Data Model

### Tree Structure (persisted to `output/collection_tree.json`)

```json
{
  "id": "tree-8char-uuid",
  "created_at": "2026-02-08T...",
  "total_tracks": 2500,
  "assigned_tracks": 2340,
  "ungrouped_track_ids": [12, 45, 789, ...],
  "lineages": [
    {
      "id": "hiphop",
      "title": "Hip-Hop Lineage",
      "subtitle": "~850 tracks spanning four decades",
      "description": "From the Bronx block parties to global streaming dominance...",
      "track_ids": [1, 5, 23, ...],
      "track_count": 850,
      "children": [
        {
          "id": "golden-age-hiphop",
          "title": "Golden Age Hip-Hop (1986-1996)",
          "description": "The creative zenith of hip-hop...",
          "filters": {
            "genres": ["Hip-Hop", "Boom Bap"],
            "era": ["late 80s", "early 90s"],
            "location": ["New York", "Los Angeles"],
            "mood": [],
            "descriptors": ["sample-based", "lyrical"]
          },
          "track_ids": [1, 5, 23, ...],
          "track_count": 150,
          "is_leaf": false,
          "children": [
            {
              "id": "east-coast-boom-bap",
              "title": "East Coast Boom-Bap: The DJ Premier Era",
              "description": "Hard-hitting drums, dusty soul samples...",
              "filters": { ... },
              "track_ids": [1, 5, 23],
              "track_count": 35,
              "is_leaf": true,
              "examples": [
                {"title": "Mass Appeal", "artist": "Gang Starr", "year": 1994},
                {"title": "NY State of Mind", "artist": "Nas", "year": 1994},
                {"title": "C.R.E.A.M.", "artist": "Wu-Tang Clan", "year": 1993}
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Key properties:
- **Lineage**: Top-level music family tree (e.g. Hip-Hop, House, Reggae/Dub, Soul/R&B)
- **Branch**: Subdivision within a lineage (Primary, Secondary, or Tertiary)
- **Leaf Node**: Final grouping (ideally 20-50 tracks). Has `is_leaf: true`, `examples`, and a rich description paragraph
- **`filters`**: Same format as existing Workshop playlist filters - enables reuse of `scored_search()`
- **`track_ids`**: Actual track IDs assigned to this node (leaf nodes only for playlist creation; parent nodes store the union of their children's IDs)
- **`ungrouped_track_ids`**: Tracks not assigned to any leaf node

---

## 2. Backend Architecture

### 2.1 New File: `app/tree.py`

The tree-building pipeline. Core functions:

#### `build_collection_tree(df, config, progress_callback)`

Orchestrator that runs the full pipeline. Calls `progress_callback(phase, detail, pct)` at each step for SSE streaming.

**Pipeline Steps:**

```
Phase 1: Analyse Lineages
  - Build landscape summary (reuse existing build_genre_landscape_summary)
  - LLM call: identify 4-8 Major Lineages from collection
  - Output: lineage definitions with titles, descriptions, and broad filters

Phase 2: Assign Tracks to Lineages
  - For each lineage: run scored_search with its filters
  - Greedy assignment: each track → highest-scoring lineage
  - Record ungrouped tracks (no lineage scored above threshold)

Phase 3: Build Primary Branches (per lineage)
  - For each lineage with its assigned tracks:
    - Build a mini-landscape summary of just those tracks
    - LLM call: subdivide into Primary Branches by era/geography/style/movement
    - Output: branch definitions with filters
  - Assign tracks within each lineage to their best-matching branch

Phase 4: Build Secondary Branches (when Primary has >50 tracks)
  - For each primary branch with >50 tracks:
    - LLM call: further subdivide
    - Assign tracks within branch to sub-branches

Phase 5: Build Tertiary Branches (when Secondary has >50 tracks)
  - Same pattern, one more level deep

Phase 6: Finalize Leaf Nodes
  - For each leaf node (no children, or ≤50 tracks):
    - LLM call (batched, ~5 leaves per call): generate rich titles,
      evocative descriptions, and pick 3 representative example tracks
    - This is where the "DJ curator voice" comes through

Phase 7: Collect Ungrouped
  - Gather all tracks not in any leaf node
  - Add to ungrouped_track_ids
```

#### Track Assignment Strategy

Reuses the existing `scored_search()` from `parser.py`:

1. For each branch at a given level, run `scored_search(df_subset, filters)` against only the tracks assigned to the parent
2. Each track is assigned to the branch where it scores highest
3. Tracks scoring below `min_score=0.1` for all branches remain at the parent level (or become ungrouped at the lineage level)
4. This ensures no track appears in multiple leaf nodes

#### LLM Prompt Design

Each LLM call follows the existing pattern from `playlist.py`:
- **System prompt**: "You are a music historian, DJ, and cultural curator..." (reuse existing DJ persona with additions for music history knowledge)
- **User prompt**: Contains the landscape/track summary for the relevant scope + structured instructions
- **Response format**: JSON array, parsed with existing retry/fallback logic

**Lineage identification prompt** (Phase 1):
```
Given this music collection of {total} tracks:

{landscape_summary}

Identify the Major Lineages - the top-level music family trees representing
distinct evolutionary paths in music history. These should be the big organizing
categories (e.g., "Hip-Hop Lineage", "House Music Evolution", "Soul/R&B Heritage").

Consider: What are the 4-8 fundamental musical traditions represented in this
collection? Each lineage should encompass a meaningful portion of the collection.

Return JSON: [{
  "id": "kebab-case-id",
  "title": "Lineage Title",
  "subtitle": "~N tracks spanning X decades",
  "description": "2-3 sentence overview of this lineage...",
  "filters": { "genres": [...], "era": [...], "location": [...], ... }
}]
```

**Branch subdivision prompt** (Phases 3-5):
```
Within the "{lineage_title}" lineage, you have {track_count} tracks:

{mini_landscape_summary}

Top genres: {genre_distribution}
Era spread: {era_distribution}
Key locations: {location_distribution}

Subdivide into {target_count} branches organized by era, geography, style,
or movement - whichever best captures the natural groupings.

For each branch, provide evocative titles and descriptions in the style of a
knowledgeable DJ curator. Think: "Golden Era NYC: Boom Bap to New Jack" not
just "1990s Hip-Hop".

Return JSON: [{
  "id": "kebab-case-id",
  "title": "Evocative Branch Title",
  "description": "Rich 2-3 sentence description...",
  "filters": { "genres": [...], "era": [...], ... }
}]
```

**Leaf node finalization prompt** (Phase 6):
```
Finalize these leaf-node playlists with rich, evocative descriptions.
For each, write a compelling paragraph that a music enthusiast would love to read.
Think record-store-clerk-who-knows-everything energy.

Also select 3 representative example tracks from each node's track list.

Nodes to finalize:
{nodes_with_track_lists}

Return JSON: [{
  "id": "node-id",
  "title": "Refined Evocative Title (keep or improve)",
  "description": "Paragraph description - evocative, knowledgeable, specific...",
  "examples": [{"title": "...", "artist": "...", "year": ...}, ...]
}]
```

#### Helper Functions

- `build_mini_landscape(df_subset)` - Like `build_genre_landscape_summary` but for a subset of tracks. Provides context for subdivision LLM calls
- `assign_tracks_to_branches(df_parent, branches)` - Runs scored_search per branch, does greedy assignment
- `should_subdivide(node)` - Returns true if `track_count > 50`
- `persist_tree(tree)` / `load_tree()` - Save/load to `output/collection_tree.json`

### 2.2 New Routes in `app/routes.py`

```python
# --- Collection Tree endpoints ---

GET  /api/tree
  # Returns the current tree (from file or _state cache), or null if none built

POST /api/tree/build
  # Starts background tree-building thread
  # Returns 202 Accepted with job_id
  # Sets _state["tree_thread"], _state["tree_stop_flag"]

GET  /api/tree/progress
  # SSE endpoint streaming build progress
  # Events: {phase, detail, percent, node_id?}
  # Phases: "analyzing", "lineages", "primary_branches", "secondary_branches",
  #         "tertiary_branches", "finalizing_leaves", "complete", "error"

POST /api/tree/stop
  # Gracefully stops tree building (like tag/stop)

GET  /api/tree/ungrouped
  # Returns the ungrouped tracks as a list

POST /api/tree/create-playlist
  # Creates a Workshop playlist from a tree leaf node
  # Body: { node_id: "east-coast-boom-bap" }
  # Finds the leaf, creates playlist with its track_ids, name, description
  # Returns the new playlist object (appears in Workshop sidebar)

POST /api/tree/create-all-playlists
  # Creates Workshop playlists for ALL leaf nodes at once
  # Returns array of created playlist objects

DELETE /api/tree
  # Deletes the current tree (allows rebuilding)
```

### 2.3 State Management

Added to `_state` dict:
```python
_state["tree"] = None              # Current tree dict (or loaded from file)
_state["tree_thread"] = None       # Background build thread
_state["tree_stop_flag"] = False   # Graceful stop
_state["tree_progress"] = []       # Queue list for SSE listeners
```

---

## 3. Frontend Architecture

### 3.1 New File: `app/static/tree.js`

Vanilla JS, following the patterns in `workshop.js`.

#### State
```javascript
let treeData = null;           // The full tree object
let expandedNodes = new Set();  // Which nodes are expanded in the UI
let treeBuilding = false;       // Whether build is in progress
let treeBuildPhase = null;      // Current build phase for progress display
```

#### Key Functions

**Tree Building UI:**
- `initTree()` - Called on tab switch. Loads existing tree or shows "Build" button
- `startBuild()` - POST to `/api/tree/build`, connect to SSE progress
- `handleBuildProgress(event)` - Update progress bar, show current phase. When complete, load and render tree
- `stopBuild()` - POST to `/api/tree/stop`

**Tree Rendering:**
- `renderTree(tree)` - Renders the full tree into the tab content area
- `renderHeader(tree)` - Stats bar: total tracks, assigned tracks, ungrouped count, lineage count, leaf count
- `renderLineage(lineage)` - Renders a lineage card (like the reference HTML's `tree-container`)
- `renderNode(node, depth)` - Recursive node renderer. Click to expand/collapse
  - Branch nodes: show title, track count, expand arrow
  - Leaf nodes: show title, track count, description, 3 examples, "Create Playlist" button
- `renderUngrouped(trackIds)` - Section at the bottom showing ungrouped tracks

**Interactions:**
- `toggleNode(nodeId)` - Expand/collapse a branch
- `createPlaylistFromLeaf(nodeId)` - POST to `/api/tree/create-playlist`, show success toast, update button to "View in Workshop"
- `createAllPlaylists()` - POST to `/api/tree/create-all-playlists`, batch create
- `deleteTree()` - DELETE `/api/tree` with confirmation, return to "Build" state
- `viewUngrouped()` - Expand ungrouped section showing track list

### 3.2 HTML Changes (`app/templates/index.html`)

Add third tab:
```html
<button class="tab-btn" data-tab="tree">Collection Tree</button>
```

Add tab panel:
```html
<div id="tree-tab" class="tab-panel" style="display:none">
  <!-- Build state: shown when no tree exists -->
  <div id="tree-build-section">
    <div class="tree-intro">
      <h2>Music Collection Tree</h2>
      <p>Build an interactive map of the musical history and influence
         represented in your collection.</p>
      <button id="tree-build-btn" class="btn btn-primary btn-lg">
        Build Collection Tree
      </button>
    </div>
    <!-- Progress: shown during build -->
    <div id="tree-progress" style="display:none">
      <div class="progress-bar">...</div>
      <div class="progress-phase">Analyzing collection...</div>
      <button id="tree-stop-btn" class="btn btn-danger">Stop</button>
    </div>
  </div>

  <!-- Tree view: shown when tree exists -->
  <div id="tree-view-section" style="display:none">
    <div id="tree-header"><!-- stats --></div>
    <div class="tree-toolbar">
      <button id="tree-create-all-btn">Create All Playlists</button>
      <button id="tree-rebuild-btn">Rebuild Tree</button>
    </div>
    <div id="tree-grid" class="trees-grid"><!-- lineage cards --></div>
    <div id="tree-ungrouped"><!-- ungrouped tracks section --></div>
  </div>
</div>
```

### 3.3 CSS Changes (`app/static/style.css`)

New styles for the tree tab, drawing from the reference HTML's dark-theme aesthetic:
- `.trees-grid` - CSS grid layout for lineage cards (auto-fit, minmax 500px)
- `.tree-container` - Glass-morphism card with backdrop blur
- `.node-button` - Expandable node with hover effects and indent levels
- `.node-content` - Expanded content area with left border accent
- `.leaf-node` - Leaf-specific styling with description, examples, and action button
- `.example-track` - Track display with artist/title/year
- `.ungrouped-section` - Distinct styling for the ungrouped tracks area
- `.tree-progress` - Build progress indicator with phase labels
- `.tree-stats` - Header stats bar (matches existing workshop aesthetic)

---

## 4. Build Pipeline Detail

### Phase-by-Phase Breakdown

| Phase | LLM Calls | Input | Output | Progress % |
|-------|-----------|-------|--------|------------|
| 1. Analyze Lineages | 1 | Full landscape summary | 4-8 lineage definitions | 0-10% |
| 2. Assign to Lineages | 0 | scored_search per lineage | Track assignments | 10-15% |
| 3. Primary Branches | N (1 per lineage) | Mini-landscape per lineage | Branch definitions | 15-45% |
| 4. Secondary Branches | M (1 per large primary) | Mini-landscape per branch | Sub-branch definitions | 45-65% |
| 5. Tertiary Branches | K (1 per large secondary) | Mini-landscape per branch | Sub-branch definitions | 65-80% |
| 6. Finalize Leaves | ~L/5 (batched) | Leaf track lists | Titles, descriptions, examples | 80-95% |
| 7. Collect Ungrouped | 0 | Set difference | Ungrouped track list | 95-100% |

### Estimated LLM Calls

For a **2,500 track collection** with ~6 lineages:
- Phase 1: 1 call
- Phase 3: ~6 calls (one per lineage)
- Phase 4: ~8-12 calls (large primary branches)
- Phase 5: ~3-5 calls (large secondary branches)
- Phase 6: ~6-10 calls (batching ~5 leaves per call)
- **Total: ~25-35 LLM calls, estimated 2-4 minutes**

### Graceful Stop

At any phase, check `_state["tree_stop_flag"]`:
- If stopped during branch generation: save the tree as-is with whatever branches are complete
- Mark incomplete nodes with `"status": "incomplete"`
- User can view partial results and choose to continue or rebuild

### Error Handling

- If an LLM call fails (after retries): mark that subtree as `"status": "error"`, continue with remaining branches
- If the whole build fails: save partial tree, report error via SSE
- Use the existing `@retry` decorator pattern from `playlist.py`

---

## 5. Ungrouped Tracks

### Purpose
Tracks that don't fit neatly into any leaf node. These are valuable because they:
1. Reveal niche areas in the collection
2. Suggest potential new playlists or tree branches
3. Help the user understand the edges of their taste

### UI Treatment
- Shown as a collapsible section below the tree grid
- Header: "Ungrouped Tracks ({count})" with a distinct visual treatment
- Expandable track list showing title, artist, BPM, key, year, comment
- Sortable columns
- "Search in Workshop" button to take these tracks to the Workshop for manual curation
- Track count badge in the header stats bar

### When Tracks Become Ungrouped
- Scored below `min_score` threshold for all lineages (Phase 2)
- Scored below threshold for all branches within their lineage (Phase 3-5)
- Tracks with missing/empty genre comments are automatically ungrouped

---

## 6. Integration with Existing Workshop

### Playlist Creation from Tree
When the user clicks "Create Playlist" on a leaf node:
1. Backend creates a playlist with the leaf's `track_ids`, `name`, and `description`
2. Playlist `source` is set to `"tree"` (to distinguish from `"llm"` and `"manual"`)
3. The playlist appears in the Workshop sidebar immediately
4. The leaf node button updates to "View in Workshop" (links to that playlist)

### "Create All Playlists"
- Creates a Workshop playlist for every leaf node in one batch
- Shows a confirmation first: "This will create {N} playlists with {M} total tracks"
- Progress indicator during batch creation

### Cross-Tab Navigation
- From Tree: "View in Workshop" on a leaf → switches to Workshop tab, selects that playlist
- From Workshop: Playlists created from tree show a "From: Collection Tree" badge

---

## 7. File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `app/tree.py` | Tree building pipeline, LLM calls, persistence (~400-500 lines) |
| `app/static/tree.js` | Tree tab frontend (~500-600 lines) |

### Modified Files
| File | Changes |
|------|---------|
| `app/routes.py` | Add tree endpoints (~80-100 lines) |
| `app/templates/index.html` | Add third tab + tree tab panel |
| `app/static/style.css` | Tree-specific styles (~150 lines) |
| `app/static/app.js` | Tab switching logic for third tab |

### Data Files
| File | Purpose |
|------|---------|
| `output/collection_tree.json` | Persisted tree structure |

---

## 8. Implementation Order

### Phase A: Backend Pipeline (tree.py)
1. Tree data model and persistence (save/load JSON)
2. `build_mini_landscape()` helper for track subsets
3. Phase 1: Lineage identification LLM call
4. Phase 2: Track-to-lineage assignment using scored_search
5. Phase 3-5: Recursive branch subdivision with >50 threshold
6. Phase 6: Leaf node finalization (batched LLM calls)
7. Phase 7: Ungrouped collection
8. `build_collection_tree()` orchestrator with progress callbacks

### Phase B: Routes & SSE
1. Tree endpoints in routes.py
2. Background thread management (start/stop/progress)
3. SSE progress streaming
4. Playlist creation from tree nodes

### Phase C: Frontend
1. Tab structure and switching
2. Build UI with progress indicator
3. Tree rendering (recursive node expansion)
4. Leaf node detail view with examples
5. "Create Playlist" / "Create All" functionality
6. Ungrouped tracks section
7. Cross-tab navigation

### Phase D: Polish
1. CSS styling matching reference aesthetic
2. Edge cases (empty collection, very small collections, rebuild)
3. Graceful stop and partial tree display
4. Testing with real collection data

---

## 9. Open Design Considerations

### Small Collections (<100 tracks)
- Skip the full pipeline; perhaps just 2-3 lineages with primary branches only
- Leaf node target could be smaller (10-20 tracks)
- Could show a message: "Your collection is small enough that the Workshop's Explore mode may be more useful"

### Very Large Collections (5000+ tracks)
- The >50 threshold might create very deep trees
- Consider a max depth of 4 levels (Lineage → Primary → Secondary → Tertiary)
- At tertiary level, even if >50 tracks, stop subdividing and create larger leaves

### Rebuild vs. Incremental
- For v1: rebuild from scratch each time (DELETE + POST /build)
- Future: could detect new tracks and incrementally assign them to existing branches

### Leaf Node Size Flexibility
- Target 20-50 tracks, but allow smaller leaves (down to ~5) for niche groups
- These small niche leaves are actually valuable - they represent the user's eclectic taste edges
- Don't force-merge small groups just to hit a minimum

### Rate Limiting
- Use the existing `delay_between_requests` config between LLM calls
- For the batched leaf finalization, respect the same delay
- Show estimated time remaining based on number of remaining LLM calls
