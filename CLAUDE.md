# GenreTagging - Project Instructions

## What This Is
A local DJ tool: upload a playlist CSV, auto-tag tracks with genre/style comments via LLM, browse curated trees, build DJ sets. Flask backend, vanilla JS frontend, single-user, in-memory DataFrame.

## V1 / V2

This project has two versions:

| | V1 (current) | V2 (rebuild) |
|---|---|---|
| **What** | The app as it exists today | Complete rebuild on target architecture |
| **Backend** | Flask, `_state` dict, threads | FastAPI, Pydantic, asyncio |
| **Frontend** | Vanilla JS, AG Grid | React 19, TypeScript, Vite, shadcn/ui |
| **Beads epics** | — | `GenreTagging-94r` (backend), `GenreTagging-x8f` (frontend) |
| **Plans** | — | `backend-modernization.md`, `frontend-modernization.md` |
| **Run command** | `uv run python app/main.py` | `uv run uvicorn app.main_fastapi:app --port 5001` |

### How to interpret common instructions

| User says | Meaning |
|-----------|---------|
| "Continue V2" / "Continue the rebuild" | Check `bd ready`, pick up next unblocked V2 task |
| "Add X to V1" / "Add X to the current app" | Build the feature in the Flask + vanilla JS codebase |
| "Run V1" / "Run the app" | `uv run python app/main.py` (port 5001) |
| "Run V2" | `uv run uvicorn app.main_fastapi:app --port 5001` |
| "V2 status" / "Rebuild status" | Show progress via `bd list` on epics 94r + x8f |
| "V2 plan" / "Build V2 plan" | Refer to `.claude/plans/backend-modernization.md` + `frontend-modernization.md` |
| "Deploy V2" | Refer to `.claude/plans/aws-deployment.md` |

### V2 Progress
Tracked entirely in beads. Use `bd ready` to find next work, `bd list` on the epics for full status.
- **Backend** (`GenreTagging-94r`): Phase 0 DONE → Phase 1 → 2 → 3 → 4
- **Frontend** (`GenreTagging-x8f`): Blocked until backend epic closes

## Running
```bash
uv run python app/main.py   # V1: Flask on port 5001
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
- **Backend**: Flask, pandas DataFrame in `_state["df"]`, LLM via OpenAI + Anthropic SDKs
- **Frontend**: Vanilla JS, AG Grid (dark theme), no frameworks/bundler
- **Persistence**: JSON files + autosave CSVs in `output/`, artwork on disk in `output/artwork/`
- **Tabs**: Set Workshop, Sets, Tagger, Intersections, Playlists, Trees, Phases

## Key Files
| Area | Files |
|------|-------|
| Backend core | `app/routes.py`, `app/tagger.py`, `app/config.py`, `app/parser.py` |
| Features | `app/playlist.py`, `app/tree.py`, `app/setbuilder.py`, `app/phases.py` |
| Frontend | `app/static/app.js`, `workshop.js`, `tree.js`, `setbuilder.js`, `phases.js` |
| Styles | `app/static/style.css` |
| Config | `config.json` (gitignored), `.env` (gitignored) |

## Conventions
- All session state in `_state` dict in `routes.py`
- Comment format: `Genre1; Genre2; descriptors; mood; location, era.`
- Parsed facet columns prefixed with `_` (e.g. `_genre1`)
- numpy int64 NOT JSON serializable — use `_safe_val()` or `.item()`
- Artwork filename: `md5("artist||title")_{small|big}.jpg`
- LLM provider auto-detected from model name (claude* = anthropic, else openai)

## Gotchas
- pandas dtypes need conversion for Flask jsonify (int64, float64 -> Python native)
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
- `backend-modernization.md` — **uv + FastAPI migration** (`GenreTagging-94r`) — P1, do first
- `frontend-modernization.md` — React 19 + TypeScript + Vite + Bun migration (`GenreTagging-x8f`) — blocked by backend
- `aws-deployment.md` — Docker + ECR + EC2 deployment pipeline (`GenreTagging-qpw`) — updated by backend migration
- `security-and-correctness.md` — ~~Archived~~ (superseded by backend-modernization)
- `split-monoliths.md` — ~~Archived~~ (superseded by backend-modernization)
- `shared-abstractions.md` — ~~Archived~~ (absorbed by backend-modernization)
- `frontend-health.md` — ~~Archived~~ (superseded by frontend-modernization)
