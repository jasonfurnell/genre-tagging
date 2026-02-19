"""Artwork and audio routes.

Migrated from Flask routes.py — artwork lookup (Deezer/iTunes), caching,
warm-up, batch, retry-not-found, download-all, serve images, and audio serving.
"""

import colorsys
import hashlib
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

from app.config import load_config
from app.state import AppState, get_state

logger = logging.getLogger(__name__)

router = APIRouter(tags=["artwork"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_ARTWORK_DIR = os.path.join(_PROJECT_ROOT, "output", "artwork")
_ARTWORK_CACHE_FILE = os.path.join(_PROJECT_ROOT, "output", "artwork_cache.json")
os.makedirs(_ARTWORK_DIR, exist_ok=True)

_NOT_FOUND_RETRY_SECS = 86400  # retry not-found lookups after 24h

# Regex for validating artwork filenames (security: prevent path traversal)
_ARTWORK_FILENAME_RE = re.compile(r"^[a-f0-9]{32}_(small|big)\.jpg$")


# ---------------------------------------------------------------------------
# Artwork cache persistence
# ---------------------------------------------------------------------------

_artwork_cache_lock = threading.Lock()


def _load_artwork_cache(state: AppState) -> None:
    """Load artwork cache from disk into state."""
    try:
        if os.path.exists(_ARTWORK_CACHE_FILE):
            with open(_ARTWORK_CACHE_FILE, "r") as f:
                with state.artwork_cache_lock:
                    state.artwork_cache = json.load(f)
            logger.info("Loaded %d artwork cache entries from disk",
                        len(state.artwork_cache))
    except Exception:
        logger.exception("Failed to load artwork cache from disk")


def _save_artwork_cache(state: AppState) -> None:
    """Persist artwork cache to disk (thread-safe)."""
    with _artwork_cache_lock:
        try:
            with state.artwork_cache_lock:
                snapshot = dict(state.artwork_cache)
            tmp = _ARTWORK_CACHE_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(snapshot, f)
            os.replace(tmp, _ARTWORK_CACHE_FILE)
        except Exception:
            logger.exception("Failed to save artwork cache to disk")


def init_artwork_cache(state: AppState) -> None:
    """Called at startup to load the persistent artwork cache."""
    _load_artwork_cache(state)


# ---------------------------------------------------------------------------
# Artwork filename / URL helpers
# ---------------------------------------------------------------------------


def _artwork_filename(cache_key: str, size: str = "small") -> str:
    """Deterministic filename for a cached artwork image."""
    h = hashlib.md5(cache_key.encode()).hexdigest()
    return f"{h}_{size}.jpg"


def _artwork_url(fname: str) -> str:
    """Return artwork URL with mtime cache-buster."""
    fpath = os.path.join(_ARTWORK_DIR, fname)
    try:
        v = int(os.path.getmtime(fpath))
    except OSError:
        v = 0
    return f"/artwork/{fname}?v={v}"


def _download_artwork_local(url: str, cache_key: str, size: str = "small") -> str:
    """Download a single artwork image to local disk. Returns local URL or ''."""
    if not url:
        return ""
    fname = _artwork_filename(cache_key, size)
    local_path = os.path.join(_ARTWORK_DIR, fname)
    if os.path.exists(local_path):
        return f"/artwork/{fname}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = resp.read()
        with open(local_path, "wb") as f:
            f.write(data)
        return f"/artwork/{fname}"
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Artwork lookup (Deezer → iTunes → Placeholder)
# ---------------------------------------------------------------------------


def _ensure_local_artwork(entry: dict, cache_key: str, state: AppState) -> None:
    """If a cache entry still has CDN URLs, download locally and update in-place."""
    if not entry.get("found"):
        return
    changed = False
    for field, size in [("cover_url", "small"), ("cover_big", "big")]:
        url = entry.get(field, "")
        if url and not url.startswith("/artwork/"):
            local = _download_artwork_local(url, cache_key, size)
            if local:
                entry[field] = local
                changed = True
    if changed:
        with state.artwork_cache_lock:
            state.artwork_cache[cache_key] = entry


def _lookup_artwork(artist: str, title: str, state: AppState) -> dict:
    """Look up artwork for a single track. Returns dict with cover_url/found."""
    cache_key = f"{artist.lower()}||{title.lower()}"

    # Disk-first: if local files exist, trust them
    small_fname = _artwork_filename(cache_key, "small")
    if os.path.exists(os.path.join(_ARTWORK_DIR, small_fname)):
        big_fname = _artwork_filename(cache_key, "big")
        big_path = os.path.join(_ARTWORK_DIR, big_fname)
        result = {
            "cover_url": _artwork_url(small_fname),
            "cover_big": _artwork_url(big_fname) if os.path.exists(big_path)
                         else _artwork_url(small_fname),
            "found": True,
        }
        with state.artwork_cache_lock:
            if cache_key not in state.artwork_cache or \
               not state.artwork_cache[cache_key].get("found"):
                state.artwork_cache[cache_key] = result
        return result

    with state.artwork_cache_lock:
        cached = state.artwork_cache.get(cache_key)
    if cached is not None:
        if not cached.get("found"):
            cached_at = cached.get("_ts", 0)
            if time.time() - cached_at < _NOT_FOUND_RETRY_SECS:
                return cached
        else:
            _ensure_local_artwork(cached, cache_key, state)
            return cached

    # Deezer lookup
    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://api.deezer.com/search?q={query}&limit=5"
    result = {"cover_url": "", "found": False, "_ts": time.time()}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tracks = data.get("data", [])
        if tracks:
            best = None
            a_low, t_low = artist.lower(), title.lower()
            for t in tracks:
                d_artist = (t.get("artist", {}).get("name") or "").lower()
                d_title = (t.get("title") or "").lower()
                if (a_low in d_artist or d_artist in a_low) and \
                   (t_low in d_title or d_title in t_low):
                    best = t
                    break
            if best is None:
                best = tracks[0]

            album = best.get("album", {})
            cover = album.get("cover_small", "")
            cover_big = album.get("cover_big", "") or album.get("cover_medium", "") or cover
            if cover:
                result = {"cover_url": cover, "cover_big": cover_big, "found": True}
                local_small = _download_artwork_local(cover, cache_key, "small")
                local_big = _download_artwork_local(cover_big, cache_key, "big")
                if local_small:
                    result["cover_url"] = local_small
                if local_big:
                    result["cover_big"] = local_big
    except Exception:
        logger.exception("Deezer artwork lookup failed for %s - %s", artist, title)
        return result

    with state.artwork_cache_lock:
        state.artwork_cache[cache_key] = result
    return result


# ---------------------------------------------------------------------------
# iTunes fallback
# ---------------------------------------------------------------------------


def _lookup_artwork_itunes(artist: str, title: str, cache_key: str) -> dict | None:
    """Try iTunes Search API. Returns cache entry dict or None."""
    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://itunes.apple.com/search?term={query}&media=music&limit=5"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        results = data.get("results", [])
        if not results:
            return None

        a_low, t_low = artist.lower(), title.lower()
        best = None
        for r in results:
            r_artist = (r.get("artistName") or "").lower()
            r_title = (r.get("trackName") or "").lower()
            if (a_low in r_artist or r_artist in a_low) and \
               (t_low in r_title or r_title in t_low):
                best = r
                break
        if best is None:
            best = results[0]

        art_url = best.get("artworkUrl100", "")
        if not art_url:
            return None

        small_url = art_url.replace("100x100", "60x60")
        big_url = art_url.replace("100x100", "600x600")

        local_small = _download_artwork_local(small_url, cache_key, "small")
        local_big = _download_artwork_local(big_url, cache_key, "big")
        if not local_small:
            return None

        return {
            "cover_url": local_small,
            "cover_big": local_big or local_small,
            "found": True,
            "source": "itunes",
        }
    except Exception:
        logger.exception("iTunes artwork lookup failed for %s - %s", artist, title)
        return None


# ---------------------------------------------------------------------------
# Placeholder image generation
# ---------------------------------------------------------------------------


def _generate_placeholder(artist: str, title: str, cache_key: str) -> dict:
    """Generate a placeholder image with artist initials. Returns cache entry."""
    from PIL import Image, ImageDraw, ImageFont

    words = (artist or "?").split()
    initials = "".join(w[0].upper() for w in words[:2]) if words else "?"

    h = hashlib.md5(cache_key.encode()).hexdigest()
    hue = int(h[:2], 16) / 255.0
    r, g, b = colorsys.hls_to_rgb(hue, 0.30, 0.40)
    bg = (int(r * 255), int(g * 255), int(b * 255))

    for size_name, px in [("small", 60), ("big", 600)]:
        img = Image.new("RGB", (px, px), bg)
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc",
                                      size=px // 3)
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), initials, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (px - tw) // 2
        y = (px - th) // 2 - bbox[1]
        draw.text((x, y), initials, fill=(255, 255, 255, 200), font=font)

        fname = _artwork_filename(cache_key, size_name)
        local_path = os.path.join(_ARTWORK_DIR, fname)
        img.save(local_path, "JPEG", quality=85)

    return {
        "cover_url": f"/artwork/{_artwork_filename(cache_key, 'small')}",
        "cover_big": f"/artwork/{_artwork_filename(cache_key, 'big')}",
        "found": True,
        "source": "placeholder",
    }


# ---------------------------------------------------------------------------
# Background worker state (retry-not-found, warm-cache, download-all)
# ---------------------------------------------------------------------------

_retry_artwork_state = {
    "running": False, "total": 0, "done": 0,
    "itunes_found": 0, "placeholders": 0,
}

_warm_cache_state = {
    "running": False, "total": 0, "done": 0,
    "found": 0, "skipped": 0,
}

_download_all_state = {
    "running": False, "total": 0, "done": 0, "downloaded": 0,
}

_artwork_cache_dirty = 0


# ---------------------------------------------------------------------------
# Background workers
# ---------------------------------------------------------------------------


def _retry_artwork_worker(state: AppState) -> None:
    """Background: try iTunes for all not-found entries, then generate placeholders."""
    st = _retry_artwork_state
    try:
        with state.artwork_cache_lock:
            not_found = [
                (key, entry) for key, entry in state.artwork_cache.items()
                if isinstance(entry, dict) and not entry.get("found")
            ]
        st["total"] = len(not_found)
        st["done"] = 0
        st["itunes_found"] = 0
        st["placeholders"] = 0

        BATCH = 6
        for i in range(0, len(not_found), BATCH):
            if not st["running"]:
                break
            chunk = not_found[i:i + BATCH]

            with ThreadPoolExecutor(max_workers=BATCH) as pool:
                futures = {}
                for cache_key, entry in chunk:
                    parts = cache_key.split("||", 1)
                    if len(parts) == 2:
                        futures[pool.submit(
                            _lookup_artwork_itunes, parts[0], parts[1], cache_key
                        )] = cache_key

                for fut in as_completed(futures):
                    cache_key = futures[fut]
                    try:
                        result = fut.result()
                        if result:
                            with state.artwork_cache_lock:
                                state.artwork_cache[cache_key] = result
                            st["itunes_found"] += 1
                    except Exception:
                        pass

            for cache_key, _ in chunk:
                with state.artwork_cache_lock:
                    entry = state.artwork_cache.get(cache_key, {})
                if not entry.get("found"):
                    parts = cache_key.split("||", 1)
                    artist = parts[0] if parts else "?"
                    title = parts[1] if len(parts) > 1 else ""
                    placeholder = _generate_placeholder(artist, title, cache_key)
                    with state.artwork_cache_lock:
                        state.artwork_cache[cache_key] = placeholder
                    st["placeholders"] += 1
                st["done"] += 1

            if (i // BATCH) % 5 == 4:
                _save_artwork_cache(state)
            time.sleep(0.4)

        _save_artwork_cache(state)
    except Exception:
        logger.exception("Retry artwork worker failed")
    finally:
        st["running"] = False


def _warm_cache_worker(state: AppState) -> None:
    """Background thread: look up artwork for every track in the DataFrame."""
    st = _warm_cache_state
    try:
        with state.df_lock:
            df = state.df
            if df.empty or "artist" not in df.columns or "title" not in df.columns:
                st["running"] = False
                return

            pairs = []
            seen = set()
            for _, row in df.iterrows():
                artist = str(row.get("artist") or "").strip()
                title = str(row.get("title") or "").strip()
                if not artist or not title:
                    continue
                key = f"{artist.lower()}||{title.lower()}"
                if key in seen:
                    continue
                seen.add(key)
                small_fname = _artwork_filename(key, "small")
                if os.path.exists(os.path.join(_ARTWORK_DIR, small_fname)):
                    st["skipped"] += 1
                    continue
                with state.artwork_cache_lock:
                    if key in state.artwork_cache:
                        st["skipped"] += 1
                        continue
                pairs.append((key, artist, title))

        st["total"] = len(pairs) + st["skipped"]
        st["done"] = st["skipped"]

        BATCH = 8
        for i in range(0, len(pairs), BATCH):
            if not st["running"]:
                break
            chunk = pairs[i:i + BATCH]
            with ThreadPoolExecutor(max_workers=BATCH) as pool:
                futures = {
                    pool.submit(_lookup_artwork, artist, title, state): key
                    for key, artist, title in chunk
                }
                for fut in as_completed(futures):
                    key = futures[fut]
                    try:
                        result = fut.result()
                        if result.get("cover_url"):
                            st["found"] += 1
                    except Exception:
                        pass
                    st["done"] += 1
            if (i // BATCH) % 6 == 5:
                _save_artwork_cache(state)
            time.sleep(0.3)

        _save_artwork_cache(state)
    except Exception:
        logger.exception("Artwork warm-cache failed")
    finally:
        st["running"] = False


def _download_all_worker(state: AppState) -> None:
    """Download all Deezer CDN URLs in cache to local files."""
    st = _download_all_state
    try:
        with state.artwork_cache_lock:
            entries = [
                (key, dict(entry)) for key, entry in state.artwork_cache.items()
                if isinstance(entry, dict) and entry.get("found")
                and any(entry.get(f, "").startswith("https://")
                        for f in ("cover_url", "cover_big"))
            ]
        st["total"] = len(entries)
        st["done"] = 0
        st["downloaded"] = 0

        BATCH = 12
        for i in range(0, len(entries), BATCH):
            if not st["running"]:
                break
            chunk = entries[i:i + BATCH]
            with ThreadPoolExecutor(max_workers=BATCH) as pool:
                futures = []
                for cache_key, entry in chunk:
                    for field, size in [("cover_url", "small"), ("cover_big", "big")]:
                        url = entry.get(field, "")
                        if url and not url.startswith("/artwork/"):
                            futures.append(
                                pool.submit(_download_artwork_local, url, cache_key, size)
                            )
                for fut in as_completed(futures):
                    result = fut.result()
                    if result:
                        st["downloaded"] += 1

            for cache_key, entry in chunk:
                _ensure_local_artwork(entry, cache_key, state)
                st["done"] += 1

            if (i // BATCH) % 10 == 9:
                _save_artwork_cache(state)
            time.sleep(0.1)

        _save_artwork_cache(state)
    except Exception:
        logger.exception("Bulk artwork download failed")
    finally:
        st["running"] = False


# ---------------------------------------------------------------------------
# Audio path helpers
# ---------------------------------------------------------------------------

_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".ogg": "audio/ogg",
}


def _map_audio_path(location: str) -> str:
    """Apply path prefix mapping from config (never modifies the CSV)."""
    if not location or location == "nan":
        return location
    cfg = load_config()
    if not cfg.get("audio_path_map_enabled"):
        return location
    path_from = cfg.get("audio_path_from", "")
    path_to = cfg.get("audio_path_to", "")
    if path_from and location.startswith(path_from):
        return path_to + location[len(path_from):]
    return location


def _to_dropbox_path(location: str) -> str | None:
    """Convert a CSV location path to a Dropbox-relative path."""
    if not location or location == "nan":
        return None
    cfg = load_config()
    prefix = cfg.get("dropbox_path_prefix") or cfg.get("audio_path_from", "")
    if prefix and location.startswith(prefix):
        return location[len(prefix):]
    return None


# ---------------------------------------------------------------------------
# Routes: Preview
# ---------------------------------------------------------------------------


@router.get("/api/preview")
async def get_preview(
    artist: str = "",
    title: str = "",
    state: AppState = Depends(get_state),
):
    artist = artist.strip()
    title = title.strip()
    if not artist or not title:
        raise HTTPException(status_code=400, detail="artist and title are required")

    cache_key = f"{artist.lower()}||{title.lower()}"
    with state.cache_lock:
        cached = state.preview_cache.get(cache_key)
    if cached is not None:
        return cached

    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://api.deezer.com/search?q={query}&limit=5"
    result = {"preview_url": None, "found": False}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GenreTagger/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tracks = data.get("data", [])
        if tracks:
            best = None
            a_low, t_low = artist.lower(), title.lower()
            for t in tracks:
                d_artist = (t.get("artist", {}).get("name") or "").lower()
                d_title = (t.get("title") or "").lower()
                if (a_low in d_artist or d_artist in a_low) and \
                   (t_low in d_title or d_title in t_low):
                    best = t
                    break
            if best is None:
                best = tracks[0]

            preview = best.get("preview", "")
            album = best.get("album", {})
            cover = album.get("cover_small", "")
            cover_big = album.get("cover_big", "") or album.get("cover_medium", "") or cover
            if preview:
                result = {
                    "preview_url": preview,
                    "found": True,
                    "deezer_title": best.get("title", ""),
                    "deezer_artist": best.get("artist", {}).get("name", ""),
                    "cover_url": cover,
                    "cover_big": cover_big,
                }
            elif cover:
                result = {**result, "cover_url": cover, "cover_big": cover_big}
    except Exception:
        logger.exception("Deezer search failed for %s - %s", artist, title)
        return result

    with state.cache_lock:
        state.preview_cache[cache_key] = result
    return result


# ---------------------------------------------------------------------------
# Routes: Artwork lookup
# ---------------------------------------------------------------------------


@router.get("/api/artwork")
async def get_artwork(
    artist: str = "",
    title: str = "",
    state: AppState = Depends(get_state),
):
    global _artwork_cache_dirty
    artist = artist.strip()
    title = title.strip()
    if not artist or not title:
        raise HTTPException(status_code=400, detail="artist and title are required")

    cache_key = f"{artist.lower()}||{title.lower()}"
    with state.artwork_cache_lock:
        was_cached = cache_key in state.artwork_cache
    result = _lookup_artwork(artist, title, state)
    if not was_cached:
        _artwork_cache_dirty += 1
        if _artwork_cache_dirty >= 10:
            _save_artwork_cache(state)
            _artwork_cache_dirty = 0
    return JSONResponse(
        content=result,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/api/artwork/batch")
async def get_artwork_batch(
    request: Request,
    state: AppState = Depends(get_state),
):
    items = await request.json()
    if not isinstance(items, list) or len(items) > 50:
        raise HTTPException(status_code=400, detail="Expected a JSON array (max 50)")

    results = {}
    uncached = []
    for item in items:
        artist = (item.get("artist") or "").strip()
        title = (item.get("title") or "").strip()
        if not artist or not title:
            continue
        key = f"{artist.lower()}||{title.lower()}"
        small_fname = _artwork_filename(key, "small")
        if os.path.exists(os.path.join(_ARTWORK_DIR, small_fname)):
            big_fname = _artwork_filename(key, "big")
            big_path = os.path.join(_ARTWORK_DIR, big_fname)
            results[key] = {
                "cover_url": _artwork_url(small_fname),
                "cover_big": _artwork_url(big_fname) if os.path.exists(big_path)
                             else _artwork_url(small_fname),
                "found": True,
            }
            with state.artwork_cache_lock:
                if key not in state.artwork_cache or \
                   not state.artwork_cache[key].get("found"):
                    state.artwork_cache[key] = results[key]
            continue
        with state.artwork_cache_lock:
            cached = state.artwork_cache.get(key)
        if cached is not None:
            _ensure_local_artwork(cached, key, state)
            results[key] = cached
        else:
            uncached.append((key, artist, title))

    if uncached:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_lookup_artwork, artist, title, state): key
                for key, artist, title in uncached
            }
            for fut in as_completed(futures):
                key = futures[fut]
                try:
                    results[key] = fut.result()
                except Exception:
                    results[key] = {"cover_url": "", "found": False}
        _save_artwork_cache(state)

    return JSONResponse(
        content=results,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ---------------------------------------------------------------------------
# Routes: Artwork warm-cache
# ---------------------------------------------------------------------------


@router.post("/api/artwork/warm-cache")
async def start_warm_cache(state: AppState = Depends(get_state)):
    if _warm_cache_state["running"]:
        return {"status": "already_running", **_warm_cache_state}
    _warm_cache_state.update(running=True, total=0, done=0, found=0, skipped=0)
    t = threading.Thread(target=_warm_cache_worker, args=(state,), daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/api/artwork/warm-cache/status")
async def warm_cache_status():
    return _warm_cache_state


@router.get("/api/artwork/uncached-count")
async def uncached_count(state: AppState = Depends(get_state)):
    with state.df_lock:
        df = state.df
        if df.empty or "artist" not in df.columns:
            return {"uncached": 0}
        rows = [(str(r.get("artist") or "").strip(),
                 str(r.get("title") or "").strip())
                for _, r in df.iterrows()]

    seen = set()
    uncached = 0
    for artist, title in rows:
        if not artist or not title:
            continue
        key = f"{artist.lower()}||{title.lower()}"
        if key in seen:
            continue
        seen.add(key)
        small_fname = _artwork_filename(key, "small")
        if os.path.exists(os.path.join(_ARTWORK_DIR, small_fname)):
            continue
        with state.artwork_cache_lock:
            if key not in state.artwork_cache:
                uncached += 1
    return {"uncached": uncached, "total": len(seen)}


# ---------------------------------------------------------------------------
# Routes: Retry not-found (iTunes fallback → placeholder)
# ---------------------------------------------------------------------------


@router.post("/api/artwork/retry-not-found")
async def retry_not_found_artwork(state: AppState = Depends(get_state)):
    if _retry_artwork_state["running"]:
        return {"status": "already_running", **_retry_artwork_state}
    with state.artwork_cache_lock:
        not_found = sum(
            1 for e in state.artwork_cache.values()
            if isinstance(e, dict) and not e.get("found")
        )
    if not_found == 0:
        return {"status": "nothing_to_do"}
    _retry_artwork_state.update(
        running=True, total=0, done=0, itunes_found=0, placeholders=0
    )
    t = threading.Thread(target=_retry_artwork_worker, args=(state,), daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/api/artwork/retry-not-found/status")
async def retry_not_found_status():
    return _retry_artwork_state


# ---------------------------------------------------------------------------
# Routes: Bulk download CDN → local
# ---------------------------------------------------------------------------


@router.post("/api/artwork/download-all")
async def download_all_artwork(state: AppState = Depends(get_state)):
    if _download_all_state["running"]:
        return {"status": "already_running", **_download_all_state}
    with state.artwork_cache_lock:
        need_dl = any(
            isinstance(e, dict) and e.get("found")
            and any(e.get(f, "").startswith("https://") for f in ("cover_url", "cover_big"))
            for e in state.artwork_cache.values()
        )
    if not need_dl:
        return {"status": "nothing_to_do"}
    _download_all_state.update(running=True, total=0, done=0, downloaded=0)
    t = threading.Thread(target=_download_all_worker, args=(state,), daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/api/artwork/download-all/status")
async def download_all_status():
    return _download_all_state


# ---------------------------------------------------------------------------
# Routes: Serve artwork files (with path validation)
# ---------------------------------------------------------------------------


@router.get("/artwork/{filename:path}")
async def serve_artwork(filename: str):
    """Serve locally-cached artwork images with path traversal protection."""
    # Validate filename format (security: prevents path traversal)
    if not _ARTWORK_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid artwork filename")

    fpath = os.path.join(_ARTWORK_DIR, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Artwork not found")

    try:
        mtime = int(os.path.getmtime(fpath))
        headers = {
            "ETag": f'"{mtime}"',
            "Cache-Control": "public, max-age=3600",
        }
    except OSError:
        headers = {}

    return FileResponse(fpath, media_type="image/jpeg", headers=headers)


# ---------------------------------------------------------------------------
# Routes: Audio serving
# ---------------------------------------------------------------------------


@router.get("/api/audio/{track_id}")
async def serve_audio(track_id: int, state: AppState = Depends(get_state)):
    """Serve audio: redirect to Dropbox temporary link, or fall back to local."""
    with state.df_lock:
        if state.df.empty:
            raise HTTPException(status_code=400, detail="No file uploaded")
        if track_id not in state.df.index:
            raise HTTPException(status_code=404, detail="Track not found")
        raw_location = str(state.df.loc[track_id].get("location", ""))

    # Try Dropbox first
    dbx = state.dropbox_client
    if dbx:
        dropbox_path = _to_dropbox_path(raw_location)
        if dropbox_path:
            try:
                result = dbx.files_get_temporary_link(dropbox_path)
                return RedirectResponse(url=result.link, status_code=302)
            except Exception as e:
                logger.warning("Dropbox temp link failed for %s: %s", dropbox_path, e)

    # Fall back to local file
    location = _map_audio_path(raw_location)
    if not location or location == "nan":
        raise HTTPException(status_code=404, detail="No file path for this track")
    if not os.path.isfile(location):
        raise HTTPException(status_code=404, detail="Audio file not found")

    ext = os.path.splitext(location)[1].lower()
    mimetype = _AUDIO_MIME.get(ext, "application/octet-stream")
    return FileResponse(location, media_type=mimetype)
