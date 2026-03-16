# Multi-User Architecture Plan

A plan for evolving GenreTagging from a single-user tool to supporting multiple logged-in users, each with their own playlists, sets, trees, and Dropbox connection — without sharing data between them.

**Status**: Planning (not started)
**Prerequisite**: The resilience fixes from 2026-03-16 (lazy init, timeouts, reduced gunicorn timeout) should be proven stable in production first.

---

## The Problem

Today, everything lives in a single Python dictionary (`_state` in `routes.py`). There's one DataFrame, one set of trees, one Dropbox connection, one chat history. If a second user uploads a CSV, it overwrites the first user's data. There's no concept of "who" is making a request.

---

## What's In `_state` Today

The `_state` dict holds ~40 keys and is referenced ~153 times across the codebase (primarily `routes.py`, with `chat.py` and `chat_tools.py` receiving it as a parameter). Here's how the keys break down:

### User Data (must be isolated per user)

| Key | What it holds |
|-----|--------------|
| `df` | The pandas DataFrame — the loaded playlist. Core of everything |
| `original_filename` | Name of the uploaded CSV (used for autosave naming) |

### Background Tasks (must be isolated per user)

Each long-running operation (tagging, tree building, autoset, chat) has a set of three keys: a thread reference, a stop flag (`threading.Event`), and a list of progress listeners (`queue.Queue` for SSE streaming). There are also result keys for the built trees, autoset output, and chat history.

| Feature | Keys | Notes |
|---------|------|-------|
| Bulk tagging | `tagging_thread`, `stop_flag`, `progress_listeners` | Iterates through untagged tracks, calls LLM per-track |
| Genre tree | `tree`, `tree_thread`, `tree_stop_flag`, `tree_progress_listeners` | LLM-built genre hierarchy |
| Scene tree | `scene_tree`, `scene_tree_thread`, `scene_tree_stop_flag`, `scene_tree_progress_listeners` | LLM-built scene/vibe hierarchy |
| Collection tree | `collection_tree`, `collection_tree_thread`, `collection_tree_stop_flag`, `collection_tree_progress_listeners` | Curated cross-reference tree |
| AutoSet | `autoset_result`, `autoset_thread`, `autoset_stop_flag`, `autoset_progress_listeners` | Narrative set builder |
| Chat | `chat_history`, `chat_thread`, `chat_stop_flag`, `chat_progress_listeners` | Conversational AI |

That's ~25 keys, all user-specific. In a multi-user world, User A stopping their tagging job must not affect User B's running job.

### Caches (mixed — some shareable, some user-specific)

| Key | User-specific? | Why |
|-----|---------------|-----|
| `_analysis_cache` | Yes | Derived from the user's DataFrame (genre co-occurrence, facet options). Invalidated on upload |
| `_chord_cache` | Yes | Chord diagram data, specific to the loaded playlist |
| `_artwork_cache` | **Shareable** | Keyed by `"artist||title"` — the same track has the same artwork regardless of who uploaded it. Persists to disk (`output/artwork_cache.json`) |
| `_preview_cache` | **Shareable** | Spotify/Deezer preview URLs, also keyed by track identity |
| `_dropbox_exists_cache` | Depends | Currently keyed by Dropbox path. If users have different Dropbox accounts, these paths differ, but the cache can still be global (different keys won't collide) |

### Integration State (needs rethinking)

| Key | Today | Multi-user |
|-----|-------|-----------|
| `_dropbox_client` | Single shared Dropbox client | Each user needs their own Dropbox OAuth connection |
| `_dropbox_refresh_token` | One token, persisted to `output/dropbox_tokens.json` | Per-user token, stored in the user database |
| `_dropbox_account_id` | One account | Per-user |
| `_dropbox_oauth_csrf` | Single CSRF token for OAuth flow | Per-session (Flask session handles this naturally) |

---

## The Approach: SQLite-Per-User

Rather than a single shared database (which adds complexity around concurrent writes, pub/sub for SSE, etc.), each user gets their own SQLite file. The app loads the right one based on who's logged in.

```
output/
  users/
    {user_id}/
      state.db           # SQLite: playlist data, trees, sets, chat history
      dropbox_tokens.json # Per-user Dropbox OAuth tokens
      autosave.csv        # Latest CSV backup
  artwork/                # Shared across all users (keyed by track identity)
  artwork_cache.json      # Shared artwork cache
```

### Why SQLite-per-user (not one shared DB)?

- **Simpler isolation**: No need for `WHERE user_id = ?` on every query. Each DB file is a complete, independent user workspace
- **No concurrent write contention**: SQLite handles one writer at a time. With per-user files, users never contend with each other
- **Easy backup/export**: A user's entire state is one file. Easy to back up, migrate, or delete
- **Familiar data model**: The DataFrame maps naturally to a SQLite table. Trees and sets map to JSON columns
- **No Redis needed**: SSE progress streaming stays in-process (each user's background threads write to their own progress queues, scoped by session)
- **Incremental migration**: Can move one piece of state at a time (e.g. start with just the DataFrame, leave caches in memory)

### Why not just one process per user?

- Resource usage: each Python process is ~100-200MB. 10 users = 1-2GB just for idle processes
- Operational complexity: spinning containers up/down, port management, routing
- The codebase changes are actually smaller with SQLite-per-user than with container-per-user (which needs a whole orchestration layer)

---

## Implementation Phases

### Phase 1: Authentication

Add user login so the app knows who's making each request. Keep it simple.

**What to build**:
- Flask-Login with email/password (or OAuth via Google — simpler for users, slightly more setup)
- A `users` SQLite database (`output/users.db`) with `id`, `email`, `password_hash`, `created_at`
- Login/register pages (simple forms, matching the existing dark theme)
- A `@login_required` decorator on all API routes
- Session management via Flask's built-in signed cookies

**What changes**:
- `app/main_flask.py` — add Flask-Login setup, login/register routes
- `app/static/` — login page HTML/CSS
- New file: `app/auth.py` — user model, registration, password hashing

**What doesn't change**: Everything else. The app still works exactly as before for logged-in users. This phase just adds the "who are you?" gate.

**Effort**: Small. ~1-2 days.

### Phase 2: Per-User State Layer

Replace the global `_state` dict with a per-user state manager that loads/saves to SQLite.

**The key abstraction**:

```python
# Before (global state):
df = _state["df"]
_state["df"] = new_df

# After (per-user state):
df = get_user_state(current_user.id).df
get_user_state(current_user.id).df = new_df
```

**What to build**:
- `app/user_state.py` — a `UserState` class that wraps per-user SQLite access
  - `UserState.df` property: loads DataFrame from SQLite table, caches in memory for the session
  - `UserState.save_df()`: writes DataFrame back to SQLite
  - `UserState.trees`, `UserState.sets`, etc.: load/save JSON blobs from SQLite
  - Background task state (threads, stop flags, progress listeners) stays in memory but keyed by user ID
- A `get_user_state(user_id)` function that returns (or creates) a `UserState` instance
- In-memory cache of active `UserState` instances (so we're not hitting SQLite on every request)
- Eviction policy: after N minutes of inactivity, flush state to disk and release memory

**The SQLite schema per user** (`output/users/{user_id}/state.db`):

```sql
-- The playlist (one row per track)
CREATE TABLE tracks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    comment TEXT DEFAULT '',
    bpm TEXT DEFAULT '',
    key TEXT DEFAULT '',
    year TEXT DEFAULT '',
    location TEXT DEFAULT '',
    -- ... other CSV columns stored dynamically
);

-- Trees (stored as JSON blobs)
CREATE TABLE trees (
    name TEXT PRIMARY KEY,       -- 'genre', 'scene', 'collection'
    data JSON NOT NULL,
    updated_at TIMESTAMP
);

-- Saved sets
CREATE TABLE saved_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data JSON NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Playlists
CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data JSON NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Chat history
CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP
);

-- Per-user config overrides (model preference, prompts, etc.)
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL
);
```

**The migration path** (do this incrementally, not all at once):

1. **Start with the DataFrame**. This is the most-referenced piece of state (~35 references to `_state["df"]`). Replace those with `get_user_state(user_id).df`. Get this working and tested before touching anything else
2. **Then trees and sets**. These are already stored as JSON files on disk — moving them into per-user SQLite is straightforward
3. **Then background tasks**. Replace the flat `_state["tagging_thread"]` references with `get_user_state(user_id).tagging_thread`. The threading model stays the same, it's just scoped by user
4. **Then caches**. User-specific caches (`_analysis_cache`, `_chord_cache`) move to per-user state. Shared caches (`_artwork_cache`, `_preview_cache`) stay global
5. **Finally, Dropbox**. Per-user OAuth tokens stored in `output/users/{user_id}/dropbox_tokens.json`. Each user connects their own Dropbox account

**What changes**: `routes.py` is the big one — ~153 `_state` references need to go through the new `get_user_state()` layer. But it's mechanical: find `_state["df"]`, replace with `user_state.df`. The logic of each route stays the same.

**What doesn't change**: The frontend. The API contract is identical — the frontend still calls `/api/tracks`, `/api/tag`, etc. It just gets back the logged-in user's data instead of the global data.

**Effort**: Medium-large. The DataFrame migration alone is ~35 changes across routes.py. The full migration is ~153 changes plus the new `user_state.py` module. Estimate 3-5 days of focused work, testing each piece as you go.

### Phase 3: Multi-Worker (Optional)

Once state lives in SQLite instead of in-memory, you can run multiple gunicorn workers. This is the payoff of Phase 2 — but it's optional. A single worker with SQLite-per-user already supports multiple users (they just share the one worker's threads).

**What changes**:
- `Dockerfile`: `--workers 1` → `--workers 2` (or more, depending on EC2 instance size)
- SSE progress streaming needs rethinking: currently uses in-process `queue.Queue` objects. With multiple workers, the worker running the background task may not be the one holding the SSE connection. Options:
  - **File-based polling**: background task writes progress to a file, SSE endpoint polls it. Simple, slightly laggy
  - **SQLite polling**: background task writes progress to a `task_progress` table, SSE endpoint polls it. Clean, still slightly laggy
  - **Redis pub/sub**: real-time, but adds Redis as a dependency
  - **Single-worker compromise**: keep 1 worker but rely on SQLite for state persistence (survives restarts). This gives you multi-user without the SSE complexity

**Effort**: Small if you skip real-time SSE across workers (just bump the worker count). Medium if you want proper cross-worker SSE.

---

## What About Background Workers (Option B from devops.md)?

Option B (separate process for LLM work) is complementary, not competing. You could do both:
- Phase 2 gives you multi-user via SQLite-per-user
- Option B gives you resilience by moving LLM calls out of the web process

But they're independent. Phase 2 alone is enough for multi-user. Option B alone is enough for resilience. You don't need both unless you want both benefits.

If you do both, the order matters: **Phase 2 first, Option B second**. Moving state to SQLite makes the background worker separation easier, because the worker can read/write user state from the same SQLite files instead of needing access to in-memory `_state`.

---

## Risks and Gotchas

**DataFrame size in SQLite**: A large playlist (10,000+ tracks) loaded from SQLite into a pandas DataFrame on every request could be slow. Mitigation: cache the DataFrame in memory per-user, only reload from SQLite when it changes (use a version counter or last-modified timestamp).

**Dynamic CSV columns**: Users can upload CSVs with different column sets. The `tracks` SQLite table schema needs to handle this — either use a fixed set of known columns plus a JSON `extras` column, or create the table schema dynamically based on the uploaded CSV headers.

**Background task lifecycle**: If a user starts a tagging job, closes their browser, and comes back later — what happens? Currently the thread keeps running in memory. With SQLite, the thread's progress is persisted, but the thread itself dies if the worker recycles. Need to decide: do jobs survive worker restarts? (Probably not for V1 — just show "job was interrupted, restart it.")

**Memory management**: With N active users, N DataFrames are cached in memory. A t3.micro has 1GB RAM. Need an eviction policy — flush inactive users' state to SQLite after e.g. 15 minutes, and reload on next request.

**Dropbox OAuth flow**: Currently the OAuth callback URL is a single endpoint. With per-user tokens, the callback needs to know which user initiated the flow. Flask session handles this naturally (store user_id in session before redirect).

**Config**: Currently `config.json` is global (model selection, prompts, etc.). In multi-user, each user probably wants their own model/prompt preferences. The per-user `config` table handles this, with the global `config.json` as the default fallback.

---

## Estimated Timeline

| Phase | Effort | What you get |
|-------|--------|-------------|
| Phase 1: Auth | 1-2 days | Login gate, user accounts |
| Phase 2a: DataFrame in SQLite | 2-3 days | Per-user playlists (core multi-user) |
| Phase 2b: Trees, sets, chat | 1-2 days | Full state isolation |
| Phase 2c: Background tasks | 1-2 days | Per-user tagging/tree jobs |
| Phase 2d: Dropbox per-user | 1 day | Each user connects their own Dropbox |
| Phase 3: Multi-worker (optional) | 1-3 days | Resilience via multiple gunicorn workers |
| **Total** | **~7-13 days** | **Full multi-user support** |

These estimates assume focused implementation time with AI assistance. The migration is mechanical but wide — lots of find-and-replace across routes.py, with testing at each step.
