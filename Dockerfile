# =============================================================================
# Stage 1: Build React frontend with Bun + Vite
# =============================================================================
FROM oven/bun:latest AS frontend-build

WORKDIR /build

# Copy package manifest + lockfile first (better layer caching)
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY frontend/ ./
RUN bun run build


# =============================================================================
# Stage 2: Python backend with uv + uvicorn
# =============================================================================
FROM python:3.13-slim AS runtime

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY pyproject.toml uv.lock ./

# Install Python dependencies (frozen = reproducible from lockfile)
RUN uv sync --frozen --no-dev --no-editable

# Copy application code
COPY app/ ./app/

# Copy built frontend from stage 1
COPY --from=frontend-build /build/dist ./frontend/dist/

# Create output directories (overridden by volume mounts at runtime)
RUN mkdir -p output output/artwork output_v2

EXPOSE 5001

# Single worker required: AppState is an in-memory singleton
# 300s keep-alive for long-running LLM calls (tree building)
CMD ["uv", "run", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "5001", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
