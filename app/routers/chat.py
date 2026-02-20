"""Chat (conversational AI with tool-use) routes.

Extracted from sets.py — 5 routes for the Chat tab's conversational AI
interface, backed by app/chat.py tool-use loop and app/chat_tools.py.
"""

import logging
import os
import threading

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import load_config
from app.parser import parse_all_comments
from app.state import AppState, get_state
from app.routers.tagging import sse_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _provider_for_model(model: str) -> str:
    return "anthropic" if model.startswith("claude") else "openai"


def _get_client(provider: str):
    if provider == "anthropic":
        from anthropic import Anthropic
        return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    from openai import OpenAI
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _ensure_parsed(state: AppState) -> pd.DataFrame | None:
    with state.df_lock:
        if state.df.empty:
            return None
        parse_all_comments(state.df)
        return state.df


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ChatMessageBody(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/chat/message", status_code=202)
async def chat_message(body: ChatMessageBody, state: AppState = Depends(get_state)):
    from app.chat import run_chat_turn

    df = _ensure_parsed(state)
    if df is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    t = state.chat_thread
    if t and t.is_alive():
        raise HTTPException(status_code=409, detail="Chat request already in progress")

    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Empty message")

    state.chat_stop_flag.clear()
    listeners = state.chat_listeners

    # Build a dict that the chat module expects (V1 _state compatibility)
    chat_state = {
        "df": state.df,
        "chat_history": state.chat_history,
        "chat_stop_flag": state.chat_stop_flag,
        "tree": state.tree,
        "scene_tree": state.scene_tree,
        "collection_tree": state.collection_tree,
    }

    def broadcast(data):
        listeners.broadcast(data)

    def worker():
        try:
            run_chat_turn(
                chat_state, user_message, broadcast, state.chat_stop_flag,
                get_client_fn=_get_client,
                provider_for_model_fn=_provider_for_model,
                load_config_fn=load_config,
            )
            # Sync history back to state
            state.chat_history = chat_state["chat_history"]
        except Exception as e:
            logger.exception("Chat turn failed")
            broadcast({"event": "error", "detail": str(e)})

    thread = threading.Thread(target=worker, daemon=True)
    state.chat_thread = thread
    thread.start()
    return {"started": True}


@router.get("/chat/progress")
async def chat_progress(state: AppState = Depends(get_state)):
    return StreamingResponse(
        sse_stream(state.chat_listeners, terminal_events=("done", "error", "stopped")),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/chat/history")
async def chat_history(state: AppState = Depends(get_state)):
    from app.chat import simplify_history_for_frontend
    history = state.chat_history or []
    messages = simplify_history_for_frontend(history)
    return {"messages": messages}


@router.post("/chat/clear")
async def chat_clear(state: AppState = Depends(get_state)):
    state.chat_stop_flag.set()
    state.chat_history = []
    return {"cleared": True}


@router.post("/chat/stop")
async def chat_stop(state: AppState = Depends(get_state)):
    state.chat_stop_flag.set()
    return {"stopped": True}
