"""Asyncio-based background task manager.

Replaces the 11+ daemon threads in the Flask app with managed asyncio tasks.
Provides clean shutdown via FastAPI lifespan, cancel tokens, and progress callbacks.

Usage::

    manager = BackgroundTaskManager()

    async def my_job(cancel: asyncio.Event):
        while not cancel.is_set():
            await do_work()

    manager.start("tree-build", my_job)
    manager.cancel("tree-build")
    await manager.shutdown()  # cancel all, await completion
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class TaskInfo:
    """Metadata for a running background task."""

    name: str
    task: asyncio.Task
    cancel_event: asyncio.Event
    created_at: float  # asyncio loop time


class BackgroundTaskManager:
    """Manages asyncio background tasks with cancellation and clean shutdown.

    Each task receives an ``asyncio.Event`` cancel token. Tasks should
    periodically check ``cancel.is_set()`` and exit gracefully.
    """

    def __init__(self) -> None:
        self._tasks: dict[str, TaskInfo] = {}

    @property
    def running_tasks(self) -> list[str]:
        """Names of currently running tasks."""
        return [name for name, info in self._tasks.items() if not info.task.done()]

    def is_running(self, name: str) -> bool:
        """Check if a named task is currently running."""
        info = self._tasks.get(name)
        return info is not None and not info.task.done()

    def start(
        self,
        name: str,
        coro_fn: Callable[[asyncio.Event], Coroutine[Any, Any, Any]],
        *,
        replace: bool = False,
    ) -> asyncio.Event:
        """Start a named background task.

        Args:
            name: Unique task name (e.g. "tree-build", "tagging").
            coro_fn: Async callable that accepts a cancel Event.
            replace: If True, cancel any existing task with the same name.

        Returns:
            The cancel Event for this task.

        Raises:
            RuntimeError: If a task with this name is already running
                and replace=False.
        """
        if self.is_running(name):
            if replace:
                self.cancel(name)
            else:
                raise RuntimeError(f"Task '{name}' is already running")

        cancel_event = asyncio.Event()
        loop = asyncio.get_event_loop()

        async def _wrapper():
            try:
                logger.info("Background task '%s' started", name)
                await coro_fn(cancel_event)
                logger.info("Background task '%s' completed", name)
            except asyncio.CancelledError:
                logger.info("Background task '%s' cancelled", name)
            except Exception:
                logger.exception("Background task '%s' failed", name)
            finally:
                # Clean up after completion
                self._tasks.pop(name, None)

        task = asyncio.ensure_future(_wrapper())
        self._tasks[name] = TaskInfo(
            name=name,
            task=task,
            cancel_event=cancel_event,
            created_at=loop.time(),
        )
        return cancel_event

    def cancel(self, name: str) -> bool:
        """Request cancellation of a named task.

        Sets the cancel event (cooperative) and also calls task.cancel()
        (forced) to interrupt any awaits.

        Returns:
            True if the task was found and cancelled, False if not found.
        """
        info = self._tasks.get(name)
        if info is None:
            return False

        info.cancel_event.set()
        if not info.task.done():
            info.task.cancel()
        logger.info("Cancellation requested for task '%s'", name)
        return True

    async def shutdown(self, timeout: float = 10.0) -> None:
        """Cancel all tasks and wait for them to finish.

        Called during FastAPI lifespan shutdown.
        """
        if not self._tasks:
            return

        names = list(self._tasks.keys())
        logger.info("Shutting down %d background tasks: %s", len(names), names)

        # Signal all tasks to stop
        for info in self._tasks.values():
            info.cancel_event.set()
            if not info.task.done():
                info.task.cancel()

        # Wait for all tasks with timeout
        tasks = [info.task for info in self._tasks.values() if not info.task.done()]
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=timeout)
            if pending:
                logger.warning(
                    "%d tasks did not finish within %.1fs: %s",
                    len(pending),
                    timeout,
                    [t.get_name() for t in pending],
                )

        self._tasks.clear()
        logger.info("Background task manager shut down")
