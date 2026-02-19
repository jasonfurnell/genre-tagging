# GenreTagging - Project Instructions

## What This Is
A local DJ tool: upload a playlist CSV, auto-tag tracks with genre/style comments via LLM, browse curated trees, build DJ sets. Single-user, in-memory DataFrame. V1 (Flask) and V2 (FastAPI) coexist — see below.

## V1 / V2

This project has two versions:

| | V1 (current app) | V2 (rebuild) |
|---|---|---|
| **What** | The working app — must always remain functional | Complete rebuild on modern stack |
| **Backend** | Flask, `_state` dict, threads | FastAPI, Pydantic, `AppState`, asyncio |
| **Frontend** | Vanilla JS, AG Grid | React 19, TypeScript, Vite, shadcn/ui |
| **Entry point** | `app/main_flask.py` | `app/main.py` |
| **Run command** | `uv run python app/main_flask.py` | `uv run uvicorn app.main:app --port 5001` |
| **Key files** | `app/routes.py`, `app/main_flask.py` | `app/main.py`, `app/routers/`, `app/state.py` |
| **Beads epics** | — | `GenreTagging-94r` (backend), `GenreTagging-x8f` (frontend) |

### V1/V2 Isolation Rules

**V1 must never be broken by V2 work.** Specifically:
- **NEVER delete or overwrite V1 files** (`app/routes.py`, `app/main_flask.py`)
- **NEVER remove V1 dependencies** (Flask must remain in `pyproject.toml`)
- **Shared output directory** (`output/`) — V2 must not write to files V1 depends on (e.g. `.last_upload.json`, autosave CSVs). See `GenreTagging-zcl` for planned isolation.
- Test V1 still works after any V2 change: `uv run python app/main_flask.py`

### How to interpret common instructions

| User says | Meaning |
|-----------|---------|
| "Continue V2" / "Continue the rebuild" | Check `bd ready`, pick up next unblocked V2 task |
| "Add X to V1" / "Add X to the current app" | Build the feature in the Flask + vanilla JS codebase (`routes.py` + `main_flask.py`) |
| "Run V1" / "Run the app" | `uv run python app/main_flask.py` (port 5001) |
| "Run V2" | `uv run uvicorn app.main:app --port 5001` |
| "V2 status" / "Rebuild status" | Show progress via `bd list` on epics 94r + x8f |
| "V2 plan" / "Build V2 plan" | Refer to `.claude/plans/backend-modernization.md` + `frontend-modernization.md` |
| "Deploy" | Refer to `.claude/plans/aws-deployment.md` |

### V2 Progress
Tracked entirely in beads. Use `bd ready` to find next work, `bd list` on the epics for full status.
- **Backend** (`GenreTagging-94r`): Route migration in progress — V1 Flask files preserved alongside
- **Frontend** (`GenreTagging-x8f`): Blocked until backend epic closes

## Running
```bash
uv run python app/main_flask.py          # V1: Flask on port 5001 (daily use)
uv run uvicorn app.main:app --port 5001  # V2: FastAPI on port 5001 (development)
```
Requires `.env` with `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`.

## Package Management
Uses **uv** for dependency management. Dependencies defined in `pyproject.toml`, locked in `uv.lock`.
```bash
uv add <package>       # Add a dependency
uv remove <package>    # Remove a dependency
uv sync                # Install from lockfile
uv run <command>       # Run within the venv
```

## Architecture

### V1 (Flask)
- **Backend**: Flask, pandas DataFrame in `_state["df"]`, LLM via OpenAI + Anthropic SDKs
- **Frontend**: Vanilla JS, AG Grid (dark theme), no frameworks/bundler
- **Persistence**: JSON files + autosave CSVs in `output/`, artwork on disk in `output/artwork/`
- **Tabs**: Set Workshop, Sets, Tagger, Intersections, Playlists, Trees, Phases, Auto Set, Chat

### V2 (FastAPI)
- **Backend**: FastAPI, pandas DataFrame in `AppState.df`, Pydantic models, asyncio
- **Frontend**: (same vanilla JS for now — React migration pending)

## Key Files
| Area | V1 Files | V2 Files |
|------|----------|----------|
| Entry point | `app/main_flask.py` | `app/main.py` |
| Routes | `app/routes.py` | `app/routers/` |
| State | `_state` dict in `routes.py` | `app/state.py` (`AppState` dataclass) |
| Features | `app/tagger.py`, `app/tree.py`, `app/setbuilder.py`, `app/playlist.py`, `app/phases.py`, `app/autoset.py`, `app/chat.py` | same (shared) |
| Frontend | `app/static/app.js`, `workshop.js`, `tree.js`, `setbuilder.js`, `phases.js`, `autoset.js`, `chat.js` | same (shared) |
| Styles | `app/static/style.css` | same (shared) |
| Config | `config.json` (gitignored), `.env` (gitignored) | same (shared) |

## Conventions
- **V1**: All session state in `_state` dict in `routes.py`
- **V2**: All session state in `AppState` dataclass via `app/state.py`, injected with `Depends(get_state)`
- Comment format: `Genre1; Genre2; descriptors; mood; location, era.`
- Parsed facet columns prefixed with `_` (e.g. `_genre1`)
- numpy int64 NOT JSON serializable — use `_safe_val()` or `.item()`
- Artwork filename: `md5("artist||title")_{small|big}.jpg`
- LLM provider auto-detected from model name (claude* = anthropic, else openai)

## Gotchas
- pandas dtypes need conversion for JSON responses (int64, float64 -> Python native)
- macOS `timeout` command doesn't exist — use python-based timeouts
- Artwork cache JSON can corrupt from concurrent workers — disk files are source of truth, use `_artwork_cache_lock`
- `_state["_analysis_cache"]` must be invalidated on CSV upload

## Issue Tracking
This project uses **bd** (Beads) for issue tracking. See `AGENTS.md` for workflow details.
- `bd ready` — list tasks with no open blockers
- `bd create "Title" -p <priority>` — create a task (P0=critical, P1=high, P2=normal, P3=low)
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- Include issue ID in commit messages: `git commit -m "Fix bug (GenreTagging-abc)"`

## Plans
Active improvement plans are in `.claude/plans/`, each linked to a beads epic:
- `backend-modernization.md` — **uv + FastAPI migration** (`GenreTagging-94r`) — route migration in progress, V1 preserved alongside
- `frontend-modernization.md` — React 19 + TypeScript + Vite + Bun migration (`GenreTagging-x8f`) — blocked by backend
- `aws-deployment.md` — Docker + ECR + EC2 deployment pipeline (`GenreTagging-qpw`) — updated by backend migration
- `security-and-correctness.md` — ~~Archived~~ (superseded by backend-modernization)
- `split-monoliths.md` — ~~Archived~~ (superseded by backend-modernization)
- `shared-abstractions.md` — ~~Archived~~ (absorbed by backend-modernization)
- `frontend-health.md` — ~~Archived~~ (superseded by frontend-modernization)
