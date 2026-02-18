# GenreTagging - Project Instructions

## What This Is
A local DJ tool: upload a playlist CSV, auto-tag tracks with genre/style comments via LLM, browse curated trees, build DJ sets. Flask backend, vanilla JS frontend, single-user, in-memory DataFrame.

## Running
```bash
uv run python app/main.py   # Flask on port 5001
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
