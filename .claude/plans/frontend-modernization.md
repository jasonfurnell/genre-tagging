# Plan: Frontend Modernization
> Source: Architecture discussion
> Priority: Medium
> **Beads Epic**: `GenreTagging-x8f` (P2) — 14 subtasks

## Stack

| Layer | Tool |
|-------|------|
| Runtime/PM | Bun |
| Bundler | Vite |
| Language | TypeScript (strict) |
| Framework | React 19 |
| UI components | shadcn/ui + Radix primitives |
| Data grid | AG Grid React (kept from current stack) |
| Styling | Tailwind v4 (CSS-first config) |
| Client state | Zustand |
| Server state | TanStack Query |
| Validation | Zod |
| Linting | ESLint v9 flat config |
| Formatting | Prettier |
| Dead code | Knip |
| Git hooks | Husky + lint-staged |
| Unit/component tests | Vitest + React Testing Library + MSW |
| E2E tests | Playwright |
| Future packaging | Buntralino (Mac app) |

## Phase 1: Scaffold
- `GenreTagging-x8f.1` — Initialize Bun + Vite + React + TypeScript project, Vite proxy → Flask :5001
- `GenreTagging-x8f.2` — Configure Tailwind v4 + shadcn/ui (depends on .1)
- `GenreTagging-x8f.3` — Set up ESLint + Prettier + Knip + Husky + lint-staged (depends on .1)

## Phase 2: Foundation
- `GenreTagging-x8f.5` — Create React app shell: layout, tab routing, dark theme (depends on .1, .2)
- `GenreTagging-x8f.7` — Set up Zustand stores + TanStack Query + Zod schemas (depends on .5)
- `GenreTagging-x8f.8` — Set up testing infrastructure: Vitest + RTL + MSW + Playwright (depends on .1)

## Phase 3: Migrate Tabs (all depend on .7)
- `GenreTagging-x8f.9` — Tagger tab (start here — most straightforward)
- `GenreTagging-x8f.10` — Sets tab
- `GenreTagging-x8f.11` — Playlists & Intersections tabs
- `GenreTagging-x8f.12` — Trees tab (genre/scene/collection)
- `GenreTagging-x8f.13` — Set Workshop tab (most complex — slot machine grid, energy wave, BPM/key)
- `GenreTagging-x8f.14` — Phases tab

## Phase 4: Cleanup
- `GenreTagging-x8f.4` — Remove legacy JS/CSS, Flask serves API only (depends on all tab migrations)

## Future
- `GenreTagging-x8f.6` — Buntralino Mac app packaging (P4, depends on .4)

## Supersedes
- **Frontend Health** (`GenreTagging-57d`) — all 7 tasks closed, full rewrite addresses magic numbers, error handling, dedup, memory leaks, CSS consistency
- **Split Monoliths frontend tasks** (`GenreTagging-8d6.3`, `GenreTagging-8d6.4`) — JS/CSS splitting replaced by Vite+React structure

## Migration Notes
- Tab-by-tab approach: React shell runs first, tabs migrated incrementally
- AG Grid kept — shadcn tables are not comparable for data-heavy views
- Backend migrated to FastAPI (see `backend-modernization.md`, `GenreTagging-94r`) — Vite dev server proxies API calls to uvicorn
- Buntralino decision simplified: Flask removed, backend is FastAPI+uvicorn — package as Python sidecar or port to Bun/TS later
