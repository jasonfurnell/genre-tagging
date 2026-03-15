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

# Health check: ping /healthz every 30s, fail after 5s, restart after 3 failures
# This auto-restarts the container if gunicorn freezes (e.g. stuck LLM call)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5001/healthz || exit 1

# V1 Flask app — single process, threaded for SSE + background tasks
# 600s timeout for long-running LLM calls (tree building, tagging)
# max-requests: recycle worker after 500 requests to prevent stuck/leaked state
# max-requests-jitter: randomise so recycling doesn't hit mid-traffic
CMD ["uv", "run", "gunicorn", "app.main_flask:app", \
     "--bind", "0.0.0.0:5001", \
     "--workers", "1", \
     "--threads", "4", \
     "--timeout", "600", \
     "--max-requests", "500", \
     "--max-requests-jitter", "50"]
