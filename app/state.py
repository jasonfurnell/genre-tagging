"""Typed application state with thread-safe accessors.

Replaces the ad-hoc `_state` global dict from routes.py.
FastAPI routes receive this via `Depends(get_state)`.
"""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass, field
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Listener list (SSE broadcast queues) with built-in locking
# ---------------------------------------------------------------------------

class ListenerList:
    """Thread-safe list of queue.Queue used for SSE broadcasting."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._listeners: list[queue.Queue] = []

    def add(self, maxsize: int = 50) -> queue.Queue:
        """Create and register a new listener queue."""
        q: queue.Queue = queue.Queue(maxsize=maxsize)
        with self._lock:
            self._listeners.append(q)
        return q

    def remove(self, q: queue.Queue) -> None:
        """Unregister a listener queue."""
        with self._lock:
            try:
                self._listeners.remove(q)
            except ValueError:
                pass

    def broadcast(self, data: dict) -> None:
        """Send data to all listeners, removing dead ones."""
        with self._lock:
            dead: list[queue.Queue] = []
            for q in self._listeners:
                try:
                    q.put_nowait(data)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self._listeners.remove(q)


# ---------------------------------------------------------------------------
# AppState — typed replacement for _state dict
# ---------------------------------------------------------------------------

@dataclass
class AppState:
    """All mutable session state for the application.

    Thread safety:
    - DataFrame access guarded by `df_lock` (RLock for nested reads)
    - Listener lists have their own internal locks
    - Stop flags are threading.Event (inherently thread-safe)
    - Caches guarded by `cache_lock`
    - Artwork cache guarded by `artwork_cache_lock`
    """

    # -- Core data --
    df: pd.DataFrame = field(default_factory=lambda: pd.DataFrame())
    df_lock: threading.RLock = field(default_factory=threading.RLock)
    original_filename: str = ""

    # -- Tagging --
    tagging_thread: threading.Thread | None = None
    stop_flag: threading.Event = field(default_factory=threading.Event)
    tagging_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Genre tree --
    tree: dict | None = None
    tree_thread: threading.Thread | None = None
    tree_stop_flag: threading.Event = field(default_factory=threading.Event)
    tree_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Scene tree --
    scene_tree: dict | None = None
    scene_tree_thread: threading.Thread | None = None
    scene_tree_stop_flag: threading.Event = field(default_factory=threading.Event)
    scene_tree_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Collection tree --
    collection_tree: dict | None = None
    collection_tree_thread: threading.Thread | None = None
    collection_tree_stop_flag: threading.Event = field(default_factory=threading.Event)
    collection_tree_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Auto set --
    autoset_result: dict | None = None
    autoset_thread: threading.Thread | None = None
    autoset_stop_flag: threading.Event = field(default_factory=threading.Event)
    autoset_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Chat --
    chat_history: list[dict] = field(default_factory=list)
    chat_thread: threading.Thread | None = None
    chat_stop_flag: threading.Event = field(default_factory=threading.Event)
    chat_listeners: ListenerList = field(default_factory=ListenerList)

    # -- Caches --
    cache_lock: threading.Lock = field(default_factory=threading.Lock)
    analysis_cache: dict | None = None
    chord_cache: dict | None = None
    preview_cache: dict = field(default_factory=dict)

    # -- Artwork cache (separate lock — high contention from background workers) --
    artwork_cache_lock: threading.Lock = field(default_factory=threading.Lock)
    artwork_cache: dict = field(default_factory=dict)

    # -- Dropbox --
    dropbox_client: Any = None  # dropbox.Dropbox or None
    dropbox_refresh_token: str | None = None
    dropbox_account_id: str | None = None
    dropbox_oauth_csrf: str | None = None
    dropbox_exists_cache: dict = field(default_factory=dict)

    def invalidate_caches(self) -> None:
        """Clear derived caches (call after upload/re-tag)."""
        with self.cache_lock:
            self.analysis_cache = None
            self.chord_cache = None
            self.preview_cache.clear()


# ---------------------------------------------------------------------------
# Singleton + FastAPI dependency
# ---------------------------------------------------------------------------

_app_state: AppState | None = None


def get_state() -> AppState:
    """FastAPI dependency — returns the singleton AppState.

    Usage in routers::

        @router.get("/api/tracks")
        async def tracks(state: AppState = Depends(get_state)):
            ...
    """
    global _app_state
    if _app_state is None:
        _app_state = AppState()
    return _app_state


def reset_state() -> AppState:
    """Create a fresh AppState (for testing or app restart)."""
    global _app_state
    _app_state = AppState()
    return _app_state
