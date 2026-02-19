"""Dropbox OAuth2 routes.

Migrated from Flask routes.py — OAuth start/callback/disconnect + status.
"""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.persistence import JsonStore
from app.state import AppState, get_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dropbox", tags=["dropbox"])

_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "output")
_DROPBOX_TOKENS_STORE = JsonStore(os.path.join(_OUTPUT_DIR, "dropbox_tokens.json"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _init_dropbox_client(state: AppState, refresh_token: str) -> None:
    """Create a Dropbox client from a refresh token and store it in state."""
    try:
        import dropbox
    except ImportError:
        logger.warning("dropbox SDK not installed — skipping client init")
        return

    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    if not app_key or not app_secret:
        logger.warning("DROPBOX_APP_KEY or DROPBOX_APP_SECRET not set in .env")
        return
    try:
        dbx = dropbox.Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret,
        )
        state.dropbox_client = dbx
    except Exception:
        logger.exception("Failed to initialize Dropbox client")


async def load_dropbox_tokens(state: AppState) -> None:
    """Load persisted Dropbox tokens and initialize client (called at startup)."""
    data = await _DROPBOX_TOKENS_STORE.load()
    if not data:
        return
    refresh_token = data.get("refresh_token")
    if refresh_token:
        state.dropbox_refresh_token = refresh_token
        state.dropbox_account_id = data.get("account_id", "")
        _init_dropbox_client(state, refresh_token)
        logger.info("Loaded Dropbox tokens from disk")


async def _save_dropbox_tokens(state: AppState) -> None:
    """Persist Dropbox tokens to disk."""
    await _DROPBOX_TOKENS_STORE.save({
        "refresh_token": state.dropbox_refresh_token,
        "account_id": state.dropbox_account_id or "",
    })


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/status")
async def dropbox_status(state: AppState = Depends(get_state)):
    connected = state.dropbox_client is not None
    return {
        "connected": connected,
        "account_id": state.dropbox_account_id or "" if connected else "",
    }


@router.get("/auth-url")
async def dropbox_auth_url(request: Request, state: AppState = Depends(get_state)):
    try:
        from dropbox import DropboxOAuth2Flow
    except ImportError:
        raise HTTPException(status_code=500, detail="dropbox SDK not installed")

    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    if not app_key or not app_secret:
        raise HTTPException(
            status_code=500,
            detail="DROPBOX_APP_KEY/SECRET not configured in .env",
        )

    redirect_uri = str(request.base_url).rstrip("/") + "/api/dropbox/callback"
    session_store: dict = {}
    flow = DropboxOAuth2Flow(
        consumer_key=app_key,
        consumer_secret=app_secret,
        redirect_uri=redirect_uri,
        session=session_store,
        csrf_token_session_key="dropbox-auth-csrf-token",
        token_access_type="offline",
    )
    authorize_url = flow.start()
    state.dropbox_oauth_csrf = session_store.get("dropbox-auth-csrf-token")
    return {"url": authorize_url}


@router.get("/callback", response_class=HTMLResponse)
async def dropbox_callback(request: Request, state: AppState = Depends(get_state)):
    try:
        from dropbox import DropboxOAuth2Flow
    except ImportError:
        return HTMLResponse("<html><body><h3>dropbox SDK not installed</h3></body></html>")

    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    redirect_uri = str(request.base_url).rstrip("/") + "/api/dropbox/callback"

    session_store = {
        "dropbox-auth-csrf-token": state.dropbox_oauth_csrf or "",
    }
    flow = DropboxOAuth2Flow(
        consumer_key=app_key,
        consumer_secret=app_secret,
        redirect_uri=redirect_uri,
        session=session_store,
        csrf_token_session_key="dropbox-auth-csrf-token",
        token_access_type="offline",
    )

    try:
        result = flow.finish(dict(request.query_params))
    except Exception:
        logger.exception("Dropbox OAuth callback failed")
        return HTMLResponse(
            "<html><body><h3>Dropbox connection failed.</h3>"
            "<p>Check the app logs for details.</p>"
            "<script>setTimeout(function(){window.close()},3000)</script>"
            "</body></html>"
        )

    state.dropbox_refresh_token = result.refresh_token
    state.dropbox_account_id = result.account_id
    state.dropbox_exists_cache = {}
    _init_dropbox_client(state, result.refresh_token)
    await _save_dropbox_tokens(state)
    logger.info("Dropbox connected: account_id=%s", result.account_id)

    return HTMLResponse(
        "<html><body><h3>Dropbox connected!</h3>"
        "<p>You can close this window.</p>"
        "<script>setTimeout(function(){window.close()},2000)</script>"
        "</body></html>"
    )


@router.post("/disconnect")
async def dropbox_disconnect(state: AppState = Depends(get_state)):
    state.dropbox_client = None
    state.dropbox_refresh_token = None
    state.dropbox_account_id = None
    state.dropbox_exists_cache = {}
    await _DROPBOX_TOKENS_STORE.delete()
    return {"ok": True}
