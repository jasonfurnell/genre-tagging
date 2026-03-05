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
RUN uv sync --frozen --no-dev --no-editable && \
    uv pip install gunicorn

    # Copy application code
    COPY app/ ./app/

    # Create output directories (overridden by volume mounts at runtime)
    RUN mkdir -p output output/artwork

    EXPOSE 5001

    # V1 Flask app — single process, threaded for SSE + background tasks
    # 600s timeout for long-running LLM calls (tree building, tagging)
    CMD ["uv", "run", "gunicorn", "app.main_flask:app", \
         "--bind", "0.0.0.0:5001", \
              "--workers", "1", \
                   "--threads", "4", \
                        "--timeout", "600"]
                        
