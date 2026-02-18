# GenreTagging - Project Instructions

## What This Is
A local DJ tool: upload a playlist CSV, auto-tag tracks with genre/style comments via LLM, browse curated trees, build DJ sets. Flask backend, vanilla JS frontend, single-user, in-memory DataFrame.

## Running
```bash
python app/main.py   # Flask on port 5001
```
Requires `.env` with `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`.

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

## Plans
Active improvement plans are in `.claude/plans/`:
- `security-and-correctness.md` — Thread safety, path traversal, shutdown cleanup
- `split-monoliths.md` — Break up routes.py (3.5K lines) and large JS files
- `shared-abstractions.md` — LLMClient, BackgroundTaskRunner, JsonStore
- `frontend-health.md` — Magic numbers, error handling, deduplication, memory leaks
- `aws-deployment.md` — Docker + ECR + EC2 deployment pipeline
