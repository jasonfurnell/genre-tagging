# =============================================================================
# V1 Flask app — single-stage Docker build
# =============================================================================
FROM python:3.13-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY pyproject.toml uv.lock ./

# Install Python dependencies (frozen = reproducible from lockfile)
# Then add gunicorn for production serving (not needed locally)
# Also install curl for the Docker health check
RUN uv sync --frozen --no-dev --no-editable && \
    uv pip install gunicorn && \
    apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy application code
COPY app/ ./app/

# Create output directories (overridden by volume mounts at runtime)
RUN mkdir -p output output/artwork

EXPOSE 5001

# Self-healing health check: the script tracks consecutive failures and
# kills gunicorn (PID 1) after 5 in a row (~2.5 min), forcing a container
# exit which triggers --restart unless-stopped. This closes the gap where
# Docker marks a container "unhealthy" but never restarts it (restart
# policy only fires on EXIT, not on unhealthy status).
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD /healthcheck.sh

# V1 Flask app — single process, 8 threads for SSE + background tasks.
# 8 threads (up from 4) gives /healthz room to respond even when several
# threads are busy with LLM calls. 120s timeout (down from 600s) means
# stuck requests get killed in 2 min instead of 10.
# max-requests: recycle worker after 500 requests to prevent stuck/leaked state
# max-requests-jitter: randomise so recycling doesn't hit mid-traffic
CMD ["uv", "run", "gunicorn", "app.main_flask:app", \
     "--bind", "0.0.0.0:5001", \
     "--workers", "1", \
     "--threads", "8", \
     "--timeout", "120", \
     "--max-requests", "500", \
     "--max-requests-jitter", "50"]
