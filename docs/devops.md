# DevOps Reference — GenreTagging

A practical reference for understanding and managing the production deployment. Written to be approachable — no prior infrastructure experience assumed.

---

## How the Production Stack Works

```
You push code to GitHub (main branch)
        |
        v
GitHub Actions (automated pipeline)
  1. Builds a Docker image (packages your app + dependencies)
  2. Pushes it to Amazon ECR (a private image warehouse)
  3. SSHes into your EC2 server and:
     - Pulls the new image
     - Starts a "canary" copy alongside the old container
     - Waits for the canary to pass a health check
     - If healthy: swaps in the new container
     - If unhealthy: kills the canary, old container stays up
        |
        v
EC2 Instance (your server, ~$9/month)
  Nginx (:80) --> gunicorn (:5001) --> your Flask app
  Docker handles restart/recovery automatically
```

**In plain English**: every time you push to `main`, a robot builds your app, ships it to your server, tests the new version alongside the old one, and only swaps if the new version is healthy. If it's not working, the deploy fails but the old version keeps running — the site stays up.

---

## Safety Nets (What Keeps Things Running)

These are the layers of protection that prevent or auto-recover from problems:

### 1. Docker Health Check
- **What**: Every 30 seconds, Docker pings `http://localhost:5001/healthz` inside the container
- **Why**: If gunicorn freezes (e.g. a stuck LLM call blocks all threads), the health check detects it
- **Recovery**: After 3 consecutive failures (~90s), Docker marks the container "unhealthy". Combined with `--restart unless-stopped`, Docker restarts it automatically
- **Downtime**: ~90 seconds max. Users see a brief error, then the site comes back on its own
- **Config**: `Dockerfile` lines 32-33

### 2. Worker Recycling
- **What**: After ~500 requests, gunicorn kills and restarts its worker process
- **Why**: Prevents slow memory leaks or accumulated bad state from eventually crashing the app
- **Impact**: Zero — gunicorn handles the swap seamlessly between requests. Users don't notice
- **Config**: `Dockerfile` CMD (`--max-requests 500 --max-requests-jitter 50`)

### 3. Blue-Green Deploy with Auto-Rollback
- **What**: Before touching the live container, the deploy starts a "canary" copy of the new image on a temporary port (5002). It polls the canary's Docker health check for up to 2 minutes. If the canary is healthy, the old container is swapped out. If it's not, the canary is removed and the old container keeps running untouched
- **Why**: Prevents failed deploys from taking the site down. Before this, the deploy script would stop the old container *first*, then start the new one. If the new one couldn't boot (e.g. a hung network call during init), the site was down with no rollback
- **The lesson we learned**: A trivial CSS change (`dance.js` height tweak) triggered a deploy where gunicorn's worker hung during startup. Because the old container was already stopped, the site was down until the next manual intervention. The fix was never to stop the old container until the new image has proven it can boot
- **Config**: `.github/workflows/deploy.yml` — the `deploy` job's SSH script

### 4. Timeouts on External Calls
- **What**: All external API calls have explicit timeouts — Dropbox client at 30s global, metadata checks at 5s per-call, LLM clients (Anthropic + OpenAI) at 120s per-request
- **Why**: Without timeouts, a single hung network call can block the entire server (1 worker = 1 app = all users affected)
- **The lesson we learned**: A global 5s timeout broke audio playback (streaming needs longer). The fix was a 30s default on the Dropbox client + a targeted 5s timeout only on quick metadata checks. LLM calls get 120s (enough for complex tree-building prompts, but not infinite)
- **Config**: `app/routes.py` — `_init_dropbox_client()`, `_dropbox_file_exists()`, `_get_client()`, and `app/llm.py` async clients

### 5. Lazy Initialization
- **What**: Dropbox client and artwork cache are initialized on the first HTTP request, not at module import time
- **Why**: Module-level init runs during gunicorn worker startup. If Dropbox is slow or unreachable, the worker hangs before it can even register routes — meaning `/healthz` never becomes available, Docker marks the container unhealthy, and deploys fail with "canary went unhealthy"
- **The lesson we learned**: The site went down multiple times because `_load_dropbox_tokens()` ran at import time (when `from app.routes import api` executes in `main_flask.py`). A transient Dropbox delay during init blocked the entire worker. Moving to lazy init means gunicorn boots instantly, `/healthz` works immediately, and Dropbox connects on the first real request
- **Config**: `app/routes.py` — `_ensure_initialized()` + `@api.before_request`

### 6. Cache-Busting
- **What**: Static files (JS, CSS) include a deploy timestamp in their URLs (`?v=1710489600`)
- **Why**: Cloudflare/browser caches can serve stale files after a deploy. The timestamp forces fresh downloads
- **Config**: `app/main_flask.py` line 18 (`_boot_ts`)

---

## The Single-Worker Reality

This is the most important thing to understand about the current setup:

> **GenreTagging runs 1 gunicorn worker with 8 threads.**

This means:
- The app can handle ~8 concurrent requests (one per thread)
- Long-running operations (bulk tagging, tree building) run in **daemon threads** — they don't consume gunicorn request threads, but their LLM callbacks still use the thread pool briefly
- If many threads are busy (e.g. several LLM calls + SSE streams), new requests **queue** and eventually timeout (users see 504 errors)
- The gunicorn timeout (120s) kills stuck requests before they can accumulate. The health check + worker recycling catch longer-term issues
- 8 threads (up from 4) gives `/healthz` room to respond even during heavy LLM usage

**Why not more workers?** The app uses an in-memory `_state` dict (a Python dictionary that holds the loaded playlist, caches, etc.). Multiple workers = multiple copies of state = things break. This is fine for a single-user DJ tool.

**What this means practically**: You're unlikely to notice slowness during normal use. The 8-thread pool + daemon threads for long operations means the site stays responsive even during bulk tagging or tree building.

---

## When Things Go Wrong

### "The site is down" (502/504 errors)

**What's happening**: gunicorn is frozen or crashed. Docker's health check will auto-restart it within ~90 seconds.

**If it doesn't come back on its own** (wait at least 2-3 minutes):

1. Connect to EC2 via AWS Console:
   - AWS Console -> EC2 -> Instances -> select your instance -> Connect -> EC2 Instance Connect
2. Check what's going on:
   ```bash
   docker ps                              # Is the container running?
   docker logs genre-tagging --tail 50    # What does the app say?
   docker inspect --format='{{.State.Health.Status}}' genre-tagging   # healthy/unhealthy/starting?
   ```
3. Restart the container:
   ```bash
   docker restart genre-tagging
   ```
4. If restart doesn't help, check if the disk is full:
   ```bash
   df -h                                  # Check disk space
   du -sh /data/genre-tagging/output/*    # What's using space?
   ```

### "The deploy failed" (red X in GitHub Actions)

**Where to look**: GitHub repo -> Actions tab -> click the failed run -> click the failed job -> read the red error text.

**Common causes**:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Canary went unhealthy — aborting deploy | App can't start — import error, missing env var, or hung init. **Site is still up** (old container untouched) | Check canary logs in the GitHub Actions output, or `docker logs` on EC2 |
| Canary "starting" for all 24 attempts | Worker hanging during import (probably a network call at startup). **Site is still up** | Re-run the deploy — transient hangs usually pass. If persistent, check Dropbox/API timeouts in `routes.py` |
| ECR login failed | AWS credentials expired or misconfigured | Check GitHub Secrets |
| SSH connection refused | EC2 instance stopped or security group changed | Check AWS Console |

### "Changes aren't showing up on the site"

1. Hard-refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows) — clears browser cache
2. Check if the deploy actually ran: GitHub repo -> Actions tab. Is the latest commit there? Did it pass?
3. Check Cloudflare (if configured) — it may be serving a cached version. Purge cache in Cloudflare dashboard

### "Audio playback is broken (tracks skip instantly)"

This specific issue was caused by a timeout that was too aggressive. The Dropbox client needs time for audio streaming links. If this happens again:
- Check `_init_dropbox_client()` in `routes.py` — the `timeout` parameter applies to ALL Dropbox API calls
- Metadata checks (fast) need ~5s. Audio link generation (slower) needs more
- The per-call timeout in `_dropbox_file_exists()` is where tight timeouts should go, not on the client constructor

---

## Deploy Pipeline Explained

Every push to `main` triggers this (`.github/workflows/deploy.yml`):

### Job 1: Build & Push Docker Image (~45s)
1. Checks out your code
2. Logs into Amazon ECR (image warehouse)
3. Builds a Docker image from your `Dockerfile`
4. Tags it with the commit SHA and `latest`
5. Pushes both tags to ECR

### Job 2: Deploy to EC2 (~2-3 min)
1. SSHes into your EC2 instance
2. Logs Docker into ECR (so it can pull images)
3. Pulls the new `latest` image
4. Starts a **canary container** (`genre-tagging-canary`) on port 5002 — the old container keeps running on 5001
5. Polls the canary's Docker health check for up to 2 minutes
6. **If canary is healthy**: stops the old container, starts the proven image as `genre-tagging` on port 5001
7. **If canary is unhealthy**: removes the canary, old container untouched, deploy fails (site stays up)
8. Cleans up old images to save disk space

**Downtime**: There's a brief window (~5-15 seconds) during step 6 while swapping containers. This only happens on *successful* deploys. Failed deploys cause **zero downtime** — the old container keeps serving.

---

## Key Files

| File | What it does |
|------|-------------|
| `Dockerfile` | How the Docker image is built — base image, dependencies, health check, startup command |
| `.github/workflows/deploy.yml` | The automated build-and-deploy pipeline |
| `.dockerignore` | Files excluded from the Docker image (keeps it small and safe) |
| `app/main_flask.py:36-39` | The `/healthz` health check endpoint |
| `.claude/plans/aws-deployment.md` | Full setup guide — AWS Console steps, server config, secrets |

---

## Useful Commands (on EC2 via Instance Connect)

```bash
# Container status
docker ps                                    # Running containers
docker ps -a                                 # All containers (including stopped)
docker inspect --format='{{.State.Health.Status}}' genre-tagging

# Logs
docker logs genre-tagging --tail 100         # Last 100 lines
docker logs genre-tagging --tail 100 -f      # Live tail (Ctrl+C to stop)
tail -f /data/genre-tagging/output/app.log   # App-level log file

# Restart / recover
docker restart genre-tagging                 # Graceful restart
docker stop genre-tagging && docker rm genre-tagging  # Full stop (need to re-run docker run)

# Disk
df -h                                        # Disk usage overview
du -sh /data/genre-tagging/output/artwork/   # Artwork cache size
docker system prune -f                       # Clean up Docker cruft

# Check what's deployed
docker inspect genre-tagging | grep Image    # Which image is running
```

---

## Incident Log

Record what went wrong and what fixed it. Patterns help predict future issues.

### 2026-03-15 — Site down (504), frozen worker
- **Symptom**: 504 errors, site unreachable
- **Cause**: gunicorn's single worker froze (likely a stuck LLM or Dropbox call blocking all 4 threads)
- **Fix**: Restarted container via EC2 Instance Connect
- **Prevention added**: Docker health check (`/healthz` every 30s, auto-restart after 3 failures), worker recycling (every ~500 requests)

### 2026-03-15 — Deploy failing, health check timeout
- **Symptom**: Deploy script reported "Health check failed after 10 attempts", container showed "starting" for all attempts
- **Cause**: Deploy script only waited 50s, but Docker HEALTHCHECK needs ~70s+ to transition from "starting" to "healthy" (`start-period=10s + interval=30s`). The failure was intermittent — same code had deployed successfully before
- **Fix**: Increased deploy health check loop from 10 attempts (50s) to 24 attempts (2 minutes)
- **Lesson**: The deploy wait time must exceed Docker's `start-period + interval` to see the first real health status

### 2026-03-15 — Audio playback broken (tracks skip instantly)
- **Symptom**: Tracks skip immediately instead of playing
- **Cause**: A `timeout=5` added to the Dropbox client constructor applied to ALL API calls, including `files_get_temporary_link` (audio streaming), which needs more than 5s
- **Fix**: Removed tight timeout from constructor (set to 10s default), added targeted 5s timeout only on `_dropbox_file_exists()` metadata checks using `ThreadPoolExecutor`
- **Lesson**: Global timeouts are dangerous — always scope them to the specific calls that need them

### 2026-03-15 — Site down after failed deploy (no rollback)
- **Symptom**: Site completely unreachable after deploying a trivial CSS change (`dance.js` height 200→300). GitHub Actions showed "Health check failed after 24 attempts"
- **Cause**: gunicorn master started but the worker never booted (hung during init — likely a transient Dropbox/network call). The deploy script had already stopped and removed the old (working) container before starting the new one, so there was nothing to fall back to
- **Root issue**: The deploy pipeline was "stop first, start second" — any startup failure left the site with no running container
- **Fix**: Implemented blue-green deploy — new image is tested as a canary container on a temp port before touching the live container. If the canary fails, the old container stays running. Failed deploys now cause zero downtime
- **Lesson**: Never stop the working container until the replacement has proven it can boot. Infrastructure changes should never assume the new version will start successfully

### 2026-03-16 — Site down (ERR_CONNECTION_TIMED_OUT), recurring worker hang
- **Symptom**: `ERR_CONNECTION_TIMED_OUT` in browser, site completely unreachable
- **Cause**: gunicorn worker frozen again — same root pattern as the 2026-03-15 incidents. Docker health check detected it and marked the container unhealthy, but `--restart unless-stopped` wasn't recovering it cleanly
- **Immediate fix**: Manual container restart via EC2 Instance Connect (`docker restart genre-tagging`)
- **Root cause analysis**: Three architectural issues made hangs recurring: (1) module-level Dropbox init could freeze the worker before routes registered, (2) no timeouts on LLM/Dropbox calls meant individual requests could hang indefinitely, (3) 600s gunicorn timeout was far too generous — a stuck thread stayed alive for 10 minutes before being killed
- **Permanent fixes applied**:
  1. **Lazy initialization**: Dropbox client + artwork cache now init on first request, not at import time. gunicorn boots instantly, `/healthz` works immediately
  2. **Timeouts everywhere**: Dropbox client 30s global, metadata checks 5s per-call, LLM clients (Anthropic/OpenAI) 120s per-request
  3. **Reduced gunicorn timeout**: 600s → 120s. Stuck requests die in 2 minutes, not 10
  4. **More threads**: 4 → 8. Gives `/healthz` room to respond even during heavy LLM usage
- **Lesson**: Defence in depth — no single fix prevents all hangs, but the combination of lazy init + timeouts + faster kill + more headroom makes the system self-healing. The 600s timeout was the biggest mistake — it let a single stuck thread hold a slot for 10 minutes

---

## Future Improvements

- [x] ~~**Blue-green deploy with rollback**: Test new image as canary before swapping — failed deploys no longer take the site down~~ *(done 2026-03-15)*
- [x] ~~**Lazy init + timeouts + reduced gunicorn timeout**: Prevent recurring worker hangs from module-level Dropbox init and untimed external calls~~ *(done 2026-03-16)*
- [ ] **Monitoring/alerts** *(recommended next — `GenreTagging-2u3`)* : Set up uptime monitoring (e.g. UptimeRobot free tier) to get notified when the site goes down, instead of discovering it manually. Blue-green prevents deploy-caused downtime, but runtime crashes or server issues still need external detection
- [ ] **HTTPS/SSL**: Add a domain + Let's Encrypt certificate via Certbot
- [ ] **GitHub Actions Node.js 20 warning**: Update `actions/checkout` and `aws-actions/configure-aws-credentials` to versions supporting Node.js 24 (deadline: June 2026)
- [ ] **Log rotation on EC2**: The `app.log` file rotates automatically (2MB x 3 backups), but Docker container logs grow unbounded. Add `--log-opt max-size=10m --log-opt max-file=3` to the `docker run` command
- [ ] **Architectural simplification**: The single-worker + in-memory `_state` dict is the fundamental constraint. Future options include moving state to Redis/SQLite (enabling multiple workers), or splitting long-running LLM operations into a separate process/queue
