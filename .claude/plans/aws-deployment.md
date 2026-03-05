# Plan: AWS Deployment
> **Beads Epic**: `GenreTagging-qpw` (P3) — 4 subtasks
> Simplified for V1 Flask deployment (no React/Bun frontend build)

## Architecture
```
GitHub (push to main)
        │
        v
GitHub Actions
  ├─ Build Docker image (Python + uv + gunicorn)
  ├─ Push to Amazon ECR
  └─ SSH → EC2: pull & restart
        │
        v
EC2 Instance (t3.micro, ~$9/mo)
  ├─ Nginx (:80) ──proxy──> gunicorn (:5001)
  ├─ Docker container
  │   ├─ V1 Flask app (1 gunicorn worker, 4 threads)
  │   ├─ Vanilla JS frontend (served by Flask from app/static/)
  │   ├─ /app/output/ → volume mount (persistent data)
  │   ├─ /app/config.json → bind mount (read-only)
  │   └─ .env → env-file (API keys)
  └─ Elastic IP: http://x.x.x.x
```

## Files Created
1. `Dockerfile` — Single-stage: Python 3.13-slim + uv + gunicorn (1 worker, 4 threads, 600s timeout)
2. `.dockerignore` — exclude .git, .env, output/, frontend/, __pycache__, .venv, docs/
3. `.github/workflows/deploy.yml` — Build → ECR → SSH deploy to EC2
4. `config.json.example` — Template for server config (sanitized defaults)

## AWS Console Setup (one-time)

### 1. ECR — Create private repository
- AWS Console → ECR → Create repository
- Name: `genre-tagging`, Visibility: Private
- Tag mutability: Mutable (allows `latest` overwrite)

### 2. IAM — Create deployer user
- Name: `github-actions-deployer`, no console access
- Attach inline policy:
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
      "Resource": "arn:aws:ecr:*:*:repository/genre-tagging"
    }
  ]
}
```
- Create access key → save for GitHub secrets

### 3. EC2 Key Pair
- Name: `genre-tagging-key`, Type: RSA, Format: .pem
- Download and store securely (becomes `EC2_SSH_KEY` secret)

### 4. Security Group
- Name: `genre-tagging-sg`
- Inbound: SSH (22) from 0.0.0.0/0 (required for GitHub Actions deploys, key-auth only), HTTP (80) from 0.0.0.0/0, HTTPS (443) from 0.0.0.0/0
- Outbound: All traffic (default)

### 5. EC2 Instance
- AMI: Amazon Linux 2023, Type: t3.micro
- Key pair: `genre-tagging-key`, SG: `genre-tagging-sg`
- Storage: 20GB gp3

### 6. Elastic IP (recommended)
- Allocate and associate to EC2 instance
- Free while associated to a running instance

### 7. GitHub Secrets (Settings → Secrets → Actions)
| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM deployer access key |
| `AWS_SECRET_ACCESS_KEY` | IAM deployer secret key |
| `AWS_REGION` | e.g. `ap-southeast-2` |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID |
| `EC2_HOST` | Elastic IP address |
| `EC2_SSH_KEY` | Contents of `genre-tagging-key.pem` |

## EC2 Server Setup (one-time, via SSH)

### Step 1: Install Docker
```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user
# Log out and back in for group change
```

### Step 2: Install & configure Nginx
```bash
sudo dnf install -y nginx
sudo systemctl enable nginx
```

Create `/etc/nginx/conf.d/genre-tagging.conf`:
```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    proxy_connect_timeout 10s;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (critical for real-time progress)
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

```bash
sudo rm -f /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl start nginx
```

### Step 3: Create persistent data directories
```bash
sudo mkdir -p /data/genre-tagging/output/artwork
sudo chown -R ec2-user:ec2-user /data/genre-tagging
```

### Step 4: Create .env file
```bash
cat > /data/genre-tagging/.env << 'EOF'
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DROPBOX_APP_KEY=...
DROPBOX_APP_SECRET=...
EOF
chmod 600 /data/genre-tagging/.env
```

### Step 5: Create config.json
```bash
cp config.json.example /data/genre-tagging/config.json
# Edit as needed
```

### Step 6: Configure ECR access for deploy pulls
```bash
# AWS CLI is pre-installed on Amazon Linux 2023
# Option A (preferred): Attach IAM instance profile with ECR read permissions
# Option B: aws configure with deployer credentials
```

### Step 7: (Optional) Seed initial data
```bash
# rsync persistent data from local (exclude artwork — re-downloads on first load)
rsync -avz --exclude='artwork/' output/ ec2-user@<IP>:/data/genre-tagging/output/
```

## Key Decisions
- **1 gunicorn worker + 4 threads** — `_state` dict is an in-memory singleton, 1 worker keeps it consistent, threads handle concurrent requests (SSE, artwork, background tasks)
- **600s timeout** — tree-building and tagging LLM calls can take 5-10 minutes
- **Port 5001 NOT exposed externally** — Nginx proxies :80 → :5001 on localhost only
- **Elastic IP recommended** — public IP changes on EC2 stop/start without it
- **Docker volumes for output/** — 7 persistent JSON files + 9K artwork images survive container updates
- **config.json bind-mounted read-only** — edit on host, restart container to apply
- **No SSL in v1** — add via Certbot/Let's Encrypt when a domain is configured

## Cost Estimate
| Resource | Monthly |
|----------|---------|
| EC2 t3.micro | ~$7.50 |
| EBS 20GB gp3 | ~$1.60 |
| ECR storage | ~$0.05 |
| Data transfer | ~$0.10 |
| Elastic IP | $0.00 |
| **Total** | **~$9.25** |

## Operational Commands
```bash
# View logs (live)
docker logs genre-tagging --tail 100 -f

# View app.log inside persistent volume
tail -f /data/genre-tagging/output/app.log

# Restart after config change
docker restart genre-tagging

# Manual deploy (pull latest)
aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com
docker pull <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/genre-tagging:latest
docker stop genre-tagging && docker rm genre-tagging
docker run -d --name genre-tagging --restart unless-stopped \
  -p 127.0.0.1:5001:5001 \
  --env-file /data/genre-tagging/.env \
  -v /data/genre-tagging/output:/app/output \
  -v /data/genre-tagging/output_v2:/app/output_v2 \
  -v /data/genre-tagging/config.json:/app/config.json:ro \
  <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/genre-tagging:latest

# Check disk usage
df -h
du -sh /data/genre-tagging/output/artwork/
```
