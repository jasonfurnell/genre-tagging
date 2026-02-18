"""
Chat tool layer — functions the LLM can call during conversation.

Each tool receives the _state dict and keyword arguments from the LLM,
returns a JSON-serializable dict. The CHAT_TOOLS registry maps tool names
to their function, JSON Schema, and metadata.
"""

import json
import logging
import pandas as pd

from app.parser import (
    build_genre_landscape_summary, build_facet_options,
    scored_search, parse_all_comments,
)
from app.playlist import (
    list_playlists as _list_playlists,
    get_playlist as _get_playlist,
    create_playlist as _create_playlist,
    add_tracks_to_playlist as _add_tracks_to_playlist,
)
from app.tree import load_tree, find_node
from app.setbuilder import list_saved_sets as _list_saved_sets

log = logging.getLogger(__name__)

# Tree file paths (same as tree.py / routes.py)
_TREE_FILES = {
    "genre": "output/collection_tree.json",
    "scene": "output/scene_tree.json",
    "collection": "output/curated_collection.json",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_val(val):
    """Convert numpy/pandas types to JSON-safe Python types."""
    if pd.isna(val):
        return ""
    if hasattr(val, "item"):
        return val.item()
    return val


def _track_summary(df, idx):
    """Build a compact track dict for search results."""
    row = df.loc[idx]
    return {
        "id": int(idx),
        "title": _safe_val(row.get("title", "")),
        "artist": _safe_val(row.get("artist", "")),
        "bpm": _safe_val(row.get("bpm", "")),
        "key": _safe_val(row.get("key", "")),
        "year": _safe_val(row.get("year", "")),
        "genre1": _safe_val(row.get("_genre1", "")),
        "genre2": _safe_val(row.get("_genre2", "")),
        "mood": _safe_val(row.get("_mood", "")),
    }


def _track_detail(df, idx):
    """Build a full track dict for detail view."""
    row = df.loc[idx]
    d = {"id": int(idx)}
    for col in df.columns:
        if not col.startswith("_"):
            d[col] = _safe_val(row[col])
    # Include parsed facets too
    for col in ("_genre1", "_genre2", "_descriptors", "_mood", "_location", "_era"):
        if col in df.columns:
            d[col.lstrip("_")] = _safe_val(row[col])
    return d


def _ensure_parsed(df):
    """Ensure facet columns exist."""
    if "_genre1" not in df.columns:
        parse_all_comments(df)


# ---------------------------------------------------------------------------
# Tool functions
# ---------------------------------------------------------------------------

def collection_stats(state, **kwargs):
    """Get overview statistics about the loaded music collection."""
    df = state["df"]
    _ensure_parsed(df)
    facets = build_facet_options(df)
    summary = build_genre_landscape_summary(df)

    bpm_vals = pd.to_numeric(df.get("bpm", pd.Series(dtype=float)), errors="coerce").dropna()

    return {
        "track_count": len(df),
        "top_genres": [g["value"] for g in facets.get("genres", [])[:20]],
        "top_moods": [m["value"] for m in facets.get("moods", [])[:15]],
        "top_locations": [l["value"] for l in facets.get("locations", [])[:15]],
        "top_eras": [e["value"] for e in facets.get("eras", [])[:15]],
        "bpm_range": {
            "min": round(float(bpm_vals.min()), 1) if len(bpm_vals) else None,
            "max": round(float(bpm_vals.max()), 1) if len(bpm_vals) else None,
            "median": round(float(bpm_vals.median()), 1) if len(bpm_vals) else None,
        },
        "landscape_summary": summary,
    }


def search_tracks(state, genres=None, mood=None, descriptors=None,
                  location=None, era=None, bpm_min=None, bpm_max=None,
                  year_min=None, year_max=None, text_search=None,
                  limit=20, **kwargs):
    """Search the music collection with faceted filters and scoring."""
    df = state["df"]
    _ensure_parsed(df)

    filters = {}
    if genres:
        filters["genres"] = genres
    if mood:
        filters["mood"] = mood
    if descriptors:
        filters["descriptors"] = descriptors
    if location:
        filters["location"] = location
    if era:
        filters["era"] = era
    if bpm_min is not None:
        filters["bpm_min"] = bpm_min
    if bpm_max is not None:
        filters["bpm_max"] = bpm_max
    if year_min is not None:
        filters["year_min"] = year_min
    if year_max is not None:
        filters["year_max"] = year_max
    if text_search:
        filters["text_search"] = text_search

    if not filters:
        return {"error": "No search filters provided. Specify at least one filter (genres, mood, descriptors, location, era, bpm range, year range, or text_search)."}

    results = scored_search(df, filters, min_score=0.0, max_results=min(limit or 20, 200))
    tracks = []
    for idx, score, matched in results:
        t = _track_summary(df, idx)
        t["score"] = round(score, 3)
        tracks.append(t)

    return {
        "count": len(tracks),
        "total_matches": len(results),
        "tracks": tracks,
    }


def get_track_details(state, track_ids=None, **kwargs):
    """Get full metadata for specific tracks by ID."""
    if not track_ids:
        return {"error": "No track_ids provided."}

    df = state["df"]
    _ensure_parsed(df)

    tracks = []
    for tid in track_ids[:50]:  # cap at 50
        if tid in df.index:
            tracks.append(_track_detail(df, tid))

    return {"tracks": tracks, "count": len(tracks)}


def browse_tree(state, tree_type="genre", node_id=None, **kwargs):
    """Browse genre/scene/collection trees. Without node_id, returns top-level."""
    file_path = _TREE_FILES.get(tree_type)
    if not file_path:
        return {"error": f"Unknown tree_type '{tree_type}'. Use 'genre', 'scene', or 'collection'."}

    tree = load_tree(file_path)
    if not tree:
        # Also check _state for in-memory trees
        key_map = {"genre": "tree", "scene": "scene_tree", "collection": "collection_tree"}
        tree = state.get(key_map.get(tree_type))

    if not tree:
        return {"error": f"No {tree_type} tree available. It may need to be built first."}

    if node_id:
        node = find_node(tree, node_id)
        if not node:
            return {"error": f"Node '{node_id}' not found in {tree_type} tree."}
        result = {
            "tree_type": tree_type,
            "node": {
                "id": node.get("id", ""),
                "title": node.get("title", ""),
                "description": node.get("description", ""),
                "track_count": node.get("track_count", len(node.get("track_ids", []))),
                "track_ids": node.get("track_ids", [])[:50],  # cap for context
            },
        }
        # Include children summary for hierarchical trees
        children = node.get("children", [])
        if children:
            result["node"]["children"] = [
                {"id": c.get("id", ""), "title": c.get("title", ""),
                 "track_count": c.get("track_count", len(c.get("track_ids", [])))}
                for c in children
            ]
        # Include leaves for collection tree categories
        leaves = node.get("leaves", [])
        if leaves:
            result["node"]["leaves"] = [
                {"id": l.get("id", ""), "title": l.get("title", ""),
                 "track_count": l.get("track_count", len(l.get("track_ids", [])))}
                for l in leaves
            ]
        return result

    # Top-level overview
    if tree_type == "collection":
        categories = tree.get("categories", [])
        return {
            "tree_type": "collection",
            "categories": [
                {"id": c.get("id", ""), "title": c.get("title", ""),
                 "track_count": c.get("track_count", 0),
                 "leaf_count": len(c.get("leaves", []))}
                for c in categories
            ],
        }
    else:
        lineages = tree.get("lineages", [])
        return {
            "tree_type": tree_type,
            "lineages": [
                {"id": l.get("id", ""), "title": l.get("title", ""),
                 "subtitle": l.get("subtitle", ""),
                 "track_count": l.get("track_count", 0),
                 "child_count": len(l.get("children", []))}
                for l in lineages
            ],
        }


def list_playlists_tool(state, **kwargs):
    """List all saved playlists."""
    playlists = _list_playlists()
    return {
        "playlists": [
            {
                "id": p["id"],
                "name": p["name"],
                "description": p.get("description", ""),
                "track_count": len(p.get("track_ids", [])),
            }
            for p in playlists
        ],
        "count": len(playlists),
    }


def get_playlist_tracks(state, playlist_id=None, **kwargs):
    """Get tracks in a specific playlist."""
    if not playlist_id:
        return {"error": "No playlist_id provided."}

    pl = _get_playlist(playlist_id)
    if not pl:
        return {"error": f"Playlist '{playlist_id}' not found."}

    df = state["df"]
    _ensure_parsed(df)

    track_ids = pl.get("track_ids", [])
    tracks = []
    for tid in track_ids[:100]:  # cap at 100
        if tid in df.index:
            tracks.append(_track_summary(df, tid))

    return {
        "playlist": {"id": pl["id"], "name": pl["name"]},
        "tracks": tracks,
        "count": len(tracks),
    }


def list_sets_tool(state, **kwargs):
    """List all saved DJ sets."""
    sets = _list_saved_sets()
    return {
        "sets": [
            {
                "id": s["id"],
                "name": s["name"],
                "slot_count": len(s.get("slots", [])),
            }
            for s in sets
        ],
        "count": len(sets),
    }


def create_playlist_tool(state, name=None, description="", filters=None,
                         track_ids=None, **kwargs):
    """Create a new playlist from filters and/or explicit track IDs."""
    if not name:
        return {"error": "Playlist name is required."}

    df = state["df"]
    _ensure_parsed(df)

    resolved_ids = list(track_ids) if track_ids else []

    # If filters provided but no track_ids, search for matching tracks
    if filters and not resolved_ids:
        results = scored_search(df, filters, min_score=0.0, max_results=200)
        resolved_ids = [idx for idx, score, matched in results]

    if not resolved_ids:
        return {"error": "No tracks matched the filters. Try broadening your search."}

    # Validate track IDs exist
    valid_ids = [tid for tid in resolved_ids if tid in df.index]

    pl = _create_playlist(name=name, description=description,
                          filters=filters, track_ids=valid_ids, source="chat")
    return {
        "playlist": {"id": pl["id"], "name": pl["name"]},
        "track_count": len(valid_ids),
        "message": f"Created playlist '{name}' with {len(valid_ids)} tracks.",
    }


def add_tracks_to_playlist_tool(state, playlist_id=None, track_ids=None, **kwargs):
    """Add tracks to an existing playlist."""
    if not playlist_id:
        return {"error": "No playlist_id provided."}
    if not track_ids:
        return {"error": "No track_ids provided."}

    pl = _add_tracks_to_playlist(playlist_id, track_ids)
    if not pl:
        return {"error": f"Playlist '{playlist_id}' not found."}

    return {
        "playlist": {"id": pl["id"], "name": pl["name"]},
        "track_count": len(pl.get("track_ids", [])),
        "added": len(track_ids),
        "message": f"Added {len(track_ids)} tracks to '{pl['name']}'.",
    }


# ---------------------------------------------------------------------------
# Tool Registry
# ---------------------------------------------------------------------------

CHAT_TOOLS = {
    "collection_stats": {
        "function": collection_stats,
        "description": "Get overview statistics about the loaded music collection including track count, top genres, moods, locations, eras, and BPM range.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "mutates": False,
    },
    "search_tracks": {
        "function": search_tracks,
        "description": "Search the music collection with faceted filters. Returns ranked tracks with relevance scores. Use at least one filter.",
        "parameters": {
            "type": "object",
            "properties": {
                "genres": {"type": "array", "items": {"type": "string"}, "description": "Genre names to match (e.g. 'House', 'Hip-Hop', 'Jazz')"},
                "mood": {"type": "array", "items": {"type": "string"}, "description": "Mood keywords (e.g. 'uplifting', 'dark', 'melancholic')"},
                "descriptors": {"type": "array", "items": {"type": "string"}, "description": "Production/style descriptors (e.g. 'sampling', 'analog synths', 'live drums')"},
                "location": {"type": "array", "items": {"type": "string"}, "description": "Geographic origin (e.g. 'NYC', 'Detroit', 'London')"},
                "era": {"type": "array", "items": {"type": "string"}, "description": "Time period (e.g. 'early 90s', 'late 70s', '2010s')"},
                "bpm_min": {"type": "number", "description": "Minimum BPM"},
                "bpm_max": {"type": "number", "description": "Maximum BPM"},
                "year_min": {"type": "integer", "description": "Minimum release year"},
                "year_max": {"type": "integer", "description": "Maximum release year"},
                "text_search": {"type": "string", "description": "Free-text search across title, artist, album, comment"},
                "limit": {"type": "integer", "description": "Maximum results to return (default 20, max 200)"},
            },
            "required": [],
        },
        "mutates": False,
    },
    "get_track_details": {
        "function": get_track_details,
        "description": "Get full metadata for specific tracks by their IDs. Use after searching to get complete details.",
        "parameters": {
            "type": "object",
            "properties": {
                "track_ids": {"type": "array", "items": {"type": "integer"}, "description": "List of track IDs to retrieve"},
            },
            "required": ["track_ids"],
        },
        "mutates": False,
    },
    "browse_tree": {
        "function": browse_tree,
        "description": "Browse the genre, scene, or collection trees. Without node_id returns the top-level structure. With node_id returns details of that node including children/leaves.",
        "parameters": {
            "type": "object",
            "properties": {
                "tree_type": {"type": "string", "enum": ["genre", "scene", "collection"], "description": "Which tree to browse"},
                "node_id": {"type": "string", "description": "ID of a specific node to inspect. Omit for top-level overview."},
            },
            "required": ["tree_type"],
        },
        "mutates": False,
    },
    "list_playlists": {
        "function": list_playlists_tool,
        "description": "List all saved playlists with their names, descriptions, and track counts.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "mutates": False,
    },
    "get_playlist_tracks": {
        "function": get_playlist_tracks,
        "description": "Get the tracks in a specific playlist by playlist ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "playlist_id": {"type": "string", "description": "The playlist ID"},
            },
            "required": ["playlist_id"],
        },
        "mutates": False,
    },
    "list_sets": {
        "function": list_sets_tool,
        "description": "List all saved DJ sets from the Set Workshop.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "mutates": False,
    },
    "create_playlist": {
        "function": create_playlist_tool,
        "description": "Create a new playlist. Provide either track_ids directly or filters to auto-select matching tracks. Always confirm with the user before creating.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name for the playlist"},
                "description": {"type": "string", "description": "Optional description"},
                "filters": {
                    "type": "object",
                    "description": "Faceted filters to auto-select tracks (same format as search_tracks)",
                    "properties": {
                        "genres": {"type": "array", "items": {"type": "string"}},
                        "mood": {"type": "array", "items": {"type": "string"}},
                        "descriptors": {"type": "array", "items": {"type": "string"}},
                        "location": {"type": "array", "items": {"type": "string"}},
                        "era": {"type": "array", "items": {"type": "string"}},
                        "bpm_min": {"type": "number"},
                        "bpm_max": {"type": "number"},
                    },
                },
                "track_ids": {"type": "array", "items": {"type": "integer"}, "description": "Explicit track IDs to include"},
            },
            "required": ["name"],
        },
        "mutates": True,
    },
    "add_tracks_to_playlist": {
        "function": add_tracks_to_playlist_tool,
        "description": "Add tracks to an existing playlist by playlist ID and track IDs.",
        "parameters": {
            "type": "object",
            "properties": {
                "playlist_id": {"type": "string", "description": "The playlist ID to add tracks to"},
                "track_ids": {"type": "array", "items": {"type": "integer"}, "description": "Track IDs to add"},
            },
            "required": ["playlist_id", "track_ids"],
        },
        "mutates": True,
    },
}


# ---------------------------------------------------------------------------
# Schema converters
# ---------------------------------------------------------------------------

def tools_for_anthropic():
    """Convert CHAT_TOOLS to Anthropic tool-use format."""
    return [
        {
            "name": name,
            "description": spec["description"],
            "input_schema": spec["parameters"],
        }
        for name, spec in CHAT_TOOLS.items()
    ]


def tools_for_openai():
    """Convert CHAT_TOOLS to OpenAI tool-use format."""
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": spec["description"],
                "parameters": spec["parameters"],
            },
        }
        for name, spec in CHAT_TOOLS.items()
    ]


def execute_tool(tool_name, arguments, state):
    """Look up and execute a tool by name, return result dict."""
    spec = CHAT_TOOLS.get(tool_name)
    if not spec:
        return {"error": f"Unknown tool '{tool_name}'."}

    try:
        return spec["function"](state, **arguments)
    except Exception as e:
        log.exception("Tool %s failed", tool_name)
        return {"error": f"Tool '{tool_name}' failed: {str(e)}"}
