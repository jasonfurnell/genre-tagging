"""Set Workshop, saved sets, phase profiles, and autoset models."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Track options (per-slot BPM candidates)
# ---------------------------------------------------------------------------

class TrackOption(BaseModel):
    """A track candidate within a set slot."""

    id: int
    title: str
    artist: str
    bpm: float | None = None
    key: str | None = None
    year: int | str | None = None
    has_audio: bool = False
    bpm_level: int | None = None  # target BPM bucket (60, 70, ... 150)

    @field_validator("bpm", mode="before")
    @classmethod
    def coerce_bpm(cls, v):
        if v is None:
            return None
        try:
            f = float(v)
            return None if f != f else f
        except (TypeError, ValueError):
            return None


# ---------------------------------------------------------------------------
# Slot & source
# ---------------------------------------------------------------------------

class SlotSource(BaseModel):
    """Where a slot's tracks come from."""

    type: str  # "playlist" | "tree_node" | "autoset" | "adhoc"
    id: str
    name: str
    tree_type: str | None = None  # "genre" | "scene" | "collection"


class SetSlot(BaseModel):
    """A single slot in a DJ set (3 minutes of music)."""

    id: str
    source: SlotSource | None = None
    tracks: list[TrackOption | None] = []  # sparse: None for empty BPM level slots
    selectedTrackIndex: int | None = None


# ---------------------------------------------------------------------------
# Phase profiles (energy arc)
# ---------------------------------------------------------------------------

class Phase(BaseModel):
    """One phase in a set's energy arc."""

    name: str
    pct: list[int]  # [start_pct, end_pct], e.g. [0, 15]
    desc: str
    color: str  # hex "#RRGGBB"


class PhaseProfile(BaseModel):
    """Named energy arc template for set building."""

    id: str
    name: str
    description: str
    is_default: bool = False
    phases: list[Phase] = []
    created_at: str | None = None
    updated_at: str | None = None


# ---------------------------------------------------------------------------
# Saved sets
# ---------------------------------------------------------------------------

class SavedSet(BaseModel):
    """A complete saved DJ set."""

    id: str
    name: str
    slots: list[SetSlot] = []
    created_at: str
    updated_at: str
    phase_profile_id: str | None = None


class SavedSetSummary(BaseModel):
    """List-view summary of a saved set."""

    id: str
    name: str
    track_count: int = 0
    slot_count: int = 0
    duration_minutes: int = 0
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Autoset
# ---------------------------------------------------------------------------

class Act(BaseModel):
    """One act in an autoset narrative arc."""

    name: str
    pct: list[int]  # [start_pct, end_pct]
    target_track_count: int = 0
    bpm_range: list[float] = []  # [min, max]
    energy_level: int = 5
    mood_targets: list[str] = []
    genre_guidance: list[str] = []
    descriptor_guidance: list[str] = []
    direction: str = "steady"  # ascending | descending | steady | varied
    transition_note: str = ""
    color: str = "#888888"


class OrderedTrack(BaseModel):
    """A track in the final autoset sequence."""

    track_id: int
    act_idx: int
    act_name: str
    title: str
    artist: str
    bpm: float | None = None
    key: str | None = None
    mood: str = ""
    genre1: str = ""


class BpmStats(BaseModel):
    """BPM distribution stats for a track pool."""

    min: float = 0
    max: float = 0
    median: float = 0
    mean: float = 0
    count_with_bpm: int = 0
    histogram: list[dict] = []  # [{bpm_range, count}]


class PoolProfile(BaseModel):
    """Analysis of the source track pool for autoset."""

    track_count: int = 0
    tracks_with_bpm: int = 0
    bpm: BpmStats = BpmStats()
    keys: list[dict] = []  # [{key, count}]
    genres: list[dict] = []
    moods: list[dict] = []
    descriptors: list[dict] = []
    locations: list[dict] = []
    eras: list[dict] = []
    tree_context: dict = {}  # genre/scene/collection → leaf hits


class AutosetResult(BaseModel):
    """Complete output of the autoset pipeline."""

    narrative: str = ""
    acts: list[Act] = []
    ordered_tracks: list[OrderedTrack] = []
    pool_profile: PoolProfile = PoolProfile()
    set: SavedSet | None = None
