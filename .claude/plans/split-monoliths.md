# Plan: Split the Monoliths — SUPERSEDED
> Source: `docs/architecture-review.md` — Phase 2
> Priority: ~~Medium~~ Closed
> **Beads Epic**: `GenreTagging-8d6` (P2) — **CLOSED**
> **Superseded by**: Backend Modernization (`GenreTagging-94r`) — Flask blueprints replaced by FastAPI routers
> **Note**: Frontend tasks (.3 JS split, .4 CSS split) closed — superseded by Frontend Modernization epic `GenreTagging-x8f`

## Backend — Split `routes.py` (3,567 lines, 99 routes) into Domain Blueprints

Current `routes.py` contains every feature domain. Split into:

```
app/
├── routes/
│   ├── __init__.py          — Register all blueprints
│   ├── upload.py            — Upload, restore (2 routes)
│   ├── tagging.py           — Tagging start/stop/progress (8 routes)
│   ├── workshop.py          — Playlist workshop (19 routes)
│   ├── trees.py             — All tree building (21 routes)
│   ├── artwork.py           — Artwork & preview serving (13 routes)
│   ├── sets.py              — Set workshop + saved sets (17 routes)
│   ├── config_routes.py     — Config + phase profiles (9 routes)
│   └── dropbox.py           — Dropbox auth (3 routes)
├── state.py                 — _state dict + thread-safe accessors
├── llm.py                   — Shared LLMClient (see shared-abstractions.md)
└── background.py            — BackgroundTaskRunner (see shared-abstractions.md)
```

### Migration Strategy
1. Create `app/state.py` first — move `_state` dict and helper functions (`_safe_val`, `_broadcast`, etc.)
2. Split routes one domain at a time, starting with the most isolated (dropbox, config)
3. Each blueprint imports from `state.py` instead of module-level globals
4. Move inline business logic from route handlers into service modules (`tree.py`, `playlist.py`, `setbuilder.py`)
5. Keep route function names stable so git blame remains useful

## Frontend — Split Large JS Files

```
app/static/
├── app.js                   — Core: grid, upload, tab switching (keep)
├── artwork.js               — (extract) Artwork caching, warm-cache, IntersectionObserver
├── audio.js                 — (extract) Preview player, play-all state machine
├── workshop.js              — Playlists, intersections, suggestions (keep, reduced)
├── search.js                — (extract) Track search + render (deduplicated)
├── tree.js                  — Tree rendering (keep)
├── setbuilder.js            — Set workshop core (keep, reduced)
├── setbuilder-render.js     — (extract) BPM grid, key row, energy wave rendering
├── setbuilder-audio.js      — (extract) Play-set, preview-all
├── phases.js                — Phase profiles (keep, already clean)
├── constants.js             — (new) All magic numbers, timeouts, batch sizes
└── helpers.js               — (new) escapeHtml, debounce, shared utilities
```

## CSS — Split by Feature

```
app/static/
├── style.css                — Base: reset, layout, variables, buttons, modals
├── workshop.css             — Playlist workshop styles
├── tree.css                 — Tree visualisation styles
├── set-workshop.css         — Set builder styles
└── components.css           — Shared components (cards, badges, popovers)
```

## What NOT to Change
- No framework migration (vanilla JS is fine)
- No TypeScript
- No bundler (HTTP/2 handles separate scripts fine)
- No database (file-based persistence is appropriate for single-user)
