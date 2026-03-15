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
     - Stops the old container
     - Starts the new container
     - Waits for it to pass a health check
        |
        v
EC2 Instance (your server, ~$9/month)
  Nginx (:80) --> gunicorn (:5001) --> your Flask app
  Docker handles restart/recovery automatically
```

**In plain English**: every time you push to `main`, a robot builds your app, ships it to your server, swaps in the new version, and confirms it's working. If it's not working, the deploy fails and the GitHub Actions log tells you why.

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
- **Config**: `Dockerfile` lines 44-45 (`--max-requests 500 --max-requests-jitter 50`)

### 3. Deploy Health Check
- **What**: After starting the new container, the deploy script polls Docker's health status for up to 2 minutes
- **Why**: Catches broken deployments before declaring success. If the app can't start, the deploy fails loudly in GitHub Actions rather than silently leaving a broken site
- **Config**: `.github/workflows/deploy.yml` lines 84-101

### 4. Timeouts on External Calls
- **What**: All Dropbox API calls have a 10s default timeout. Individual metadata checks have a tighter 5s timeout
- **Why**: Without timeouts, a single hung network call can block the entire server (1 worker = 1 app = all users affected)
- **The lesson we learned**: A global 5s timeout broke audio playback (streaming needs longer). The fix was a 10s default on the client + a targeted 5s timeout only on quick metadata checks. Always think about *which* calls need tight timeouts vs. which need room to breathe
- **Config**: `app/routes.py` — `_init_dropbox_client()` and `_dropbox_file_exists()`

### 5. Cache-Busting
- **What**: Static files (JS, CSS) include a deploy timestamp in their URLs (`?v=1710489600`)
- **Why**: Cloudflare/browser caches can serve stale files after a deploy. The timestamp forces fresh downloads
- **Config**: `app/main_flask.py` line 18 (`_boot_ts`)

---

## The Single-Worker Reality

This is the most important thing to understand about the current setup:

> **GenreTagging runs 1 gunicorn worker with 4 threads.**

This means:
- The app can handle ~4 concurrent requests (one per thread)
- If all 4 threads are busy (e.g. long LLM calls), new requests **queue** and eventually timeout (users see 504 errors)
- If a thread hangs forever, it permanently reduces capacity from 4 to 3 (then 2, then 1, then 0 = site down)
- The health check + worker recycling catch this, but there's a ~90 second window of pain

**Why not more workers?** The app uses an in-memory `_state` dict (a Python dictionary that holds the loaded playlist, caches, etc.). Multiple workers = multiple copies of state = things break. This is fine for a single-user DJ tool.

**What this means practically**: Long-running operations (tree building, bulk tagging) tie up threads. If you trigger a big operation while using the site normally, you might notice slowness. This is normal and expected.

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
| Health check failed after 24 attempts | App can't start — import error, missing env var, or hung init | Check `docker logs` on EC2 for tracebacks |
| "starting" for all attempts | Worker hanging during import (probably a network call at startup) | Check Dropbox/API timeouts in `routes.py` |
| "unhealthy" after starting | App starts but `/healthz` fails (rare — usually means the route is broken) | Check `main_flask.py` for the `/healthz` route |
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

### Job 2: Deploy to EC2 (~55s)
1. SSHes into your EC2 instance
2. Logs Docker into ECR (so it can pull images)
3. Pulls the new `latest` image
4. Stops + removes the old container
5. Starts a new container with your env vars, volumes, and port config
6. Polls the Docker health check for up to 2 minutes
7. Cleans up old images to save disk space

**Important**: There's a brief window (~5-15 seconds) between stopping the old container and the new one passing its health check where the site is down. This is a "rolling restart" gap — acceptable for a single-user tool, not great for production SaaS.

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

---

## Future Improvements (not urgent)

- [ ] **HTTPS/SSL**: Add a domain + Let's Encrypt certificate via Certbot
- [ ] **GitHub Actions Node.js 20 warning**: Update `actions/checkout` and `aws-actions/configure-aws-credentials` to versions supporting Node.js 24 (deadline: June 2026)
- [ ] **Monitoring/alerts**: Set up uptime monitoring (e.g. UptimeRobot free tier) to get notified when the site goes down, instead of discovering it manually
- [ ] **Log rotation on EC2**: The `app.log` file rotates automatically (2MB x 3 backups), but Docker container logs grow unbounded. Add `--log-opt max-size=10m --log-opt max-file=3` to the `docker run` command
