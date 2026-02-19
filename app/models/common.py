"""Shared response models used across all endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Standard error response: {"error": "message"}."""

    error: str


class SuccessResponse(BaseModel):
    """Generic success response with optional fields."""

    ok: bool = True
    started: bool | None = None
    stopped: bool | None = None
    track_count: int | None = None


class ProgressEvent(BaseModel):
    """SSE progress event broadcast by long-running tasks.

    Used by tagging, tree building, autoset, and chat.
    Fields are a superset — each domain uses a subset.
    """

    event: str  # "progress", "done", "error", "stopped", "token", "tool_call", "tool_result"

    # Shared
    phase: str | None = None
    detail: str | None = None
    percent: float | None = None

    # Tagging-specific
    id: int | None = None
    title: str | None = None
    artist: str | None = None
    comment: str | None = None
    year: int | None = None
    status: str | None = None
    progress: str | None = None  # e.g. "5/50"

    # Autoset-specific
    set_id: str | None = None

    # Chat-specific
    text: str | None = None
    tool: str | None = None
    arguments: dict | None = None
    result_summary: str | None = None
    full_text: str | None = None
