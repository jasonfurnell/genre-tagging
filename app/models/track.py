"""Track models — maps to DataFrame rows and API responses."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class TrackRow(BaseModel):
    """A single track as returned by the API.

    Maps to one row of the in-memory DataFrame, plus computed fields.
    Pydantic v2 handles numpy int64/float64 → Python int/float automatically.
    """

    id: int
    title: str
    artist: str
    album_title: str | None = None
    bpm: float | None = None
    key: str | None = None
    year: int | None = None
    comment: str | None = None
    location: str | None = None
    status: str | None = None  # "tagged" | "untagged"

    # Parsed facets (only included in detailed responses)
    genre1: str | None = None
    genre2: str | None = None
    descriptors: str | None = None
    mood: str | None = None
    track_location: str | None = None  # parsed location (avoids clash with file path)
    era: str | None = None

    @field_validator("bpm", mode="before")
    @classmethod
    def coerce_bpm(cls, v):
        """Handle NaN from pandas."""
        if v is None:
            return None
        try:
            f = float(v)
            if f != f:  # NaN check
                return None
            return f
        except (TypeError, ValueError):
            return None

    @field_validator("year", mode="before")
    @classmethod
    def coerce_year(cls, v):
        """Handle NaN and float years from pandas."""
        if v is None:
            return None
        try:
            f = float(v)
            if f != f:  # NaN check
                return None
            return int(f)
        except (TypeError, ValueError):
            return None


class TrackSearchResult(TrackRow):
    """Track with search scoring fields."""

    score: float | None = None
    matched: dict | None = None


class TrackExample(BaseModel):
    """Exemplar track shown in tree nodes — minimal fields."""

    title: str
    artist: str
    year: int | None = None
