# Plan: Backend Modernization — uv + FastAPI
> Priority: High
> **Beads Epic**: `GenreTagging-94r` (P1)
>
> **Supersedes**:
> - `security-and-correctness.md` (`GenreTagging-1p9`) — security concerns addressed natively by FastAPI/Pydantic/asyncio
> - `split-monoliths.md` (`GenreTagging-8d6`) — Flask blueprints → FastAPI routers
> - `shared-abstractions.md` (`GenreTagging-n0e`) — abstractions built async-native within this migration
>
> **Updates**:
> - `aws-deployment.md` (`GenreTagging-qpw`) — uvicorn replaces gunicorn, uv replaces pip
> - `frontend-modernization.md` (`GenreTagging-x8f`) — Vite proxy targets FastAPI, "Buntralino" question resolved (no Flask to bundle)

## Why

Flask served well as a prototype framework, but the project has outgrown it:
- **Thread safety**: 11 daemon threads, 0 joined, no locking on shared state — race conditions are a known P1 issue
- **Serialization bugs**: numpy int64 / float64 → JSON failures, patched ad-hoc with `_safe_val()`
- **No validation**: raw `request.json` everywhere, no schema enforcement
- **Code duplication**: LLM provider routing, background task patterns, JSON persistence duplicated across modules
- ~~**Deployment friction**: pip + requirements.txt, no lockfile, no reproducible builds~~ (resolved — uv + pyproject.toml + uv.lock)

## Target Stack

| Layer | Current | New |
|-------|---------|-----|
| Package manager | pip + requirements.txt | **uv** + pyproject.toml + uv.lock |
| Virtual env | manual venv | **uv venv** (managed) |
| Web framework | Flask | **FastAPI** |
| ASGI server | Flask dev server / Gunicorn | **uvicorn** |
| Validation | None | **Pydantic v2** |
| Async | threading.Thread | **asyncio** tasks |
| SSE | Custom generator + Flask Response | **sse-starlette** (or StreamingResponse) |
| Static files | Flask send_from_directory | **Starlette StaticFiles** |

## Project Structure (Target)

```
app/
├── main.py                 — FastAPI app creation, lifespan, mount static
├── config.py               — Settings via pydantic-settings (env + config.json)
├── state.py                — AppState class, DI via Depends()
├── llm.py                  — Async LLMClient (OpenAI + Anthropic, retry, JSON mode)
├── tasks.py                — BackgroundTaskManager (asyncio-based, clean shutdown)
├── persistence.py          — Async JsonStore (aiofiles)
├── models/
│   ├── track.py            — TrackRow, TrackList Pydantic models
│   ├── config.py           — ConfigResponse, TaggingConfig models
│   ├── tree.py             — TreeNode, Lineage, Category models
│   ├── workshop.py         — SetSlot, EnergyWave, SetPreset models
│   └── common.py           — Shared response models (ProgressEvent, ErrorResponse)
├── routers/
│   ├── __init__.py         — Register all routers
│   ├── upload.py           — Upload, restore (2 routes)
│   ├── tagging.py          — Tagging start/stop/progress SSE (8 routes)
│   ├── artwork.py          — Artwork serving + cache (13 routes)
│   ├── trees.py            — Genre/scene/collection tree building (21 routes)
│   ├── sets.py             — Set workshop + saved sets (17 routes)
│   ├── playlists.py        — Playlists + intersections (19 routes)
│   ├── config_routes.py    — Config + phase profiles (9 routes)
│   ├── phases.py           — Phase management routes
│   └── dropbox.py          — Dropbox auth (3 routes)
├── services/               — Business logic (existing: tagger.py, tree.py, etc.)
│   ├── tagger.py
│   ├── tree.py
│   ├── setbuilder.py
│   ├── playlist.py
│   ├── parser.py
│   └── phases.py
├── static/                 — Frontend files (unchanged until React migration)
└── templates/              — Jinja2 templates (if any, likely removed)
```

---

## Phase 0: Package Management — COMPLETE

### Task 1: Initialize uv + pyproject.toml (`GenreTagging-9d7`) — DONE

- [x] Install uv via **Homebrew** (`brew install uv`) — note: the `curl` installer produces unsigned binaries that macOS Gatekeeper kills
- [x] Create `pyproject.toml` with project metadata and 7 dependencies (migrated from requirements.txt)
- [x] Run `uv venv --python 3.13` to create managed `.venv/`
- [x] Run `uv sync` to install all 37 packages
- [x] `uv.lock` generated (reproducible builds)
- [x] `.venv/` added to `.gitignore`
- [x] CLAUDE.md updated with `uv run python app/main.py` and package management docs
- [x] App verified running at localhost:5001 via `uv run`

**Completed**: App runs identically via `uv run python app/main.py`, lockfile committed.

---

## Phase 1: FastAPI Scaffold + Coexistence (depends on Phase 0)

### Task 2: Create FastAPI app skeleton with uvicorn (`GenreTagging-5zr`)

- `uv add fastapi uvicorn[standard] pydantic pydantic-settings`
- Create `app/main_fastapi.py` — FastAPI app with lifespan handler
- Mount `app/static` via Starlette `StaticFiles`
- Serve `index.html` at root
- Configure CORS (for Vite dev server proxy during frontend migration)
- Add uvicorn runner: `uvicorn app.main_fastapi:app --port 5001 --reload`
- Both Flask and FastAPI entry points coexist during migration

**Exit criteria**: `uv run uvicorn app.main_fastapi:app --port 5001` serves static frontend.

### Task 3: Define Pydantic models for core types (`GenreTagging-ztb`)

- `app/models/track.py` — TrackRow, TrackList (maps to DataFrame row/collection)
- `app/models/config.py` — AppConfig, TaggingConfig, ModelConfig
- `app/models/tree.py` — TreeNode, Lineage, Category, Leaf
- `app/models/workshop.py` — SetSlot, EnergyPreset, KeyPreset, EnergyWave
- `app/models/common.py` — ProgressEvent, ErrorResponse, SuccessResponse
- These models replace ad-hoc dict returns and fix int64/float64 serialization automatically

**Exit criteria**: All API response shapes have Pydantic models. Models validate against existing JSON responses.

### Task 4: Create state management with dependency injection (`GenreTagging-tqm`)

- `app/state.py` — `AppState` class holding df, caches, config, locks
- Replace `_state` global dict with typed `AppState` instance
- Create FastAPI dependency: `def get_state() -> AppState`
- Routers receive state via `Depends(get_state)` instead of global imports
- Add `threading.RLock` for DataFrame access (addresses Security 1p9.3)
- Add `threading.Lock` per listener list (addresses Security 1p9.2)

**Exit criteria**: `AppState` class with typed attributes and thread-safe accessors. DI wiring tested.

---

## Phase 2: Core Abstractions — Async Native (depends on Phase 1)

> Absorbs `shared-abstractions.md` (GenreTagging-n0e)

### Task 5: Async LLMClient (`GenreTagging-2wa`)

- `app/llm.py` — async class, provider auto-detection from model name
- Async calls via `httpx` or native async SDK (`openai` and `anthropic` both support async)
- Built-in retry with exponential backoff (`tenacity`)
- `.call()` → string response, `.call_json()` → parsed + validated dict
- `max_tokens` parameter (default 4096)
- Replaces duplicated provider routing in `tagger.py`, `tree.py`, `routes.py`

**Exit criteria**: All LLM calls go through `LLMClient`. Both providers tested.

### Task 6: Background task manager — asyncio-based (`GenreTagging-cen`)

- `app/tasks.py` — `BackgroundTaskManager` class
- Uses `asyncio.create_task()` instead of `threading.Thread`
- Each task has: name, cancel token (`asyncio.Event`), progress callback
- Manager tracks all running tasks, provides `cancel(name)` and `cancel_all()`
- Lifespan shutdown handler cancels all tasks and awaits completion (addresses Security 1p9.4)
- Replaces: tagging thread, genre/scene/collection tree threads, artwork workers

**Exit criteria**: All background work uses task manager. Clean shutdown confirmed.

### Task 7: Async JsonStore for persistence (`GenreTagging-tp5`)

- `app/persistence.py` — `JsonStore` class with `aiofiles`
- Async load/save with file locking (replaces `_artwork_cache_lock` pattern)
- Used by: playlists, saved sets, artwork cache, tree JSON
- Atomic writes (write to temp → rename) to prevent corruption

**Exit criteria**: All JSON file I/O goes through JsonStore. No more manual open/json.dump.

---

## Phase 3: Migrate Routes (depends on Phase 2)

Each domain migrated as a FastAPI `APIRouter`. Order: simplest → most complex.

> Absorbs `split-monoliths.md` (GenreTagging-8d6) — same domain split, FastAPI routers instead of Flask blueprints.
> Addresses `security-and-correctness.md` (GenreTagging-1p9) — path validation, typed responses, async patterns.

### Task 8: Migrate config + dropbox + upload routes — 12 routes (`GenreTagging-qt2`)

- `app/routers/config_routes.py` — Config CRUD, phase profiles
- `app/routers/dropbox.py` — Dropbox OAuth
- `app/routers/upload.py` — CSV upload, restore from file
- Pydantic request/response models on all endpoints
- These are the most isolated — good first migration to validate the pattern

### Task 9: Migrate tagging routes + SSE — 8 routes (`GenreTagging-5c8`)

- `app/routers/tagging.py` — Start/stop/status/progress
- SSE via `sse-starlette` or `StreamingResponse` with `async def event_generator()`
- Progress events use Pydantic `ProgressEvent` model
- Tagging logic stays in `app/services/tagger.py`, called via `LLMClient`

### Task 10: Migrate artwork routes — 13 routes (`GenreTagging-7dd`)

- `app/routers/artwork.py` — Serve artwork, cache management, download workers
- **Path validation**: Pydantic `Path` parameter with regex `^[a-f0-9]{32}_(small|big)\.jpg$` (addresses Security 1p9.1)
- Background artwork download via `BackgroundTaskManager`
- FileResponse for serving images

### Task 11: Migrate tree routes — 21 routes (`GenreTagging-843`)

- `app/routers/trees.py` — Genre, scene, collection tree building
- SSE progress streams for long-running tree builds
- Tree build pipelines use `LLMClient` + `BackgroundTaskManager`
- Pydantic models for tree structures

### Task 12: Migrate sets + playlists routes — 36 routes (`GenreTagging-ap7`)

- `app/routers/sets.py` — Set workshop, saved sets, export
- `app/routers/playlists.py` — Playlists, intersections, suggestions
- This is the largest batch — do sets and playlists as two sub-tasks

### Task 13: Migrate phases routes (`GenreTagging-9gb`)

- `app/routers/phases.py` — Phase profile management
- Move business logic to `app/services/phases.py`

---

## Phase 4: Cleanup + Deployment Update (depends on all Phase 3)

### Task 14: Remove Flask, finalize FastAPI (`GenreTagging-59c`)

- Remove Flask from dependencies (`uv remove flask`)
- Delete old `app/main.py` (Flask entry point), rename `main_fastapi.py` → `main.py`
- Delete old `app/routes.py`
- Update all imports
- Run full manual test of every tab
- Update `pyproject.toml` scripts: `uv run uvicorn app.main:app --port 5001`

### Task 15: Update deployment pipeline (`GenreTagging-crn`)

- Update `aws-deployment.md` plan:
  - Dockerfile: `uv` instead of `pip`, `uvicorn` instead of `gunicorn`
  - Nginx config: same proxy pattern, uvicorn workers config
  - Docker CMD: `uvicorn app.main:app --host 0.0.0.0 --port 5001 --workers 1`
- Update `.github/workflows/deploy.yml` if it exists
- Update CLAUDE.md running instructions

---

## Dependency Graph

```
Phase 0: [uv + pyproject.toml]
    │
    v
Phase 1: [FastAPI scaffold] → [Pydantic models] → [State management + DI]
    │
    v
Phase 2: [LLMClient] → [BackgroundTaskManager] → [JsonStore]
    │
    v
Phase 3: [config/dropbox/upload] → [tagging+SSE] → [artwork] → [trees] → [sets+playlists] → [phases]
    │
    v
Phase 4: [Remove Flask] → [Update deployment]
```

Phases are sequential. Within Phase 3, routes can be migrated in any order but the suggested order goes simplest → most complex.

## How This Addresses Security (GenreTagging-1p9)

| Security Issue | Flask Workaround | FastAPI Solution |
|---|---|---|
| Path traversal (1p9.1) | Manual regex check | Pydantic `Path` param with pattern validation |
| Broadcast race conditions (1p9.2) | Manual threading.Lock | asyncio single-threaded event loop — no races |
| DataFrame race conditions (1p9.3) | Manual RLock on every access | State DI with built-in locking, async access patterns |
| Thread cleanup (1p9.4) | atexit handler + manual join | FastAPI lifespan handler + asyncio task cancellation |

## How This Absorbs Split Monoliths (GenreTagging-8d6)

| Split Monoliths Task | FastAPI Equivalent |
|---|---|
| Extract state.py | Task 4: State management + DI |
| Split routes into blueprints | Phase 3: Domain routers |

## How This Absorbs Shared Abstractions (GenreTagging-n0e)

| Abstraction | FastAPI Equivalent |
|---|---|
| LLMClient | Task 5: Async LLMClient |
| BackgroundTaskRunner | Task 6: Asyncio task manager |
| JsonStore | Task 7: Async JsonStore |

## Relationship to Other Plans

- **Frontend Modernization** (`GenreTagging-x8f`): Do backend migration FIRST. React frontend then builds against typed FastAPI endpoints with auto-generated OpenAPI docs. Vite dev proxy points to uvicorn instead of Flask.
- **AWS Deployment** (`GenreTagging-qpw`): Updated in Task 15. Dockerfile uses `uv` + `uvicorn`. Same EC2 + Nginx + Docker architecture.
