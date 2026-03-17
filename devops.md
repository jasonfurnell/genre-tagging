# DevOps — Incident Log & Stability Fixes

## Root Cause: Memory Exhaustion on t3.micro

**Diagnosed 2026-03-17** after examining GitHub Actions logs and AWS EC2 monitoring.

The t3.micro instance has **1GB RAM**. The running stack consumes most of it:

| Component | Approx. Memory |
|-----------|---------------|
| Docker daemon | ~150 MB |
| Nginx | ~20 MB |
| Flask/gunicorn + pandas DataFrame | ~300–500 MB |
| OS + kernel buffers | ~100 MB |
| **Total baseline** | **~600–800 MB** |

This leaves almost no headroom. During deploys, the blue-green strategy starts a **canary container alongside the running production container**, effectively doubling the app's memory footprint and pushing well past 1GB. With **no swap configured**, the Linux OOM killer intervenes — killing the app process, Docker, or making initialization impossibly slow.

### Evidence from GitHub Actions

- **Deploy #44** — Canary never became ready across all 24 attempts. Docker reported the container as healthy (gunicorn process alive), but `/ready` (which triggers data loading into pandas) never completed. Classic OOM pattern: the init allocates memory, gets killed, retries, gets killed.

- **Deploy #47** — Canary barely passed (attempt 3), but the production container didn't become ready before the 5-minute SSH `command_timeout` expired. Only 1 verification attempt happened before timeout.

### Contributing Factors

1. **No swap space** — The EC2 setup never configured swap. With 1GB physical RAM and no overflow, any spike triggers OOM kills immediately.

2. **SSH `command_timeout: 5m`** — The entire deploy script (ECR login + docker pull + canary start + canary check + canary stop + prod start + prod check) must complete in 5 minutes. On a memory-starved box, docker pull alone can take 30–60s, leaving too little time.

3. **No Docker memory limits** — Containers could consume all available RAM, starving the host OS and Docker daemon.

4. **No IAM instance profile** — ECR access relies on manually configured `aws configure` credentials on the EC2 instance. If these expire, both deploys and manual pulls break silently.

5. **No pre-deploy cleanup** — Old Docker images accumulated on disk/in-memory cache, further reducing available resources.

---

## Fixes Applied (2026-03-17)

### 1. Deploy pipeline hardened (`deploy.yml`)

- **`command_timeout: 5m → 10m`** — Gives the full script breathing room.
- **Pre-deploy Docker prune** — Frees memory/disk *before* pulling the new image.
- **Memory diagnostics** — Logs `free -m` at each stage so future failures have clear evidence.
- **Docker memory limits** — Canary capped at 512MB/768MB swap; production at 768MB/1GB swap. Prevents a single container from OOM-killing the host.
- **Sequential container lifecycle** — Canary is fully stopped and removed before production starts, with a 2-second pause for kernel memory reclamation.
- **Production verification extended** — 36 attempts × 5s = 3 minutes (was 12 × 5s = 1 minute).
- **Swap detection warning** — Deploy logs a warning if swap is missing.

### 2. Swap setup script (`scripts/setup-swap.sh`)

Creates a 1GB swap file on the EC2 instance. This is the single most important fix — it gives the OS an overflow buffer for memory spikes during deploys. Swap is slower than RAM, but the alternative is a crashed container.

**Must be run once on the EC2 instance:**
```bash
ssh ec2-user@52.65.56.55 'bash -s' < scripts/setup-swap.sh
```

---

## Still Recommended (Manual Steps)

### 3. Upgrade to t3.small (~$15/mo, +$7.50)

The t3.small has **2GB RAM** — doubling headroom for just $7.50/month more. This is the most impactful single change and would eliminate memory pressure entirely for the current workload.

**How to upgrade:**
1. Stop the EC2 instance (Instance state → Stop instance)
2. Actions → Instance settings → Change instance type → t3.small
3. Start the instance
4. Verify the Elastic IP is still associated

*Note: The instance will be down for 2–3 minutes during the resize.*

### 4. Attach an IAM Instance Profile

The EC2 instance currently has **no IAM role** — ECR access depends on static credentials. Create a role with ECR read permissions and attach it:

1. IAM → Roles → Create role → EC2 use case
2. Attach policy: `AmazonEC2ContainerRegistryReadOnly`
3. Name: `genre-tagging-ec2-role`
4. EC2 → Instance → Actions → Security → Modify IAM role → select `genre-tagging-ec2-role`

This eliminates the risk of expired credentials breaking deploys.

### 5. Enable Termination Protection

Currently disabled. One accidental click could destroy the instance and all its data.

EC2 → Instance → Actions → Instance settings → Change termination protection → Enable.

---

## Incident Timeline

| Date | Issue | Root Cause | Resolution |
|------|-------|-----------|------------|
| 2026-03-17 | Deploy #47 failed: prod verify timeout | SSH 5m timeout too short + memory pressure | Extended timeout to 10m, added memory limits |
| 2026-03-17 | Deploy #44 failed: canary never ready (24 attempts) | OOM: two containers + Docker exceeded 1GB | Added swap, memory limits, sequential lifecycle |
| 2026-03-17 | Frequent manual EC2 restarts needed | Docker/app OOM kills with no recovery | Swap file + memory-limited containers |
