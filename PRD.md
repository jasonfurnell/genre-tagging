# Genre Tagging Web App — Product Requirements Document

## Overview

A local web application that lets a DJ upload a playlist CSV, automatically generate genre/style comments for each track using an LLM, review and edit the results, and export the final tagged playlist. Runs entirely on the user's own machine via `localhost`.

## Target User

A single user (the developer/DJ) running the app locally. No authentication, multi-tenancy, or deployment infrastructure required.

## Core Workflow

1. **Upload** — User drags or selects a CSV file containing playlist data (columns: title, artist, albumTitle, bpm, key, comment, year, location).
2. **Preview** — The app displays the tracks in a table. Tracks that already have comments are visually distinguished from those that need tagging.
3. **Configure prompt** — Before tagging, the user can view and edit the system prompt and user prompt template from the UI. A sensible default is pre-filled. Changes persist across sessions.
4. **Tag** — User clicks a button to start generating comments. Progress is shown in real-time (track-by-track). The user can stop/cancel the run at any time. Tracks that already have comments are skipped.
5. **Review & edit** — Once tagging is complete (or paused), the user can click on any track's comment to edit it inline. They can also re-tag individual tracks (regenerate a single comment).
6. **Export** — User downloads the final CSV with all comments populated. The exported file has the same column structure as the input (no duplicate columns, no extra metadata).

## Functional Requirements

### F1: CSV Upload
- Accept `.csv` files via drag-and-drop or file picker.
- Validate that required columns (`title`, `artist`) are present; warn if others are missing.
- Display a clear error if the file can't be parsed.
- Show a summary after upload: total tracks, tracks with existing comments, tracks needing tagging.

### F2: Track Table
- Display all tracks in a scrollable table with columns: #, title, artist, bpm, key, year, comment.
- Rows without comments are highlighted (e.g. subtle background colour).
- The table should handle playlists of up to ~1,000 tracks without performance issues.
- Sortable columns (at minimum: title, artist, year).

### F3: Prompt Customisation
- Provide a settings panel (modal or sidebar) where the user can edit:
  - **System prompt** — the role/persona sent to the LLM (default: "You are a music genre expert and DJ selector.")
  - **User prompt template** — the per-track prompt, with `{title}` and `{artist}` placeholders (and optionally `{bpm}`, `{key}`, `{year}`).
- Changes are saved to a local config file and persist across sessions.
- A "Reset to default" button restores the original prompts.

### F4: Tagging Engine
- Process tracks sequentially, one API call at a time, with a configurable delay between requests (default: 1.5s).
- Skip tracks that already have a non-empty comment.
- Show real-time progress: current track number, track name, and a progress bar.
- Allow the user to **stop** a run at any time. Already-tagged tracks keep their comments.
- Retry failed API calls up to 3 times with a 5-second wait (matching current behaviour).
- If a track fails after all retries, mark it as errored (don't block the rest of the run).

### F5: Review & Edit
- Clicking a comment cell makes it editable inline.
- A "Re-tag" button on each row regenerates that single track's comment via the API.
- A "Clear" button on each row removes the comment (so it will be re-tagged on the next run).
- Bulk actions: "Clear all comments", "Re-tag all" (with confirmation).

### F6: Export
- "Download CSV" button exports the current state of the table as a CSV file.
- The exported CSV matches the original column structure exactly (same column names, same order).
- The downloaded filename is based on the original input filename with a `_tagged` suffix (e.g. `playlist_tagged.csv`).

### F7: Resume / State Persistence
- The app holds the current working playlist in memory on the server.
- If the browser is refreshed mid-session, the current state (uploaded data + any generated comments) is preserved.
- On app restart, the user starts fresh (upload a new file).

## Non-Functional Requirements

### Tech Stack
- **Backend**: Python (Flask or FastAPI). Reuses the existing OpenAI/tenacity logic.
- **Frontend**: Lightweight — plain HTML/CSS/JS, or a minimal framework (e.g. Alpine.js, htmx). No heavy SPA framework needed for this scope.
- **Communication**: REST API endpoints. Real-time progress via Server-Sent Events (SSE) or polling.

### Performance
- Tagging speed is bounded by the LLM API (1 track per ~2-3 seconds). The UI should remain responsive during tagging.
- Table rendering should handle up to 1,000 rows smoothly.

### Configuration
- LLM settings (model name, API key source) are configured via the existing `.env` file — not exposed in the web UI for security.
- Prompt templates and UI preferences (like delay between requests) are configured in the web UI and saved to a local JSON config file.

## Out of Scope (for v1)
- User authentication / multi-user support.
- Cloud deployment.
- Multiple LLM provider support (Claude, local models, etc.) — future enhancement.
- BPM/key enrichment via Spotify or audio analysis — future enhancement.
- Direct import/export to DJ software formats (Rekordbox XML, Serato crates) — future enhancement.
- Database storage — v1 works with CSVs in memory and on disk.

## File Structure (proposed)

```
GenreTagging/
├── app/
│   ├── __init__.py
│   ├── main.py              # App entry point, Flask/FastAPI setup
│   ├── routes.py             # API endpoints (upload, tag, export, etc.)
│   ├── tagger.py             # Genre tagging logic (moved from notebook)
│   ├── config.py             # Prompt/settings management
│   ├── static/               # CSS, JS
│   │   ├── style.css
│   │   └── app.js
│   └── templates/            # HTML templates
│       └── index.html
├── data/                     # Input CSVs (existing)
├── output/                   # Output CSVs (existing)
├── notebooks/                # Original notebooks (kept for reference)
├── .env                      # API key
├── config.json               # Saved prompt templates & settings
├── requirements.txt
├── PRD.md
└── README.md
```
