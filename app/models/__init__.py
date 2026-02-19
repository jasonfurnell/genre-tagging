"""Pydantic v2 models for GenreTagging API types."""

from app.models.common import ErrorResponse, ProgressEvent, SuccessResponse
from app.models.config import AppConfig
from app.models.track import TrackRow, TrackSearchResult
from app.models.tree import (
    Category,
    CollectionTree,
    HierarchicalTree,
    Leaf,
    Lineage,
    MetadataSuggestion,
    TreeFilters,
    TreeNode,
)
from app.models.workshop import (
    Act,
    AutosetResult,
    OrderedTrack,
    Phase,
    PhaseProfile,
    PoolProfile,
    SavedSet,
    SavedSetSummary,
    SetSlot,
    SlotSource,
    TrackOption,
)

__all__ = [
    # common
    "ErrorResponse",
    "ProgressEvent",
    "SuccessResponse",
    # config
    "AppConfig",
    # track
    "TrackRow",
    "TrackSearchResult",
    # tree
    "Category",
    "CollectionTree",
    "HierarchicalTree",
    "Leaf",
    "Lineage",
    "MetadataSuggestion",
    "TreeFilters",
    "TreeNode",
    # workshop
    "Act",
    "AutosetResult",
    "OrderedTrack",
    "Phase",
    "PhaseProfile",
    "PoolProfile",
    "SavedSet",
    "SavedSetSummary",
    "SetSlot",
    "SlotSource",
    "TrackOption",
]
