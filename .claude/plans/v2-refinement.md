# Plan: V2 Refinement — Reaching Feature Parity with V1

> Priority: High
> Date: 2026-02-23
> Depends on: `backend-modernization.md` (GenreTagging-94r), `frontend-modernization.md` (GenreTagging-x8f)

## Goal

Get V2 (FastAPI + React 19) working as well or better than V1 (Flask + vanilla JS) across all existing tabs. The Dance tab and dancer functions are explicitly excluded — they'll be migrated later.

## Target Architecture Constraints

All fixes must align with the V2 target stack for AWS deployment:

- **Backend**: FastAPI + Pydantic + asyncio (no Flask patterns creeping back)
- **Frontend**: React 19 + TypeScript + Vite + shadcn/ui + Zustand + TanStack Query
- **Deployment**: Docker → ECR → EC2, Nginx reverse proxy, uvicorn single worker
- **State**: AppState dataclass with DI via `Depends(get_state)`, thread-safe DataFrame access
- **Data flow**: React → TanStack Query → FastAPI → AppState/services → SSE streams back

No quick hacks that compromise deployability or maintainability.

---

## Issue Inventory

### P0 — Broken (blocking normal use)

#### 1. Artwork/Images Not Loading

**Root cause**: The V2 React frontend uses three inconsistent URL patterns for artwork, and two of them don't match any backend route.

| Component | URL Pattern Used | Backend Route | Result |
|-----------|-----------------|---------------|--------|
| `track-grid.tsx` | `/artwork/{artist}\|\|{title}` | Expects MD5 hash filename only | **400** (fails regex) |
| `drawer-detail.tsx`, `track-slot.tsx` | `/api/artwork/small/{artist}/{title}` | Route doesn't exist | **404** |
| `track-artwork.tsx` | `GET /api/artwork?artist=X&title=Y` then uses `cover_url` | Works correctly | **OK** |

**V1 approach (working)**: Frontend calls `/api/artwork/batch` with artist/title pairs → backend returns canonical `/artwork/{md5hash}_{size}.jpg?v={mtime}` URLs → frontend uses those URLs directly in `<img src>`.

**Fix**: Standardize all V2 components to use the metadata-first pattern (same as V1):

1. Create a shared `useArtwork` hook or utility that calls `/api/artwork` or `/api/artwork/batch`
2. Returns the canonical `cover_url` from the response
3. All components use the returned URL, never construct artwork URLs directly
4. Ensure the `/artwork/{filename}` static serving route in `artwork.py` is correctly mounted

**Files to change**:
- `frontend/src/components/tagger/track-grid.tsx` — replace direct URL construction
- `frontend/src/components/workshop/drawer-detail.tsx` — replace `/api/artwork/small/` pattern
- `frontend/src/components/workshop/track-slot.tsx` — same
- `frontend/src/components/workshop/base-drawer.tsx` — same
- `frontend/src/components/playlists/playlist-track-table.tsx` — replace direct URL
- Create: `frontend/src/hooks/use-artwork.ts` — shared artwork resolution hook with batching

**Architecture note**: The batching approach (collect requests, flush every 100ms, max 6 concurrent) from V1's `app.js` is good and should be replicated in the React hook using a queue pattern.

---

#### 2. Set Loading Broken

**Root cause**: The Sets tab has a TODO in `sets-tab.tsx` (line 14-22) — clicking "Load" navigates to the Set Workshop tab but doesn't populate the workshop grid with the saved set's slot data.

**V1 approach**: Loading a set restores all 12 slots with their assigned tracks, sources, and BPM positions into the workshop state.

**Fix**:
1. When "Load" is clicked, fetch the saved set via `GET /api/saved-sets/{id}`
2. Populate the workshop Zustand store with the set's slot data
3. Then navigate to the Set Workshop tab

**Files to change**:
- `frontend/src/components/sets/sets-tab.tsx` — implement load handler
- `frontend/src/stores/workshop.ts` — add `loadFromSavedSet()` action
- `frontend/src/hooks/use-sets.ts` — add load mutation

---

### P1 — Degraded (features work but with issues)

#### 3. Intersections "Browse Shared Tracks" Non-Functional

**Root cause**: `intersections-tab.tsx` (line 43-45) shows a stale toast saying "Browse Shared Tracks will be available when the Tracks tab is migrated." The Tracks tab IS migrated — this feature just wasn't connected.

**Fix**:
1. Remove the stale toast
2. When user clicks a chord intersection, open a filtered view showing shared tracks
3. Could use a dialog/drawer with an AG Grid filtered to the intersection tracks, or navigate to Tracks tab with a filter applied

**Files to change**:
- `frontend/src/components/intersections/intersections-tab.tsx`
- Potentially: `frontend/src/stores/ui.ts` (to pass filter state across tabs)

---

#### 4. Static File Serving Gap

**Root cause**: V2's `main.py` only mounts `/assets` for the React build output. There's no `/static/` mount for legacy assets. While V2 React doesn't need the old vanilla JS files, the artwork serving route at `/artwork/{filename}` needs to be verified as correctly mounted.

**Current state in `main.py`**:
```python
if os.path.isdir(os.path.join(_frontend_dist, "assets")):
    app.mount("/assets", StaticFiles(...), name="frontend-assets")
```

**Fix**: Verify the artwork route in `artwork.py` correctly serves files from `output/artwork/`. The route exists but needs testing — the regex validation (`^[a-f0-9]{32}_(small|big)\.jpg$`) should work with the canonical URLs returned by the batch endpoint. No `/static/` mount needed since V2 React bundles everything via Vite.

**Files to check**:
- `app/routers/artwork.py` — the `GET /artwork/{filename}` handler
- `app/main.py` — ensure no conflicting mounts

---

#### 5. CORS Configuration Only Allows Vite Dev Ports

**Current**: `main.py` allows `http://localhost:5173` and `http://localhost:5174` only.

**Issue**: When V2 is served as a built SPA (production mode), the frontend is served by FastAPI itself — no CORS needed. But if someone accesses from a different origin (e.g., during development on a different port, or from an EC2 deployment behind Nginx), requests may fail.

**Fix**: Make CORS origins configurable (env var or config.json), and ensure the production path (SPA served by FastAPI) doesn't need CORS at all. For AWS deployment, Nginx proxies everything to uvicorn on the same origin.

**Files to change**:
- `app/main.py` — make CORS origins configurable via environment variable

---

### P2 — Missing Features (V1 has it, V2 doesn't)

#### 6. Artwork Batch Loading / Warm Cache UI

**V1 features**: The unified header has buttons for "Warm Cache" (look up artwork for all tracks) and status indicators showing progress. The frontend also has sophisticated lazy-loading with IntersectionObserver.

**V2 status**: Backend endpoints exist (`/api/artwork/warm-cache`, `/api/artwork/warm-cache/status`) but the React frontend may not expose the warm-cache trigger or progress display.

**Fix**: Add a warm-cache button to the V2 header/toolbar area with progress feedback.

**Files to change**:
- Check/create: artwork controls in the header or settings area
- Wire up to existing backend endpoints

---

#### 7. Dropbox Audio Path Mapping UI

**V1**: Config dialog includes `audio_path_map_enabled`, `audio_path_from`, `audio_path_to` fields for remapping file paths when serving audio from Dropbox.

**V2 status**: Backend handles path mapping in `sets.py` (lines 91-100) but there's no frontend UI to configure these settings.

**Fix**: Add path mapping fields to the V2 config/settings dialog.

**Files to change**:
- `frontend/src/components/` — settings/config component
- Ensure config store includes path mapping fields

---

#### 8. Dropbox Status Indicator

**V1**: Shows Dropbox connection status in the header, with connect/disconnect buttons.

**V2 status**: Backend has full Dropbox OAuth routes (`/api/dropbox/status`, `/oauth`, `/callback`). Frontend integration needs verification.

**Fix**: Verify Dropbox status indicator exists in V2 header. If missing, add it.

---

### P3 — Polish & UX Improvements

#### 9. Auto-Restore on Page Load

**V1**: On page load, calls `/api/restore` to reload the last uploaded CSV so users don't lose their session.

**V2 status**: Backend endpoint exists. Frontend should call it on mount.

**Fix**: Verify `useEffect` in App.tsx or the tagger store calls restore on startup. If missing, add it.

---

#### 10. Export Functionality Verification

**V1**: CSV export, M3U export for playlists/sets/tree nodes all work.

**V2 status**: Backend endpoints exist. Frontend export buttons need verification — especially that file downloads trigger correctly (FastAPI `StreamingResponse` vs Flask `send_file`).

**Fix**: Test each export path end-to-end. Common issue: FastAPI returns the response but the React frontend doesn't trigger a browser download.

---

#### 11. Error Handling & Loading States

**V2 advantage**: React + TanStack Query provides much better loading/error state management than V1's ad-hoc approach. But need to verify all error paths are handled gracefully (e.g., LLM API key missing, network timeout, invalid CSV format).

**Fix**: Audit error boundaries and toast notifications across all tabs.

---

#### 12. V2 Output Directory Isolation

**Current**: V2 uses `output_v2/` for autosaves (set up in `main.py` lifespan). But artwork is shared in `output/artwork/`.

**Verify**: Ensure V2 reads/writes artwork to the shared `output/artwork/` directory (since artwork is universal, not version-specific), but uses `output_v2/` for session-specific files like autosave CSVs and `.last_upload.json`.

---

## Implementation Order

Phase 1 — **Unblock core usage** (P0 items):
1. Fix artwork loading (Issue #1) — highest impact, affects every tab
2. Fix set loading (Issue #2) — blocks the DJ set workflow

Phase 2 — **Complete feature parity** (P1 items):
3. Browse Shared Tracks in Intersections (Issue #3)
4. Verify static/artwork serving (Issue #4)
5. CORS configuration (Issue #5)

Phase 3 — **Fill gaps** (P2 items):
6. Warm cache UI (Issue #6)
7. Dropbox path mapping UI (Issue #7)
8. Dropbox status indicator (Issue #8)

Phase 4 — **Polish** (P3 items):
9. Auto-restore verification (Issue #9)
10. Export functionality audit (Issue #10)
11. Error handling audit (Issue #11)
12. Output directory isolation verification (Issue #12)

---

## Tab-by-Tab Status Summary

| Tab | Status | Blocking Issues |
|-----|--------|----------------|
| **Tagger** | ~95% | Artwork thumbnails broken (#1) |
| **Set Workshop** | ~80% | Artwork broken (#1), set loading broken (#2) |
| **Sets** | ~70% | Load-to-workshop broken (#2) |
| **Trees** | ~95% | Artwork in exemplars may be broken (#1) |
| **Playlists** | ~90% | Artwork broken (#1) |
| **Tracks** | ~95% | Artwork broken (#1) |
| **Intersections** | ~85% | Browse Shared Tracks stub (#3) |
| **Phases** | ~100% | None identified |
| **Auto Set** | ~100% | None identified |
| **Chat** | ~100% | None identified |
| **Dance** | Excluded | Migrating later |

## What's Already Better in V2

Worth noting — V2 already has significant advantages over V1:

- **Type safety**: Full TypeScript + Zod validation + Pydantic models — no more silent JSON serialization bugs
- **State management**: Zustand stores with clear boundaries vs V1's monolithic `_state` dict
- **Component architecture**: 94 focused React components vs 6 monolithic JS files
- **Build tooling**: Vite hot reload, tree-shaking, code splitting
- **Testing infrastructure**: Vitest + Playwright ready (V1 has no tests)
- **Deployability**: Docker + uvicorn + Nginx path is clean and production-ready
- **Thread safety**: AppState with RLock + ListenerList vs V1's ad-hoc locking
- **Developer experience**: Modern toolchain, IDE support, autocomplete everywhere
