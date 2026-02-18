# Build Plan — Genre Tagging Web App

Step-by-step implementation plan for the PRD. Each step is self-contained and results in something testable. Complete them in order.

---

## Step 1: Project scaffolding

**Goal**: Create the folder structure and install dependencies so the app can start.

**Tasks**:
1. Create the `app/` directory with subdirectories: `app/static/`, `app/templates/`.
2. Create empty `__init__.py` in `app/`.
3. Add `flask` to `requirements.txt` and install it in the venv.
4. Create `app/main.py` with a minimal Flask app that serves a "Hello World" page on `http://localhost:5000`.
5. Verify it runs: `venv/bin/python app/main.py` should show the page in a browser.

**Files created/modified**:
- `app/__init__.py`
- `app/main.py`
- `requirements.txt`

---

## Step 2: Extract the tagging engine into a reusable module

**Goal**: Move the genre-tagging logic out of the notebook into a Python module the web app can import.

**Tasks**:
1. Create `app/tagger.py` containing:
   - A `generate_genre_comment(client, title, artist, system_prompt, user_prompt_template)` function with the existing retry logic.
   - The function should accept the prompts as parameters (not hardcode them).
   - It should use `{title}`, `{artist}`, `{bpm}`, `{key}`, `{year}` as placeholder tokens in the user prompt template, substituting only those that are provided.
2. Create `app/config.py` containing:
   - Default system prompt and user prompt template constants.
   - A `load_config()` function that reads `config.json` from the project root. If the file doesn't exist, return defaults.
   - A `save_config(config_dict)` function that writes to `config.json`.
   - Config schema: `{ "system_prompt": "...", "user_prompt_template": "...", "delay_between_requests": 1.5 }`.
3. Write a quick smoke test: run `venv/bin/python -c "from app.tagger import generate_genre_comment; print('OK')"` to confirm the import works.

**Files created**:
- `app/tagger.py`
- `app/config.py`

---

## Step 3: Build the API endpoints

**Goal**: Create all the backend routes the frontend will call.

**Tasks**:
1. Create `app/routes.py` with a Flask Blueprint containing these endpoints:

   | Method | Endpoint | Purpose |
   |--------|----------|---------|
   | `POST` | `/api/upload` | Accept a CSV file upload. Parse it with pandas. Validate required columns (`title`, `artist`). Store the dataframe in server memory. Return JSON summary: `{ total, tagged, untagged, columns }`. |
   | `GET` | `/api/tracks` | Return all tracks as JSON array. Each track includes an `id` (row index), all CSV columns, and a `status` field (`tagged`, `untagged`, `error`). |
   | `POST` | `/api/tag` | Start tagging all untagged tracks. Run in a background thread. Return `{ "started": true }`. |
   | `GET` | `/api/tag/progress` | SSE (Server-Sent Events) endpoint that streams progress updates as tracks are tagged: `{ id, title, artist, comment, progress: "5/13" }`. Also sends a `done` event when complete. |
   | `POST` | `/api/tag/stop` | Stop the current tagging run. Already-tagged tracks keep their comments. |
   | `POST` | `/api/tag/<id>` | Re-tag a single track by row id. Return the new comment. |
   | `PUT` | `/api/track/<id>` | Update a single track's comment (inline edit). Accept JSON `{ "comment": "..." }`. |
   | `POST` | `/api/track/<id>/clear` | Clear a single track's comment. |
   | `POST` | `/api/tracks/clear-all` | Clear all comments (with no undo — frontend should confirm). |
   | `GET` | `/api/export` | Return the current dataframe as a downloadable CSV file. Filename based on original upload name + `_tagged`. |
   | `GET` | `/api/config` | Return current prompt config as JSON. |
   | `PUT` | `/api/config` | Update prompt config. Save to `config.json`. |
   | `POST` | `/api/config/reset` | Reset prompts to defaults. Save to `config.json`. |

2. Register the blueprint in `app/main.py`.
3. Use a simple module-level dict or class in `routes.py` to hold session state (the current dataframe, tagging thread reference, stop flag). No database needed.
4. Test each endpoint with `curl` commands to verify they work before building the frontend.

**Files created/modified**:
- `app/routes.py`
- `app/main.py` (register blueprint)

---

## Step 4: Build the HTML page shell

**Goal**: Create the single-page HTML layout with all UI sections, no functionality yet.

**Tasks**:
1. Create `app/templates/index.html` with these sections (all in one page):
   - **Header**: App title "Genre Tagger".
   - **Upload area**: A drag-and-drop zone with a file picker fallback. Shows a summary after upload (total tracks, tagged, untagged).
   - **Toolbar**: Buttons for "Tag All", "Stop", "Clear All", "Export CSV", "Settings". Tag All and Stop are mutually exclusive (only one visible at a time).
   - **Track table**: An HTML table with columns: #, Title, Artist, BPM, Key, Year, Comment, Actions. Empty state message when no file is uploaded.
   - **Settings modal**: A modal/overlay with textareas for system prompt and user prompt template, a number input for delay, and buttons for Save and Reset to Defaults.
   - **Progress bar**: A thin bar above the table that shows during tagging runs.
2. Create `app/static/style.css` with clean, minimal styling:
   - Dark or neutral theme suitable for a DJ/music tool.
   - Responsive table that scrolls horizontally on small screens.
   - Highlighted rows for untagged tracks.
   - Modal styling for the settings panel.
3. Update `app/main.py` to serve `index.html` at the root route (`/`).
4. Verify the page loads and looks correct in a browser (all sections visible, no JS yet).

**Files created/modified**:
- `app/templates/index.html`
- `app/static/style.css`
- `app/main.py` (add root route)

---

## Step 5: Wire up CSV upload and track display

**Goal**: The user can upload a CSV and see tracks in the table.

**Tasks**:
1. Create `app/static/app.js`. Use plain vanilla JS (no framework).
2. Implement drag-and-drop and file picker on the upload area. On file select, POST to `/api/upload` as `multipart/form-data`.
3. On successful upload, display the summary (total/tagged/untagged) and call `GET /api/tracks` to populate the table.
4. Render each track as a table row. The comment cell should show the comment text or an empty state indicator. Untagged rows get a CSS class for highlighting.
5. Test: upload `data/playlist.csv`, verify all 13 tracks appear with their existing comments.

**Files created/modified**:
- `app/static/app.js`
- `app/templates/index.html` (minor tweaks if needed)

---

## Step 6: Wire up tagging with real-time progress

**Goal**: User clicks "Tag All", comments appear in the table in real-time.

**Tasks**:
1. In `app.js`, add a click handler on the "Tag All" button that:
   - POSTs to `/api/tag` to start the tagging run.
   - Opens an EventSource connection to `/api/tag/progress`.
   - On each SSE message, updates the corresponding row's comment cell and advances the progress bar.
   - On the `done` event, closes the connection, hides the progress bar, and swaps the Stop button back to Tag All.
2. Add a click handler on "Stop" that POSTs to `/api/tag/stop` and closes the EventSource.
3. Test: upload `data/playlist.csv` (which already has comments — all should be skipped). Then upload a modified version with some comments cleared, and verify only those tracks get tagged.

**Files modified**:
- `app/static/app.js`

---

## Step 7: Wire up inline editing and per-track actions

**Goal**: User can edit comments, re-tag individual tracks, and clear comments.

**Tasks**:
1. Make the comment cell editable on click. On blur (or Enter key), PUT to `/api/track/<id>` to save the edit. Show a brief visual confirmation (e.g. cell flashes green).
2. Add an "Actions" column to each row with small buttons/icons:
   - **Re-tag**: POST to `/api/tag/<id>`, replace the comment with the new result. Show a spinner on that row while waiting.
   - **Clear**: POST to `/api/track/<id>/clear`, blank out the comment, re-apply the untagged highlight.
3. Wire up the "Clear All" toolbar button: confirm with a dialog, then POST to `/api/tracks/clear-all` and refresh the table.
4. Test all three actions on individual tracks.

**Files modified**:
- `app/static/app.js`
- `app/static/style.css` (action button styles, flash animation)

---

## Step 8: Wire up export

**Goal**: User can download the tagged CSV.

**Tasks**:
1. Wire the "Export CSV" button to trigger a download from `GET /api/export`. Use `window.location` or a temporary `<a>` tag with the download attribute.
2. Test: upload a CSV, tag some tracks, click Export, open the downloaded file and verify it has the correct columns and data.

**Files modified**:
- `app/static/app.js`

---

## Step 9: Wire up prompt customisation (settings modal)

**Goal**: User can edit prompts from the UI and changes persist.

**Tasks**:
1. When the settings modal opens, fetch `GET /api/config` and populate the textareas and delay input.
2. "Save" button: PUT to `/api/config` with the form values. Close the modal. Show a brief confirmation.
3. "Reset to Defaults" button: POST to `/api/config/reset`, then re-fetch and repopulate the fields.
4. Display available placeholders (`{title}`, `{artist}`, `{bpm}`, `{key}`, `{year}`) as a reference beneath the user prompt textarea.
5. Test: change the prompt, tag a track, verify the new prompt style is reflected in the output. Reset to defaults and verify.

**Files modified**:
- `app/static/app.js`

---

## Step 10: Polish and cleanup

**Goal**: Fix rough edges, tidy up, update documentation.

**Tasks**:
1. Add table sorting (click column headers to sort by title, artist, year). Pure JS — no library needed.
2. Add a "tagged/untagged" counter that updates in real-time as tracks are processed.
3. Handle edge cases:
   - Uploading a new CSV while tagging is running (should stop the run first or block the upload).
   - Uploading a CSV with no untagged tracks (disable Tag All, show a message).
   - Empty CSV or CSV with only headers.
4. Add a startup message to `main.py` that prints the URL (`http://localhost:5000`) to the terminal.
5. Update `README.md` with:
   - How to install dependencies (`pip install -r requirements.txt`).
   - How to set the API key (`.env` file).
   - How to run the app (`python app/main.py`).
   - Brief description of what it does.
6. Update `.gitignore` to include `config.json`.

**Files modified**:
- `app/static/app.js`
- `app/static/style.css`
- `app/main.py`
- `README.md`
- `.gitignore`

---

## Verification checklist

After completing all steps, verify the full workflow end-to-end:

- [ ] `venv/bin/python app/main.py` starts the server without errors
- [ ] Browser at `http://localhost:5000` shows the app
- [ ] Drag-and-drop a CSV — tracks appear in the table
- [ ] Click "Tag All" — progress bar advances, comments appear row by row
- [ ] Click "Stop" mid-run — tagging halts, completed tracks keep comments
- [ ] Click "Tag All" again — only untagged tracks are processed
- [ ] Click a comment to edit it inline — change is saved
- [ ] Click "Re-tag" on a single track — new comment replaces old one
- [ ] Click "Clear" on a track — comment is removed, row is highlighted
- [ ] Open Settings — modify the prompt — tag a track — verify new style
- [ ] Click "Reset to Defaults" — prompt reverts
- [ ] Click "Export CSV" — downloaded file has correct columns and data
- [ ] Upload a second CSV — replaces the first, table refreshes
