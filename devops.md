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

## All Fixes Applied (2026-03-17)

### 1. Deploy pipeline hardened (`deploy.yml`)

**Rationale:** The deploy script was failing because it tried to run two containers simultaneously on a memory-starved host, with no safety rails and a timeout too short to accommodate slow starts.

- **`command_timeout: 5m → 10m`** — Gives the full script breathing room for slow Docker pulls and container starts under memory pressure.
- **Pre-deploy Docker prune** — Frees memory/disk *before* pulling the new image, reclaiming space from old images and stopped containers.
- **Memory diagnostics** — Logs `free -m` at 4 stages (pre-deploy, pre-canary, pre-production, post-deploy) so future failures have clear evidence.
- **Docker memory limits** — Canary capped at `--memory=512m --memory-swap=768m`; production at `--memory=768m --memory-swap=1g`. Prevents a single container from OOM-killing the host.
- **Sequential container lifecycle** — Canary is fully stopped and removed before production starts, with a 2-second pause for kernel memory reclamation.
- **Production verification extended** — 36 attempts × 5s = 3 minutes (was 12 × 5s = 1 minute).
- **Swap detection warning** — Deploy logs a warning if swap is missing.
- **Failure diagnostics** — On deploy failure, the script now dumps Docker container logs and `free -m` output for post-mortem analysis.

*Status: Pushed to `main` (commit `698ec44`). Will take effect on next deploy.*

### 2. Swap file configured on EC2 ✅

**Rationale:** With only 1GB physical RAM, any memory spike during deploys (two containers running simultaneously) triggered the Linux OOM killer immediately. Swap provides an overflow buffer — slower than RAM, but the alternative is a crashed container. Setting `swappiness=10` ensures the kernel strongly prefers RAM and only uses swap under genuine pressure.

**What was done** (via EC2 Instance Connect):
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

**Verified:** `free -m` confirmed 1023MB swap available. Persistent across reboots via `/etc/fstab`.

The setup script is also saved at `scripts/setup-swap.sh` for reproducibility if the instance is ever rebuilt.

### 3. Upgraded t3.micro → t3.small ✅

**Rationale:** The t3.micro's 1GB RAM was fundamentally insufficient for the workload. The running stack (Docker daemon + Nginx + gunicorn/Flask + pandas DataFrame + OS) consumed 600–800MB at baseline, leaving virtually no headroom for deploys, data processing, or any concurrent operations. This was the root cause of repeated OOM crashes and site outages.

The t3.small provides **2GB RAM** — doubling the available memory for approximately $9.50/month more (~$19/mo vs ~$9.50/mo on-demand). Combined with the 1GB swap file, the instance now has **3GB total memory**, which provides comfortable headroom for blue-green deploys (two containers briefly running simultaneously) and normal operation.

**What was done:**
1. Stopped the EC2 instance
2. Changed instance type from `t3.micro` to `t3.small` via AWS Console
3. Started the instance — Elastic IP `52.65.56.55` remained associated
4. Total downtime: ~2 minutes

**Updated memory budget:**

| Component | Approx. Memory |
|-----------|---------------|
| Docker daemon | ~150 MB |
| Nginx | ~20 MB |
| Flask/gunicorn + pandas DataFrame | ~300–500 MB |
| OS + kernel buffers | ~100 MB |
| **Total baseline** | **~600–800 MB** |
| **Available (t3.small)** | **2048 MB** |
| **Headroom** | **~1.2–1.4 GB** |
| **+ Swap overflow** | **+1 GB** |

### 4. IAM Instance Profile attached ✅

**Rationale:** The EC2 instance had **no IAM role** — ECR access depended on static AWS credentials configured manually via `aws configure` on the host. This created a silent failure mode: if credentials expired or were rotated, deploys and manual Docker pulls would break with cryptic authentication errors. An IAM Instance Profile provides automatic, rotating credentials managed by AWS — no expiry, no manual rotation, no secrets to leak.

**What was done:**
1. Created IAM role `genre-tagging-ec2-role` with trust policy for `ec2.amazonaws.com`
2. Attached managed policy `AmazonEC2ContainerRegistryReadOnly` (read-only ECR access — sufficient for pulling images, no write/delete risk)
3. Attached the role to instance `i-02c583d86c9ac9320` via EC2 Console → Actions → Security → Modify IAM role

The deploy script's `aws ecr get-login-password` command will now automatically use the instance profile credentials instead of static ones.

### 5. Termination Protection enabled ✅

**Rationale:** Without termination protection, a single accidental click in the AWS Console (or a misguided API call) could permanently destroy the EC2 instance and all its data — Docker volumes, configuration, swap setup, everything. Enabling this adds a safety gate: you must explicitly disable protection before termination is allowed.

**What was done:** EC2 → Actions → Instance settings → Change termination protection → Enabled.

---

## Current Instance Configuration

| Setting | Value |
|---------|-------|
| Instance ID | `i-02c583d86c9ac9320` |
| Instance type | `t3.small` (2 vCPU, 2 GB RAM) |
| Region | `ap-southeast-2` (Sydney) |
| Elastic IP | `52.65.56.55` |
| IAM role | `genre-tagging-ec2-role` (ECR read-only) |
| Swap | 1 GB (`/swapfile`, swappiness=10) |
| Termination protection | Enabled |
| AMI | Amazon Linux 2023 (`al2023-ami-2023.10.20260216.1`) |

---

## Incident Timeline

| Date | Issue | Root Cause | Resolution |
|------|-------|-----------|------------|
| 2026-03-17 | Deploy #47 failed: prod verify timeout | SSH 5m timeout too short + memory pressure | Extended timeout to 10m, added memory limits |
| 2026-03-17 | Deploy #44 failed: canary never ready (24 attempts) | OOM: two containers + Docker exceeded 1GB | Added swap, memory limits, sequential lifecycle |
| 2026-03-17 | Frequent manual EC2 restarts needed | Docker/app OOM kills with no recovery | Swap file + memory-limited containers |
| 2026-03-17 | Instance upgraded t3.micro → t3.small | 1GB RAM insufficient for Docker + Flask + pandas | 2GB RAM now provides ~1.2GB headroom + 1GB swap |
| 2026-03-17 | IAM role attached | Static ECR credentials risk silent expiry | Instance profile provides auto-rotating credentials |
| 2026-03-17 | Termination protection enabled | Instance vulnerable to accidental deletion | Must explicitly disable before termination allowed |
