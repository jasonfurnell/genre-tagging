"""Async JSON file persistence with atomic writes and file locking.

Replaces scattered json.load/json.dump calls across routes.py, tree.py,
playlist.py, setbuilder.py, phases.py, and config.py.

Usage::

    store = JsonStore("output/playlists.json")
    data = await store.load(default={})
    data["new_key"] = "value"
    await store.save(data)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from typing import Any

import aiofiles
import aiofiles.os

logger = logging.getLogger(__name__)


class JsonStore:
    """Async JSON file store with atomic writes.

    - **Atomic writes**: data is written to a temp file then renamed,
      preventing corruption from crashes or concurrent access.
    - **Async I/O**: uses aiofiles for non-blocking reads/writes.
    - **Per-store lock**: asyncio.Lock prevents concurrent writes to the
      same file (replaces _artwork_cache_lock pattern).
    """

    def __init__(self, path: str, indent: int = 2) -> None:
        self.path = os.path.abspath(path)
        self.indent = indent
        self._lock = asyncio.Lock()

    async def load(self, default: Any = None) -> Any:
        """Load JSON from file. Returns ``default`` if file doesn't exist."""
        try:
            async with aiofiles.open(self.path, "r") as f:
                text = await f.read()
            return json.loads(text)
        except FileNotFoundError:
            return default if default is not None else {}
        except json.JSONDecodeError:
            logger.warning("Corrupt JSON in %s — returning default", self.path)
            return default if default is not None else {}

    async def save(self, data: Any) -> None:
        """Save data to JSON file atomically (write temp → rename)."""
        async with self._lock:
            dir_name = os.path.dirname(self.path)
            await aiofiles.os.makedirs(dir_name, exist_ok=True)

            # Write to temp file in the same directory (same filesystem for rename)
            fd, tmp_path = tempfile.mkstemp(
                dir=dir_name, suffix=".tmp", prefix=".jsonstore_"
            )
            try:
                async with aiofiles.open(fd, "w", closefd=True) as f:
                    await f.write(json.dumps(data, indent=self.indent, ensure_ascii=False))
                # Atomic rename
                os.replace(tmp_path, self.path)
            except BaseException:
                # Clean up temp file on failure
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

    async def update(self, fn: Any, default: Any = None) -> Any:
        """Load, apply fn, save, and return the updated data.

        Convenience for read-modify-write cycles::

            await store.update(lambda d: {**d, "key": "value"})
        """
        async with self._lock:
            data = await self._load_unlocked(default)
            data = fn(data)
            await self._save_unlocked(data)
            return data

    async def exists(self) -> bool:
        """Check if the JSON file exists."""
        return await aiofiles.os.path.exists(self.path)

    async def delete(self) -> bool:
        """Delete the JSON file if it exists. Returns True if deleted."""
        try:
            await aiofiles.os.remove(self.path)
            return True
        except FileNotFoundError:
            return False

    # -- Internal helpers (no locking, used by update) --

    async def _load_unlocked(self, default: Any = None) -> Any:
        try:
            async with aiofiles.open(self.path, "r") as f:
                text = await f.read()
            return json.loads(text)
        except (FileNotFoundError, json.JSONDecodeError):
            return default if default is not None else {}

    async def _save_unlocked(self, data: Any) -> None:
        dir_name = os.path.dirname(self.path)
        await aiofiles.os.makedirs(dir_name, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=dir_name, suffix=".tmp", prefix=".jsonstore_"
        )
        try:
            async with aiofiles.open(fd, "w", closefd=True) as f:
                await f.write(json.dumps(data, indent=self.indent, ensure_ascii=False))
            os.replace(tmp_path, self.path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
