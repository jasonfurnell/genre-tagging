# Plan: Security & Correctness
> Source: `docs/architecture-review.md` — Phase 1
> Priority: High (do first)
> **Beads Epic**: `GenreTagging-1p9` (P1) — 4 subtasks

## 1. Path Traversal in `serve_artwork()`
**File**: `app/routes.py`
**Issue**: `@api.route("/artwork/<path:filename>")` passes filename directly to `os.path.join()` with no validation — `../../etc/passwd` would resolve outside `_ARTWORK_DIR`.
**Fix**: Validate filename matches `^[a-f0-9]{32}_(small|big)\.jpg$` regex before serving. Return 404 for anything else.

## 2. Broadcast Race Conditions
**Files**: `app/routes.py`
**Issue**: `_broadcast()`, `_tree_broadcast()`, `_scene_tree_broadcast()`, `_collection_tree_broadcast()` all iterate and mutate `_state["*_listeners"]` lists without locking. Vulnerable to `RuntimeError: list changed size during iteration`.
**Fix**: Add a `threading.Lock` per listener list (or one shared lock). Acquire lock in broadcast functions and in SSE connect/disconnect.

## 3. DataFrame Race Conditions
**File**: `app/routes.py`
**Issue**: `_state["df"]` mutated by tagging thread while upload, tree-build, and set workshop routes read concurrently. ~147 unprotected accesses.
**Fix**: Add `_state_lock = threading.RLock()` for `_state["df"]` reads/writes. Use context manager pattern for clean acquisition.

## 4. Thread Cleanup on Shutdown
**File**: `app/routes.py` or new `app/background.py`
**Issue**: 11 daemon threads started, 0 joined. No cleanup on shutdown — threads may be mid-LLM-call when process exits.
**Fix**: Register `atexit` handler that signals all stop flags and joins daemon threads with a timeout.

## Verification
- [ ] Artwork endpoint rejects `../` paths
- [ ] No `RuntimeError` under concurrent SSE connections
- [ ] Clean shutdown with no orphan threads
