# GenreTagging — Architecture Review & Deployment Plan

> **Date:** February 2026
> **Purpose:** Assess the health of the codebase before deploying to AWS and building further features. Identify technical debt, security concerns, and improvement opportunities.

---

## Table of Contents

1. [Current Architecture Overview](#1-current-architecture-overview)
2. [Backend Review](#2-backend-review)
3. [Frontend Review](#3-frontend-review)
4. [Recommended Improvements](#4-recommended-improvements)
5. [AWS Deployment Plan](#5-aws-deployment-plan)

---

## 1. Current Architecture Overview

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask 3.1 (Python 3.13) |
| Frontend | Vanilla JS, AG Grid, D3.js (all CDN) |
| Data store | In-memory pandas DataFrame + JSON files on disk |
| LLM integration | OpenAI + Anthropic SDKs, provider auto-detected from model name |
| Audio | Dropbox API (optional), Deezer CDN for artwork/previews |

### Application Structure

```
GenreTagging/
├── app/
│   ├── main.py              (37 lines)   — Flask app factory, entry point
│   ├── routes.py           (3,567 lines)  — ALL route handlers + helpers
│   ├── tree.py             (2,676 lines)  — Tree building pipelines (genre, scene, collection)
│   ├── setbuilder.py         (674 lines)  — DJ set workshop backend
│   ├── parser.py             (582 lines)  — Comment string parsing
│   ├── playlist.py           (462 lines)  — Playlist CRUD + persistence
│   ├── tagger.py              (66 lines)  — LLM genre tagging
│   ├── config.py              (42 lines)  — Config load/save with defaults
│   ├── phases.py             (249 lines)  — Phase profile management
│   ├── static/
│   │   ├── app.js          (1,022 lines)  — Main UI: grid, upload, tagging, artwork
│   │   ├── workshop.js     (1,871 lines)  — Playlists, intersections, search, suggestions
│   │   ├── tree.js         (1,436 lines)  — Tree rendering (genre, scene, collection)
│   │   ├── setbuilder.js   (2,959 lines)  — Set workshop UI
│   │   ├── phases.js         (426 lines)  — Phase profile editor
│   │   └── style.css       (3,263 lines)  — All styles
│   └── templates/
│       └── index.html                     — Single-page shell
├── output/                                — Persistent data (JSON, artwork, autosave CSVs)
├── config.json                            — User config (gitignored)
├── requirements.txt                       — Python dependencies
└── .env                                   — API keys (gitignored)
```

**Total:** ~8,350 lines Python, ~10,977 lines JS/CSS

### Data Flow

```
CSV Upload → pandas DataFrame (_state["df"]) → LLM Tagging → Comment field populated
                    ↓                                              ↓
              Autosave to disk                              Tree building (LLM pipeline)
              (output/*_autosave.csv)                       (output/*_tree.json)
                    ↓                                              ↓
              Restore on restart                            Playlist generation
                                                            Set workshop selection
```

### State Management

All session state lives in a single module-level dictionary in `routes.py`:

```python
_state = {
    "df": None,                          # Main DataFrame (tracks)
    "original_filename": None,           # Uploaded CSV name
    "tagging_thread": None,              # Active tagging thread
    "stop_flag": threading.Event(),      # Tagging stop signal
    "progress_listeners": [],            # SSE listeners for tagging
    "tree_thread": None,                 # Genre tree build thread
    "tree_stop_flag": threading.Event(),
    "tree_progress_listeners": [],
    "scene_tree_thread": None,           # Scene tree build thread
    "scene_tree_stop_flag": ...,
    "scene_tree_progress_listeners": [],
    "collection_tree": None,             # Collection tree data
    "collection_tree_thread": None,
    "collection_tree_stop_flag": ...,
    "collection_tree_progress_listeners": [],
    "_analysis_cache": None,             # Workshop analysis cache
    "_preview_cache": {},                # Audio preview URL cache
    "_artwork_cache": {},                # Artwork URL cache
    "_chord_cache": None,                # Chord diagram cache
    "_dropbox_client": None,             # Dropbox API client
    # ... more keys
}
```

**Persistence:** The DataFrame auto-saves to `output/<filename>_autosave.csv` after uploads and tagging operations. On page refresh, `/api/restore` reloads from this file. Tree data, playlists, and sets persist as JSON files in `output/`.

---

## 2. Backend Review

### 2.1 File Size Concerns

| File | Lines | Verdict |
|------|-------|---------|
| `routes.py` | 3,567 | **Critical** — 43% of backend code in one file |
| `tree.py` | 2,676 | **Warning** — 10 functions exceed 100 lines |
| `setbuilder.py` | 674 | **Warning** — 1 function at 101 lines |
| `parser.py` | 582 | Acceptable — domain-specific parsing |
| `playlist.py` | 462 | Good |
| `phases.py` | 249 | Good |
| `tagger.py` | 66 | Good |

### 2.2 routes.py — God Object

`routes.py` contains **99 route handlers** and **40+ helper functions** spanning every feature domain:

| Domain | Routes | Examples |
|--------|--------|----------|
| Upload & restore | 2 | `/api/upload`, `/api/restore` |
| Tagging | 8 | `/api/start-tagging`, `/api/tagging-progress` |
| Config | 3 | `/api/config`, `/api/save-config` |
| Workshop (playlists) | 19 | `/api/workshop/*` (analysis, suggest, search) |
| Tree building | 21 | `/api/tree/*`, `/api/scene-tree/*`, `/api/collection-tree/*` |
| Artwork & preview | 13 | `/api/artwork/*`, `/api/preview/*` |
| Set workshop | 12 | `/api/set-workshop/*` |
| Saved sets | 5 | `/api/saved-sets/*` |
| Dropbox | 3 | `/api/dropbox/*` |
| Phase profiles | 6 | `/api/phase-profiles/*` |

**Problem:** Every new feature adds more routes to this file. Business logic is mixed directly into route handlers rather than delegated to service modules.

**Largest functions in routes.py:**

| Function | Lines | Issue |
|----------|-------|-------|
| `workshop_suggest()` | 107 | 6 suggestion modes with complex filtering, all inline |
| `set_workshop_refill_bpm()` | 101 | Track pool selection + BPM filtering logic |
| `_lookup_artwork()` | 76 | Deezer/iTunes API calls + caching |
| `collection_tree_build()` | 74 | Thread spawning + config + progress setup |
| `_warm_cache_worker()` | 67 | Background artwork download worker |
| `get_preview()` | 62 | Deezer API + caching |

### 2.3 Thread Safety Issues

The `_state` dictionary is accessed **~147 times** across `routes.py` with almost no synchronisation:

**Only one lock exists** — `_artwork_cache_lock` for the artwork cache. All other mutations are unprotected:

```python
# UNSAFE: List mutation in _broadcast() while other threads may be iterating
def _broadcast(data):
    dead = []
    for q in _state["progress_listeners"]:    # Read without lock
        try:
            q.put_nowait(data)
        except queue.Full:
            dead.append(q)
    for q in dead:
        _state["progress_listeners"].remove(q) # Mutation without lock
```

This same pattern is repeated in `_tree_broadcast()`, `_scene_tree_broadcast()`, and `_collection_tree_broadcast()` — all vulnerable to `RuntimeError: list changed size during iteration`.

**DataFrame race conditions:** `_state["df"]` is mutated by the tagging thread (writing comments), while the upload route, tree-build routes, and set workshop routes all read from it concurrently.

**11 daemon threads are started, 0 are joined.** No cleanup on shutdown — threads may be mid-operation when the process exits.

### 2.4 Duplicated LLM Patterns

The provider-routing pattern is reimplemented in every module that calls an LLM:

```python
# This exact pattern appears in tree.py, tagger.py, and routes.py:
if provider == "anthropic":
    response = client.messages.create(model=model, system=system, messages=[...])
    return response.content[0].text.strip()
else:
    response = client.chat.completions.create(model=model, messages=[...])
    return response.choices[0].message.content.strip()
```

Each module also independently detects the provider from the model name, initialises retry logic with `tenacity`, and extracts JSON from responses.

### 2.5 Security Concerns

**Path traversal in artwork serving:**
```python
@api.route("/artwork/<path:filename>")
def serve_artwork(filename):
    fpath = os.path.join(_ARTWORK_DIR, filename)
    # No validation — "../../etc/passwd" would resolve outside _ARTWORK_DIR
```

**Mitigation:** Validate filename matches expected format (`^[a-f0-9]{32}_(small|big)\.jpg$`).

**Input validation:** Most route handlers extract request parameters without schema validation. While this is low-risk for a single-user app, it becomes a concern if ever exposed publicly.

### 2.6 Other Backend Issues

- **`caffeinate` calls:** Already handled gracefully with try/except — works on Linux/containers.
- **`config.json` loading:** Falls back to `DEFAULT_CONFIG` if file missing — good.
- **JSON serialization:** numpy int64 values need `.item()` conversion — known gotcha, handled with `_safe_val()`.

---

## 3. Frontend Review

### 3.1 File Size Concerns

| File | Lines | Verdict |
|------|-------|---------|
| `style.css` | 3,263 | **Critical** — monolithic, no feature separation |
| `setbuilder.js` | 2,959 | **Critical** — too many responsibilities |
| `workshop.js` | 1,871 | **Warning** — duplicated render functions |
| `tree.js` | 1,436 | **Warning** — recursive rendering complexity |
| `app.js` | 1,022 | Acceptable |
| `phases.js` | 426 | Good — cleanest file, single responsibility |

### 3.2 No Module System

All JavaScript files are loaded as separate `<script>` tags with everything in the global scope. There is no bundler, no ES modules, no namespacing.

**Consequences:**
- 21+ global variables in `app.js`, 14 in `workshop.js`, 17+ in `setbuilder.js`
- Functions in one file call globals from another (e.g., `workshop.js` calls `escapeHtml()` from `app.js`)
- Risk of accidental variable shadowing
- No tree-shaking or dead code elimination

### 3.3 setbuilder.js — Most Complex File

At 2,959 lines, `setbuilder.js` handles:
- Slot state management (track arrays, selected indices)
- Drawer UI (browse, detail, search, now-playing modes)
- Drag & drop
- Preview-all and play-set audio state machines
- Energy wave animation (Catmull-Rom splines, 6 sine layers)
- Auto-save with debouncing
- BPM grid rendering
- Key row rendering with Camelot wheel colours
- Phase row with segment management

17+ global variables manage this state with no encapsulation.

### 3.4 Duplicated Code

**Scored vs. normal search results:** `renderScoredSearchResults()` and `renderSearchResults()` in `workshop.js` are each ~130 lines and ~90% identical, differing only in score badge display. Should be a single parameterised function.

**Exemplar track HTML:** Generated in 4 separate places across `tree.js` and `workshop.js` with minimal variation.

**Preview button listeners:** The same preview-toggle pattern is wired up independently in `app.js`, `workshop.js`, `tree.js`, and `setbuilder.js`.

**HTML escaping:** `escapeHtml()` in `app.js` and `esc()` in `tree.js` are independent implementations. Some calls defensively check which exists.

### 3.5 Memory Leaks

| Issue | Location | Severity |
|-------|----------|----------|
| Event listeners re-attached on every render (search results) | `workshop.js` | High |
| Node expansion listeners accumulate on toggle | `tree.js` | Medium |
| Audio element listeners never removed | `app.js` | Medium |
| Polling timers not cleared on navigation | `app.js` | Medium |
| IntersectionObserver never disconnected | `app.js` | Low |

### 3.6 Silent Error Handling

Throughout the frontend, errors are caught and logged to console but the user sees nothing:

```javascript
// Typical pattern — user sees a frozen UI
catch (_) { /* ignore */ }
catch (e) { console.error("search failed", e); }
```

There is a `showToast()` function available but it's rarely used for error cases. Failed artwork loads, search failures, and save failures all fail silently.

### 3.7 style.css — Monolithic Styles

3,263 lines in a single flat CSS file. CSS custom properties are defined in `:root` but many colours are still hardcoded inline throughout. No responsive design rules exist — the layout is fixed-width. Class naming uses feature prefixes (`.ws-`, `.set-`, `.tree-`, `.collection-`) which is good, but inconsistent between features.

### 3.8 Hardcoded Magic Numbers

Timeouts, batch sizes, thresholds, and limits are scattered throughout all JS files as bare numeric literals:

```javascript
// Examples found across the codebase
300    // search debounce (ms) — setbuilder.js
1000   // auto-save timeout (ms) — setbuilder.js
0.08   // chord threshold — workshop.js
12     // max lineages — workshop.js
25     // playlist target count — workshop.js
40     // artwork batch size — app.js
200    // max search results — workshop.js
```

No configuration object or constants file exists.

---

## 4. Recommended Improvements

### Phase 1 — Security & Correctness (do first)

| Issue | Fix | Effort |
|-------|-----|--------|
| Path traversal in `serve_artwork()` | Validate filename against regex before serving | Small |
| Broadcast race conditions | Add `threading.Lock` around all `_state["*_listeners"]` list mutations | Small |
| DataFrame race conditions | Add a `_state_lock` for `_state["df"]` reads/writes | Medium |
| Thread joins on shutdown | Register `atexit` handler to signal stop flags and join daemon threads | Small |

### Phase 2 — Split the Monoliths

**Backend — Split `routes.py` into domain blueprints:**

```
app/
├── routes/
│   ├── __init__.py          — Register all blueprints
│   ├── upload.py            — Upload, restore (2 routes)
│   ├── tagging.py           — Tagging start/stop/progress (8 routes)
│   ├── workshop.py          — Playlist workshop (19 routes)
│   ├── trees.py             — All tree building (21 routes)
│   ├── artwork.py           — Artwork & preview serving (13 routes)
│   ├── sets.py              — Set workshop + saved sets (17 routes)
│   ├── config_routes.py     — Config + phase profiles (9 routes)
│   └── dropbox.py           — Dropbox auth (3 routes)
├── state.py                 — _state dict + thread-safe accessors
├── llm.py                   — Shared LLMClient (provider routing, retry, JSON extraction)
└── background.py            — BackgroundTaskRunner (thread lifecycle, progress broadcast)
```

Each blueprint would import from `state.py` instead of accessing module-level globals. Business logic currently inline in route handlers would move to the existing service modules (`tree.py`, `playlist.py`, `setbuilder.py`, `tagger.py`).

**Frontend — Split large files:**

```
app/static/
├── app.js                   — Core: grid, upload, tab switching
├── artwork.js               — (extracted) Artwork caching, warm-cache, IntersectionObserver
├── audio.js                 — (extracted) Preview player, play-all state machine
├── workshop.js              — Playlists, intersections, suggestions
├── search.js                — (extracted) Track search + render (deduplicated)
├── tree.js                  — Tree rendering
├── setbuilder.js            — Set workshop core
├── setbuilder-render.js     — (extracted) BPM grid, key row, energy wave rendering
├── setbuilder-audio.js      — (extracted) Play-set, preview-all
├── phases.js                — Phase profiles (already clean)
├── constants.js             — (new) All magic numbers, timeouts, batch sizes
└── helpers.js               — (new) escapeHtml, shared utilities
```

**CSS — Split by feature:**

```
app/static/
├── style.css                — Base: reset, layout, variables, buttons, modals
├── workshop.css             — Playlist workshop styles
├── tree.css                 — Tree visualisation styles
├── set-workshop.css         — Set builder styles
└── components.css           — Shared components (cards, badges, popovers)
```

### Phase 3 — Extract Shared Abstractions

**LLMClient** — single module replacing duplicated provider routing:
```python
# app/llm.py
class LLMClient:
    def __init__(self, model, api_keys):
        self.provider = "anthropic" if model.startswith("claude") else "openai"
        # ... initialise correct client

    @retry(wait=wait_exponential(...), stop=stop_after_attempt(3))
    def call(self, system_prompt, user_prompt, max_tokens=4096):
        # Provider-specific call + response extraction
        ...

    def call_json(self, system_prompt, user_prompt, **kwargs):
        # call() + JSON extraction + validation
        ...
```

Used by `tree.py`, `tagger.py`, and `playlist.py` instead of each reimplementing the pattern.

**BackgroundTaskRunner** — standardise the 4+ places that spawn daemon threads:
```python
# app/background.py
class BackgroundTask:
    def __init__(self, name, target_fn, progress_callback):
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        # ...

    def start(self): ...
    def stop(self): ...
    def join(self, timeout=5): ...
```

**JsonPersistenceStore** — replace duplicated global dict + load/save in `playlist.py` and `setbuilder.py`:
```python
# app/persistence.py
class JsonStore:
    def __init__(self, filepath):
        self.filepath = filepath
        self.data = self._load()

    def _load(self): ...
    def save(self): ...
```

### Phase 4 — Frontend Health

| Issue | Fix | Effort |
|-------|-----|--------|
| Magic numbers everywhere | Create `constants.js` with named exports | Small |
| Silent error handling | Replace `catch(ignore)` with `showToast("error", msg)` | Small |
| Duplicated search rendering | Merge into single `renderSearchResults(options)` | Medium |
| Duplicated exemplar HTML | Extract `renderExemplarTracks(tracks)` helper | Small |
| Event listener leaks | Use event delegation on stable parent elements | Medium |
| Shared helpers | Create `helpers.js` with `escapeHtml`, `debounce`, etc. | Small |
| CSS colour consistency | Move all hardcoded colours into `:root` variables | Small |

### What to Leave Alone

- **No framework migration** — vanilla JS is fine for this app's complexity level. Adding React/Vue would be over-engineering.
- **No TypeScript** — the effort vs. benefit doesn't justify it for a single-user tool.
- **No bundler** — separate `<script>` tags work. The frontend is small enough that HTTP/2 handles it fine.
- **No database** — file-based JSON + DataFrame autosave is appropriate for single-user.
- **`tree.py` internal complexity** — the 10 long functions reflect genuinely complex LLM pipelines. They can be tidied but shouldn't be artificially split.

---

## 5. AWS Deployment Plan

### Architecture

```
GitHub (push to main)
        │
        ▼
GitHub Actions
  ├─ Build Docker image
  ├─ Push to Amazon ECR
  └─ SSH → EC2: pull & restart
        │
        ▼
EC2 Instance (t3.micro, ~$9/mo)
  ├─ Nginx (:80) ──proxy──▶ Gunicorn (:5001)
  ├─ Docker container
  │   ├─ Flask app (1 worker, 4 threads)
  │   ├─ /app/output/ → volume mount (persistent data)
  │   └─ .env → API keys
  └─ Public IP: http://x.x.x.x
```

### Files to Create

**1. `requirements.txt`** — add gunicorn:
```
anthropic==0.78.0
dropbox>=12.0.0
flask==3.1.0
gunicorn==23.0.0
openai==2.17.0
pandas==3.0.0
python-dotenv==1.2.1
tenacity==9.1.3
```

**2. `Dockerfile`:**
```dockerfile
FROM python:3.13-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY data/ data/

RUN mkdir -p output

EXPOSE 5001

# 1 worker required — _state is in-memory, multiple workers = multiple copies
# 4 threads — handles concurrent requests (artwork, SSE, etc.)
# 300s timeout — LLM calls (tree building, tagging) can take minutes
CMD ["gunicorn", \
     "--workers", "1", \
     "--threads", "4", \
     "--worker-class", "gthread", \
     "--timeout", "300", \
     "--bind", "0.0.0.0:5001", \
     "app.main:app"]
```

**3. `.dockerignore`:**
```
venv/
.git/
.env
config.json
output/
__pycache__/
*.pyc
.DS_Store
.ipynb_checkpoints/
notebooks/
docs/
*.md
.claude/
secrets.txt
```

**4. `.github/workflows/deploy.yml`:**
```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: genre-tagging

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            aws ecr get-login-password --region us-east-1 | \
              docker login --username AWS --password-stdin ${{ steps.ecr-login.outputs.registry }}

            docker pull ${{ steps.ecr-login.outputs.registry }}/genre-tagging:latest

            docker stop genre-tagging 2>/dev/null || true
            docker rm genre-tagging 2>/dev/null || true

            docker run -d \
              --name genre-tagging \
              --restart unless-stopped \
              -p 5001:5001 \
              -v /data/genre-tagging/output:/app/output \
              -v /data/genre-tagging/config.json:/app/config.json \
              --env-file /data/genre-tagging/.env \
              ${{ steps.ecr-login.outputs.registry }}/genre-tagging:latest

            docker image prune -f
```

**5. `config.json.example`:**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "delay_between_requests": 1.5,
  "audio_path_map_enabled": false,
  "audio_path_from": "",
  "audio_path_to": "",
  "dropbox_path_prefix": ""
}
```

### AWS Console Setup (one-time)

#### Step 1: Create ECR Repository

1. AWS Console → search "ECR" → Elastic Container Registry
2. **Create repository**
   - Visibility: Private
   - Name: `genre-tagging`
3. Note the repository URI (e.g. `123456789012.dkr.ecr.us-east-1.amazonaws.com/genre-tagging`)

#### Step 2: Create IAM User for GitHub Actions

1. AWS Console → IAM → Users → **Create user**
2. Name: `github-actions-deployer` (no console access)
3. Attach a new inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:us-east-1:*:repository/genre-tagging"
    }
  ]
}
```

4. Create an **access key** (Third-party service) — save both the key ID and secret

#### Step 3: Create EC2 Key Pair

1. EC2 → Key pairs → **Create key pair**
2. Name: `genre-tagging-key`, Type: RSA, Format: `.pem`
3. Move the downloaded file:
   ```bash
   mv ~/Downloads/genre-tagging-key.pem ~/.ssh/
   chmod 400 ~/.ssh/genre-tagging-key.pem
   ```

#### Step 4: Create Security Group

1. EC2 → Security Groups → **Create security group**
2. Name: `genre-tagging-sg`
3. Inbound rules:

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | My IP | SSH access |
| HTTP | 80 | 0.0.0.0/0 | Web traffic |

Port 5001 is NOT exposed — Nginx proxies port 80 → 5001 internally.

#### Step 5: Launch EC2 Instance

1. EC2 → **Launch instance**
   - Name: `genre-tagging`
   - AMI: Amazon Linux 2023
   - Instance type: **t3.micro** (2 vCPU, 1 GB RAM — ~$7.50/mo)
   - Key pair: `genre-tagging-key`
   - Security group: `genre-tagging-sg`
   - Storage: **20 GB gp3** (~$1.60/mo — covers Docker images + artwork cache)
2. Note the **Public IPv4 address**

> **Upgrading:** If 1 GB RAM is too tight with large DataFrames, switch to t3.small (2 GB, ~$15/mo).

#### Step 6: Add GitHub Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → add:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM access key from Step 2 |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key from Step 2 |
| `EC2_HOST` | Public IP from Step 5 |
| `EC2_SSH_KEY` | Full contents of `genre-tagging-key.pem` |

### EC2 Server Setup (one-time, via SSH)

```bash
ssh -i ~/.ssh/genre-tagging-key.pem ec2-user@YOUR_EC2_IP
```

#### Install Docker

```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
exit  # Log out and back in for group change
```

#### Install and Configure Nginx

```bash
sudo dnf install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

Create `/etc/nginx/conf.d/genre-tagging.conf`:

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;          # CSV uploads

    proxy_read_timeout 600;            # LLM calls can be slow
    proxy_connect_timeout 60;
    proxy_send_timeout 600;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (tagging progress, tree build progress)
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

```bash
sudo rm -f /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl restart nginx
```

#### Create Persistent Data Directory

```bash
sudo mkdir -p /data/genre-tagging/output
sudo chown -R ec2-user:ec2-user /data/genre-tagging
```

#### Create .env File

```bash
cat > /data/genre-tagging/.env << 'EOF'
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
# Optional:
# DROPBOX_APP_KEY=your-key
# DROPBOX_APP_SECRET=your-secret
EOF
chmod 600 /data/genre-tagging/.env
```

#### Create config.json

```bash
cat > /data/genre-tagging/config.json << 'EOF'
{
  "model": "claude-sonnet-4-5-20250929",
  "delay_between_requests": 1.5,
  "audio_path_map_enabled": false,
  "audio_path_from": "",
  "audio_path_to": "",
  "dropbox_path_prefix": ""
}
EOF
```

#### Transfer Existing Data (optional)

From your Mac — transfers playlists, trees, saved sets (~8 MB, excludes artwork):

```bash
rsync -avz --progress \
  --exclude='artwork/' \
  --exclude='app.log*' \
  --exclude='dropbox_tokens.json' \
  --exclude='.DS_Store' \
  -e "ssh -i ~/.ssh/genre-tagging-key.pem" \
  ./output/ \
  ec2-user@YOUR_EC2_IP:/data/genre-tagging/output/
```

Artwork (258 MB) is intentionally excluded — the app's warm-cache mechanism will re-download from Deezer CDN automatically on first page load.

### Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| EC2 t3.micro | ~$7.50 |
| EBS 20 GB gp3 | ~$1.60 |
| ECR storage (~500 MB) | ~$0.05 |
| Data transfer | ~$0.10 |
| **Total** | **~$9.25** |

### Operational Notes

**View logs:**
```bash
docker logs genre-tagging --tail 100 -f
```

**Restart after config change:**
```bash
nano /data/genre-tagging/.env   # edit API keys
docker restart genre-tagging
```

**Elastic IP (recommended):** By default, the public IP changes when you stop/start the instance. Allocate an Elastic IP (EC2 → Elastic IPs → Allocate → Associate) for a fixed address. Free while the instance is running.

**Weekly backup cron:**
```bash
cat > /data/genre-tagging/backup.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR=/data/genre-tagging/backups
mkdir -p "$BACKUP_DIR"
tar czf "$BACKUP_DIR/output-$(date +%Y%m%d).tar.gz" -C /data/genre-tagging output/
ls -t "$BACKUP_DIR"/output-*.tar.gz | tail -n +5 | xargs rm -f 2>/dev/null
SCRIPT
chmod +x /data/genre-tagging/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * 0 /data/genre-tagging/backup.sh") | crontab -
```
