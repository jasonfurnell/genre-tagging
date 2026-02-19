"""Tree models — genre tree, scene tree, and collection tree structures."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.track import TrackExample


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

class TreeFilters(BaseModel):
    """Filter criteria attached to tree nodes for track scoring."""

    genres: list[str] = []
    era: list[str] = []
    location: list[str] = []
    mood: list[str] = []
    descriptors: list[str] = []
    bpm_min: float | None = None
    bpm_max: float | None = None
    year_min: int | None = None
    year_max: int | None = None


# ---------------------------------------------------------------------------
# Genre & Scene trees (hierarchical, recursive children)
# ---------------------------------------------------------------------------

class TreeNode(BaseModel):
    """Recursive tree node used in genre/scene trees.

    Depth 0 = lineage, 1 = primary branch, 2 = secondary, 3 = tertiary leaf.
    """

    id: str
    title: str
    description: str | None = None
    subtitle: str | None = None
    filters: TreeFilters | None = None
    track_ids: list[int] = []
    track_count: int = 0
    is_leaf: bool = False
    children: list[TreeNode] = []
    examples: list[TrackExample] = []


# Pydantic v2 handles forward refs automatically, but we need the rebuild
# for the self-referencing `children` field.
TreeNode.model_rebuild()

# Lineage is just a top-level TreeNode (alias for clarity in docs)
Lineage = TreeNode


class HierarchicalTree(BaseModel):
    """Root structure for genre and scene trees."""

    id: str
    tree_type: str | None = None  # "genre" | "scene" (not always present in saved JSON)
    created_at: str
    total_tracks: int = 0
    assigned_tracks: int = 0
    ungrouped_track_ids: list[int] = []
    lineages: list[Lineage] = []
    status: str = "complete"  # "complete" | "stopped" | "error"


# ---------------------------------------------------------------------------
# Collection tree (flat 2-level: categories → leaves)
# ---------------------------------------------------------------------------

class MetadataSuggestion(BaseModel):
    """Per-track metadata improvement suggestion from enrichment phase."""

    track_id: int
    suggestions: dict  # genre_refinement, scene_tags, descriptors, era_refinement
    confidence: float = 0.0
    reasoning: str = ""


class Leaf(BaseModel):
    """Collection tree leaf — a curated playlist-like cluster."""

    id: str
    title: str
    description: str | None = None
    track_ids: list[int] = []
    track_count: int = 0
    examples: list[TrackExample] = []
    genre_context: str | None = None
    scene_context: str | None = None
    metadata_suggestions: list[MetadataSuggestion] = []


class Category(BaseModel):
    """Top-level grouping of leaves in a collection tree."""

    id: str
    title: str
    description: str | None = None
    track_ids: list[int] = []
    track_count: int = 0
    leaves: list[Leaf] = []


class SourceTreeRef(BaseModel):
    """Reference to a source tree used to build the collection."""

    id: str
    created_at: str


class CollectionTree(BaseModel):
    """Root structure for the collection tree."""

    id: str
    tree_type: str = "collection"
    created_at: str
    total_tracks: int = 0
    assigned_tracks: int = 0
    ungrouped_track_ids: list[int] = []
    source_trees: dict[str, SourceTreeRef] = {}  # "genre" / "scene" → ref
    categories: list[Category] = []
    status: str = "complete"
