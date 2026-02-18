# Plan: Frontend Health
> Source: `docs/architecture-review.md` — Phase 4
> Priority: Low-Medium

## 1. Magic Numbers → `constants.js`
**Issue**: Timeouts, batch sizes, thresholds scattered as bare numeric literals across all JS files.
**Examples**:
- `300` — search debounce (ms) in setbuilder.js
- `1000` — auto-save timeout (ms) in setbuilder.js
- `0.08` — chord threshold in workshop.js
- `40` — artwork batch size in app.js
- `200` — max search results in workshop.js

**Fix**: Create `app/static/constants.js` with named exports. Replace literals with constant references.

## 2. Silent Error Handling → User-Visible Errors
**Issue**: Errors caught and logged to console but user sees frozen UI.
```javascript
catch (_) { /* ignore */ }
catch (e) { console.error("search failed", e); }
```
`showToast()` exists but is rarely used for errors.

**Fix**: Replace silent catches with `showToast("error", msg)` for: failed artwork loads, search failures, save failures, API errors.

## 3. Duplicated Search Rendering → Single Function
**Issue**: `renderScoredSearchResults()` and `renderSearchResults()` in `workshop.js` are ~130 lines each, ~90% identical.
**Fix**: Merge into `renderSearchResults(results, { showScores })`.

## 4. Duplicated Exemplar Track HTML
**Issue**: Generated in 4 separate places across `tree.js` and `workshop.js`.
**Fix**: Extract `renderExemplarTracks(tracks)` helper.

## 5. Duplicated HTML Escaping
**Issue**: `escapeHtml()` in `app.js` and `esc()` in `tree.js` are independent implementations.
**Fix**: Single `escapeHtml()` in `helpers.js`, remove `esc()`.

## 6. Event Listener Memory Leaks
| Issue | Location | Fix |
|-------|----------|-----|
| Listeners re-attached on every render (search results) | `workshop.js` | Event delegation on stable parent |
| Node expansion listeners accumulate on toggle | `tree.js` | Event delegation on tree container |
| Audio element listeners never removed | `app.js` | Remove on element cleanup |
| Polling timers not cleared on navigation | `app.js` | Clear on tab switch |
| IntersectionObserver never disconnected | `app.js` | Disconnect on cleanup |

## 7. CSS Colour Consistency
**Issue**: CSS custom properties defined in `:root` but many colours still hardcoded inline.
**Fix**: Move all hardcoded colours into `:root` variables.
