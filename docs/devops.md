# DevOps Reference — GenreTagging

A practical reference for understanding and managing the production deployment. Written to be approachable — no prior infrastructure experience assumed.

---

## How the Production Stack Works

```
You click "Run workflow" in GitHub Actions
        |
        v
GitHub Actions (manual deploy pipeline)
  1. Builds a Docker image (packages your app + dependencies)
  2. Pushes it to Amazon ECR (a private image warehouse)
  3. SSHes into your EC2 server and:
     - Pulls the new image
     - Starts a "canary" copy alongside the old container
     - Waits for the canary's /ready endpoint to confirm init
     - If ready: swaps in the new container
     - If not ready: kills the canary, old container stays up
     - If new container fails after swap: rolls back to previous image
        |
        v
EC2 Instance (your server, t3.small ~$17/month)
  Nginx (:80) --> gunicorn (:5001) --> your Flask app
  Docker handles restart/recovery automatically
```

**In plain English**: when you're ready to deploy, you click the "Run workflow" button in GitHub Actions. A robot builds your app, ships it to your server, tests the new version alongside the old one, and only swaps if the new version is healthy. If the new version fails even after swapping, it rolls back to the previous image automatically. Pushes to `main` do NOT trigger deploys — this was changed after repeated outages caused by auto-deploying every commit.

---

## Safety Nets (What Keeps Things Running)

These are the layers of protection that prevent or auto-recover from problems:

### 1. Self-Healing Health Check
- **What**: Every 30 seconds, a custom script (`healthcheck.sh`) pings `http://localhost:5001/healthz` inside the container
- **Why**: If gunicorn freezes (e.g. a stuck LLM call blocks all threads, or the worker hangs during boot), the health check detects it
- **Recovery**: After 5 consecutive failures (~2.5 min), the script kills gunicorn (PID 1), which causes the container to exit, which triggers Docker's `--restart unless-stopped` policy to restart it automatically
- **Why a script instead of plain curl?**: Docker's `--restart unless-stopped` only fires when a container *exits*, NOT when it's marked "unhealthy". Without the script, a frozen container would sit "unhealthy" forever and never restart. The script bridges that gap by killing the process after sustained failures
- **Downtime**: ~2.5 minutes max. Users see errors, then the site comes back on its own
- **Config**: `healthcheck.sh`, `Dockerfile` lines 30-37

### 2. Worker Recycling
- **What**: After ~500 requests, gunicorn kills and restarts its worker process
- **Why**: Prevents slow memory leaks or accumulated bad state from eventually crashing the app
- **Impact**: Zero — gunicorn handles the swap seamlessly between requests. Users don't notice
- **Config**: `Dockerfile` CMD (`--max-requests 500 --max-requests-jitter 50`)

### 3. Blue-Green Deploy with Auto-Rollback
- **What**: Before touching the live container, the deploy starts a "canary" copy of the new image on a temporary port (5002). It polls the canary's `/ready` endpoint for up to 2 minutes — this triggers lazy init and confirms the app can actually serve. If ready, the old container is swapped out. If not, the canary is removed and the old container keeps running untouched. If the new production container fails to become ready after the swap, the deploy script **automatically rolls back** to the previous image
- **Why**: Prevents failed deploys from taking the site down. Before this, the deploy script would stop the old container *first*, then start the new one. If the new one couldn't boot (e.g. a hung network call during init), the site was down with no rollback. The emergency rollback was added after the 2026-03-18 incident where a failed deploy left the site with no running container at all
- **The lesson we learned**: A trivial CSS change (`dance.js` height tweak) triggered a deploy where gunicorn's worker hung during startup. Because the old container was already stopped, the site was down until the next manual intervention. The fix was never to stop the old container until the new image has proven it can boot. The rollback was added because even a "proven" canary can fail when promoted to production (different port, timing, memory pressure)
- **Config**: `.github/workflows/deploy.yml` — the `deploy` job's SSH script

### 4. Timeouts on External Calls
- **What**: All external API calls have explicit timeouts — Dropbox client at 30s global, metadata checks at 5s per-call, LLM clients (Anthropic + OpenAI) at 120s per-request
- **Why**: Without timeouts, a single hung network call can block the entire server (1 worker = 1 app = all users affected)
- **The lesson we learned**: A global 5s timeout broke audio playback (streaming needs longer). The fix was a 30s default on the Dropbox client + a targeted 5s timeout only on quick metadata checks. LLM calls get 120s (enough for complex tree-building prompts, but not infinite)
- **Config**: `app/routes.py` — `_init_dropbox_client()`, `_dropbox_file_exists()`, `_get_client()`, and `app/llm.py` async clients

### 5. Lazy Initialization
- **What**: ALL I/O (Dropbox tokens, artwork cache, playlist loading, artwork directory creation) is deferred to the first request via a unified `_ensure_initialized()` function. Zero disk or network I/O at import time
- **Why**: Module-level init runs during gunicorn worker startup. If any I/O is slow (Dropbox, EBS volume, filesystem), the worker hangs before it can register routes — `/healthz` never responds, and the container appears frozen
- **The lesson we learned**: This bug was fixed three separate times for three separate functions before being unified. Each time, a new module-level I/O call was discovered hanging during boot. The fix is one function that owns all init, with a Dropbox timeout wrapper (10s via ThreadPoolExecutor) so a slow token refresh is skipped, not blocking
- **Config**: `app/routes.py` — `_ensure_initialized()` + `@api.before_request`. Also triggered by `/ready` endpoint in `app/main_flask.py`

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

**Why not more workers?** The app uses an in-memory `_state` dict (a Python dictionary that holds the loaded playlist, caches, etc.). Multiple workers = multiple copies of state = things break. This is the fundamental architectural constraint. See `.claude/plans/multi-user.md` for the plan to move state to SQLite, which would unlock both multi-user support and multiple workers.

**What this means practically**: You're unlikely to notice slowness during normal use. The 8-thread pool + daemon threads for long operations means the site stays responsive even during bulk tagging or tree building.

---

## When Things Go Wrong

### "The site is down" (502/504 errors)

**What's happening**: gunicorn is frozen or crashed. Docker's health check will auto-restart it within ~90 seconds.

**If it doesn't come back on its own** (wait at least 2-3 minutes):

1. Connect to EC2 via AWS Console (try in order):
   - **Session Manager** (most reliable): AWS Console -> EC2 -> Instances -> select instance -> Connect -> Session Manager
   - **EC2 Instance Connect** (may fail if agent isn't configured): same flow but use the "EC2 Instance Connect" tab
   - **CloudShell fallback**: AWS Console -> CloudShell -> use `aws ec2-instance-connect ssh` or `aws ssm start-session`
   - **Emergency**: If nothing works, re-run the latest deploy from GitHub Actions (Actions tab -> latest run -> Re-run failed jobs). The deploy SSHes in with its own key and restarts the container
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
| Canary "not ready" for all 24 attempts | App boots but init hangs or crashes (Dropbox timeout, missing env var, import error). **Site is still up** (old container untouched) | Check canary logs in the GitHub Actions output. If transient, re-run the deploy. If persistent, check `_ensure_initialized()` in `routes.py` |
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

Deploys are **manual only** — click "Run workflow" in the GitHub Actions tab (`.github/workflows/deploy.yml`). Pushes to `main` do NOT trigger deploys. This prevents accidental outages from auto-deploying every commit.

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
5. Polls the canary's `/ready` endpoint for up to 2 minutes (this triggers lazy init and confirms the app can serve)
6. **If canary is ready**: stops the old container, starts the proven image as `genre-tagging` on port 5001
7. **If canary never becomes ready**: removes the canary, old container untouched, deploy fails (site stays up)
8. Verifies the new production container's `/ready` endpoint (up to 3 min)
9. **If production verification fails**: automatically rolls back to the previous image and exits with error
10. Cleans up old images to save disk space

**Downtime**: There's a brief window (~2-5 seconds) during step 6 while swapping containers. This only happens on *successful* deploys. Failed canary deploys cause **zero downtime**. Failed production verification triggers **automatic rollback** to minimize downtime.

---

## Key Files

| File | What it does |
|------|-------------|
| `Dockerfile` | How the Docker image is built — base image, dependencies, health check, startup command |
| `.github/workflows/deploy.yml` | The automated build-and-deploy pipeline |
| `.dockerignore` | Files excluded from the Docker image (keeps it small and safe) |
| `app/main_flask.py:36-55` | `/healthz` (liveness) and `/ready` (readiness) endpoints |
| `scripts/setup-ssm-agent.sh` | One-time SSM Agent install — enables Session Manager access |
| `scripts/setup-swap.sh` | One-time swap file setup for memory-constrained instances |
| `.claude/plans/aws-deployment.md` | Full setup guide — AWS Console steps, server config, secrets |

---

## Useful Commands (on EC2 via Session Manager or Instance Connect)

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

# Memory
free -m                                      # RAM + swap usage
```

### Remote Commands (from CloudShell, no SSH needed)

```bash
# Run a command on the instance via SSM (requires SSM Agent installed)
aws ssm send-command \
  --instance-ids i-02c583d86c9ac9320 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["docker ps -a","free -m"]' \
  --output json

# Start an interactive session
aws ssm start-session --target i-02c583d86c9ac9320

# Reboot the instance (last resort — doesn't need SSH)
aws ec2 reboot-instances --instance-ids i-02c583d86c9ac9320
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

### 2026-03-17 — Recurring "unhealthy" container, never self-recovers
- **Symptom**: Site down, container running but "unhealthy" for 18+ minutes. Logs show gunicorn master started but no worker ever booted ("Booting worker" line missing)
- **Cause**: Two compounding issues:
  1. **`playlist.py` ran `_load_playlists()` at import time** — same class of bug as the Dropbox init (module-level I/O during worker boot). If the EBS volume has a transient hiccup, the worker hangs before routes register, `/healthz` never responds
  2. **Docker never restarted the unhealthy container** — `--restart unless-stopped` only fires when a container EXITS, not when Docker marks it "unhealthy". The gunicorn master stayed alive (container "running"), so Docker never triggered a restart. The previous devops doc incorrectly stated Docker would auto-restart unhealthy containers
- **Fix**:
  1. **Lazy playlist init**: Moved `_load_playlists()` to first access (same pattern as Dropbox lazy init) — zero I/O during worker boot
  2. **Self-healing healthcheck script** (`healthcheck.sh`): Tracks consecutive health check failures. After 5 in a row (~2.5 min), kills gunicorn PID 1, forcing container exit, which actually triggers the restart policy
  3. **Increased start-period**: 10s → 60s, giving the worker more time on initial boot before health checks begin
- **Lesson**: Docker's "unhealthy" status is informational only — it doesn't trigger any recovery action. If you need auto-restart on health failure, you must bridge the gap yourself (kill PID 1 to force an exit). Also: every module-level function call is a potential boot-time hang — audit all imports, not just the obvious ones

### 2026-03-17 — Stability audit: unified init, /ready endpoint, timeout alignment
- **Symptom**: Recurring site-down incidents despite multiple prior fixes — each fix addressed one init-time hang but the pattern kept repeating
- **Root cause**: Accumulated fixes were incomplete and inconsistent:
  1. `os.makedirs(_ARTWORK_DIR)` still ran at import time in routes.py (same class of bug fixed twice before)
  2. Dropbox client init had no timeout wrapper — a slow token refresh could hang the first request indefinitely
  3. Playlist lazy-load was separate from routes.py's `_ensure_initialized()` with no locking (race condition)
  4. Canary deploy only checked `/healthz` (always fast) — never verified init actually completed
  5. Dockerfile `start-period=60s` didn't match deploy script's 120s canary wait (confusing, misleading)
- **Fixes**:
  1. **Unified lazy init**: ALL I/O moved into `_ensure_initialized()` — artwork dir creation, artwork cache, Dropbox tokens, and playlists. Zero disk/network I/O at import time
  2. **Dropbox init timeout**: Wrapped in `ThreadPoolExecutor` with 10s timeout — slow token refresh is skipped, not blocking
  3. **Playlist locking**: Added `threading.Lock()` matching routes.py's double-check locking pattern
  4. **`/ready` endpoint**: Returns 503 until `_initialized=True`. Canary deploy now checks `/ready` instead of just Docker health. Post-swap verification retries `/ready` for 60s
  5. **Dockerfile start-period**: 60s → 120s to match deploy script timeout
- **Lesson**: Defence-in-depth only works when all layers are complete. The lazy init pattern was applied three times to three different places but never unified into one function. The canary deploy tested "is the process alive?" but never "can it serve?" — two different questions

### 2026-03-17 — Deploy failing: /ready never triggers init
- **Symptom**: Canary shows "not ready" for all 24 attempts, deploy aborted. Gunicorn boots fine, Docker health shows "healthy", but `/ready` returns 503 forever
- **Cause**: `/ready` in `main_flask.py` checked the `_initialized` flag but never called `_ensure_initialized()`. Since `/ready` is on the Flask app (not the `api` blueprint), `@api.before_request` never fires for it. The canary only hits `/ready`, so init was never triggered
- **Fix**: `/ready` now calls `_ensure_initialized()` before checking the flag
- **Also simplified**: Removed Docker health status check from canary loop — `/ready` is the single source of truth. Docker health was noise (120s start-period meant it showed "starting" for almost the entire canary window)
- **Lesson**: If an endpoint checks state that's set by a different code path, verify the code path actually runs for that endpoint. Blueprint `before_request` hooks only fire for routes on that blueprint, not app-level routes

### 2026-03-18 — Site down (504), failed deploy left no running container
- **Symptom**: 504 Gateway Timeout on bjingo-r.us. Nginx running but returning 504 (no backend to proxy to). EC2 instance healthy (all AWS status checks passed)
- **Cause**: Two rapid pushes to `main` triggered back-to-back deploys (#52 and #53). Deploy #52 ("fixed the rapid skip playback errors") ran the blue-green cycle but the production container failed verification after the swap — the deploy script logged a warning but did NOT exit with an error (the old `# Don't exit 1 here` comment at line 201). Deploy #53 ("refactor to get all playback logic into one file") then ran against an already-broken state and also failed. The old production container had been `docker rm`'d during the swap, and the new container never became ready, so **no container was running at all**
- **Why SSH didn't work**: EC2 Instance Connect failed ("Permission denied") — the EC2 Instance Connect agent wasn't installed/configured on the instance. SSM Agent also wasn't installed, and the serial console wasn't enabled for the account. This left no way to access the instance directly
- **Recovery**:
  1. Rebooted the instance via CloudShell (`aws ec2 reboot-instances`) — nginx came back but no Docker container existed to auto-restart (it had been removed, not just stopped)
  2. Re-ran the failed deploy #53 from GitHub Actions ("Re-run failed jobs") — the deploy job SSHed in using its own stored SSH key, pulled the image from ECR, and started a fresh container. Site was back up in 46 seconds
- **Fixes applied**:
  1. **Manual deploy trigger**: Changed `deploy.yml` from `on: push: branches: [main]` to `on: workflow_dispatch`. Deploys now only happen when you click "Run workflow" in GitHub Actions. This prevents auto-deploying every commit, which was the root cause of most outages
  2. **Production verification now fails loudly**: Changed the post-swap verification from a silent warning to `exit 1`, so GitHub Actions reports failure and you get notified
  3. **Emergency rollback**: If the new production container fails verification, the deploy script now automatically rolls back to the previous image instead of leaving the site down
  4. **SSM Agent setup**: Attached `AmazonSSMManagedInstanceCore` IAM policy to the EC2 role. Created `scripts/setup-ssm-agent.sh` for one-time agent installation. Once installed, Session Manager provides reliable access even when SSH breaks
- **Lesson**: Auto-deploying every push to `main` is the single biggest risk factor. Most outages were deploy-related, not runtime crashes. Manual deploys let you batch changes and deploy when you're ready to monitor the result. Also: always have a second way to access your server — SSH alone is a single point of failure

---

## Future Improvements

- [x] ~~**Blue-green deploy with rollback**: Test new image as canary before swapping — failed deploys no longer take the site down~~ *(done 2026-03-15)*
- [x] ~~**Lazy init + timeouts + reduced gunicorn timeout**: Prevent recurring worker hangs from module-level Dropbox init and untimed external calls~~ *(done 2026-03-16)*
- [x] ~~**Unified init + /ready endpoint + timeout alignment**: Complete the lazy init pattern, add readiness check to deploy~~ *(done 2026-03-17)*
- [x] ~~**Manual deploy trigger + emergency rollback**: Switched from auto-deploy-on-push to manual `workflow_dispatch`. Added automatic rollback to previous image if post-swap verification fails~~ *(done 2026-03-18)*
- [ ] **Install SSM Agent on EC2** *(do next — script ready at `scripts/setup-ssm-agent.sh`)*: IAM policy already attached. Run the script on the instance via the next deploy or SSH session. Once installed, Session Manager provides reliable access even when SSH/Instance Connect breaks
- [ ] **Monitoring/alerts** *(recommended — `GenreTagging-2u3`)*: Set up uptime monitoring (e.g. UptimeRobot free tier) to get notified when the site goes down, instead of discovering it manually
- [ ] **HTTPS/SSL**: Add a domain + Let's Encrypt certificate via Certbot. Currently using `bjingo-r.us` with HTTP only
- [ ] **GitHub Actions Node.js 20 warning**: Update `actions/checkout` and `aws-actions/configure-aws-credentials` to versions supporting Node.js 24 (deadline: June 2026)
- [ ] **Log rotation on EC2**: The `app.log` file rotates automatically (2MB x 3 backups), but Docker container logs grow unbounded. Add `--log-opt max-size=10m --log-opt max-file=3` to the `docker run` command
- [ ] **Multi-user support + architectural simplification**: See `.claude/plans/multi-user.md` for the full plan — SQLite-per-user state, authentication, per-user Dropbox, and optional multi-worker deployment
