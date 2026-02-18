# Plan: AWS Deployment
> Source: `docs/architecture-review.md` — Section 5
> Priority: When ready to deploy

## Architecture
```
GitHub (push to main)
        │
        v
GitHub Actions
  ├─ Build Docker image
  ├─ Push to Amazon ECR
  └─ SSH → EC2: pull & restart
        │
        v
EC2 Instance (t3.micro, ~$9/mo)
  ├─ Nginx (:80) ──proxy──> Gunicorn (:5001)
  ├─ Docker container
  │   ├─ Flask app (1 worker, 4 threads)
  │   ├─ /app/output/ → volume mount (persistent data)
  │   └─ .env → API keys
  └─ Public IP: http://x.x.x.x
```

## Files to Create
1. `Dockerfile` — Python 3.13-slim, gunicorn with 1 worker/4 threads/300s timeout
2. `.dockerignore` — exclude venv, .git, .env, output, docs, notebooks
3. `.github/workflows/deploy.yml` — Build → ECR → SSH deploy to EC2
4. `config.json.example` — Template for server config

## AWS Console Setup (one-time)
1. **ECR**: Create private repo `genre-tagging`
2. **IAM**: Create `github-actions-deployer` user with ECR push permissions
3. **EC2 Key Pair**: `genre-tagging-key` (RSA, .pem)
4. **Security Group**: `genre-tagging-sg` — SSH (My IP) + HTTP (0.0.0.0/0)
5. **EC2 Instance**: t3.micro, Amazon Linux 2023, 20GB gp3
6. **GitHub Secrets**: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EC2_HOST, EC2_SSH_KEY

## EC2 Server Setup (one-time, via SSH)
1. Install Docker (`dnf install docker`)
2. Install & configure Nginx (proxy :80 → :5001, SSE support, 50M upload limit)
3. Create `/data/genre-tagging/output/` for persistent data
4. Create `.env` with API keys
5. Create `config.json`
6. Optional: rsync existing output data (exclude artwork — warm-cache re-downloads)

## Cost Estimate
| Resource | Monthly |
|----------|---------|
| EC2 t3.micro | ~$7.50 |
| EBS 20GB gp3 | ~$1.60 |
| ECR storage | ~$0.05 |
| Data transfer | ~$0.10 |
| **Total** | **~$9.25** |

## Key Decisions
- **1 gunicorn worker required** — `_state` is in-memory, multiple workers = multiple copies
- **4 threads** — handles concurrent requests (artwork, SSE, tagging)
- **300s timeout** — LLM calls (tree building) can take minutes
- **Port 5001 NOT exposed** — Nginx proxies :80 → :5001 internally
- **Elastic IP recommended** — public IP changes on stop/start without it

## Operational Commands
```bash
docker logs genre-tagging --tail 100 -f     # View logs
docker restart genre-tagging                 # Restart after config change
```

See `docs/architecture-review.md` Section 5 for full Nginx config, IAM policy JSON, deploy workflow YAML, and backup cron setup.
