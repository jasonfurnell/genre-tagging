# Playback Engine

Audio playback for the Set Workshop — streaming tracks from Dropbox via a single shared `<audio>` element.

## Architecture

### Single Audio Element
All playback (Full Track and Short Preview modes) shares one `Audio()` instance (`setAudio`). This simplifies state but means every track change aborts the previous fetch, which fires spurious `error` events on the element.

### Generation Counter (`setPlayGen`)
Each call to `playFullTrack()` or `playSlotPreview()` increments `setPlayGen` and captures a local `gen` snapshot. Async callbacks (e.g. `play().catch()`) compare their snapshot to the current value — if they differ, the callback is stale and exits early.

### Audio Source Flow
1. Browser requests `/api/audio/{track_id}`
2. Backend calls Dropbox `files_get_temporary_link()` → returns a temp URL (valid ~4 hours)
3. Backend redirects (302) to the temp URL
4. `<audio>` element streams from Dropbox

### Key Files
| File | Role |
|------|------|
| `app/static/playback.js` | Playback engine — audio element, play/pause/skip, error handling, EQ overlays |
| `app/static/setbuilder.js` | Set loading, init sequence (`_runSetInitSequence`), calls `stopPlayback()` on set change |
| `app/routes.py` (`/api/audio/`) | Streaming endpoint — Dropbox temp link generation, local file fallback |

### State Variables (playback.js)
| Variable | Purpose |
|----------|---------|
| `setPlayGen` | Generation counter — incremented on every track change and `stopPlayback()` |
| `_errorGenAtPlay` | Generation snapshot when current track started loading — error handler ignores events from other generations |
| `setAudio` | The shared `Audio()` element |
| `_isAdvancing` | Guard preventing concurrent track advances |
| `_previewStartTime` | Seek offset for Short Preview mode (0 in Full Track mode) |
| `setAutoplayBlocked` | Flag when browser blocks autoplay (NotAllowedError) |

## Known Issues & Fixes

### Rapid Track Skipping (recurring)
**Symptom**: Tracks skip rapidly through the set, sometimes triggered by navigating between tabs or loading a new set.

**Root cause**: The shared `<audio>` element fires an `error` event whenever `src` changes (the previous fetch is aborted). If the error handler sees `currentTime > 0` (from the *previous* track), it interprets this as a genuine mid-stream failure and auto-advances to the next track — which itself may trigger the same cascade.

**Fix history**:
- **v1 — `currentTime === 0` check**: The error handler returned early if `currentTime === 0`, assuming that meant the error was from an aborted load. Unreliable because the abort error can fire *before* `currentTime` is reset.
- **v2 — Generation guard + debounce (2026-03-20)**: Added `_errorGenAtPlay` — set when a track starts loading, checked in `onPlaySetTrackError()`. If `setPlayGen !== _errorGenAtPlay`, the error is from a different track and is ignored. Additionally, a 500ms debounce confirms the error is genuine before auto-advancing. This closes the race condition because `stopPlayback()` increments `setPlayGen`, naturally invalidating any pending error events from the previous track.

**Why a minimum play-time floor was rejected**: A hard 2-second minimum before allowing skip was considered but rejected — it masks the symptom rather than fixing the cause, and adds noticeable lag when tracks genuinely fail to load (404, missing audio).

### Dropbox Temp Link Expiration
**Symptom**: Track fails to play after the app has been open for several hours.

**Root cause**: Dropbox temporary links expire after ~4 hours. The app requests a fresh link on each play, but if the browser caches a stale redirect, the audio fetch fails silently.

**Status**: Not yet fixed. Low priority since it only affects very long sessions and a page refresh resolves it. A potential fix would be adding `Cache-Control: no-store` to the `/api/audio/` redirect response.

## Debugging Tips

- **Console logging**: `onPlaySetTrackError()` logs `"Playback: mid-stream audio error"` when it actually advances. If you see this fire rapidly, the generation guard isn't catching the stale event — check that `_errorGenAtPlay` is being set correctly in `playFullTrack()` / `playSlotPreview()`.
- **Generation mismatch**: Add `console.log("error gen:", _errorGenAtPlay, "current gen:", setPlayGen)` at the top of `onPlaySetTrackError()` to verify stale events are being filtered.
- **Network tab**: Check the `/api/audio/` requests — a 302 redirect followed by a failed Dropbox fetch indicates an expired temp link or network issue.
