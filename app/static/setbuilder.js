/* ── Set Workshop — User-Built DJ Sets ───────────────────────────────────── */

let setInitialized = false;

// ── Slot State ──
// Each slot: {id, source: {type, id, tree_type, name}|null, tracks: [], selectedTrackIndex: null}
let setSlots = [];
const SET_DEFAULT_SLOTS = 40;  // 2-hour set (40 × 3 min)

// ── Drawer State ──
let setDrawerOpen = false;
let setDrawerMode = null;         // "browse" | "detail" | "search" | "now-playing"
let setDrawerTargetSlotId = null; // which slot the drawer is acting on
let baseDrawerOpen = false;       // bottom base-drawer state

// ── Drag State ──
let setDragTrack = null;          // track being dragged from drawer


// ── Playback State ──
let setWorkshopMode = "playset";  // "workshop" (Short Preview) | "playset" (Full Track)
let setPlaySetIndex = 0;
let setPlayGen = 0;    // generation counter to detect stale error events on skip
let setAudio = null;   // single Audio element for ALL set playback (full + preview)
let setResumeSlotIdx = -1;  // slot index to resume from after user-stop, -1 = none
let setAutoplayBlocked = false;  // true when browser blocked autoplay (NotAllowedError)
let setAudioFlagsReady = null;   // promise resolved when refreshHasAudioFlags completes
let _previewStartTime = 0;  // start time for 30s Short Preview window
let _isAdvancing = false;    // guard: true while a track-advance is in progress
const PREVIEW_DURATION = 30; // seconds for Short Preview mode
let _bpmSwapContext = null;  // {direction: "up"|"down", origIndex: N, slotIdx: N} when BPM arrow triggered playback

function isPlaySetMode() { return setWorkshopMode === "playset"; }

// ── Saved Set State ──
let currentSetId = null;        // ID of the loaded saved set, or null
let currentSetName = null;      // Name of the loaded saved set
let setDirty = false;           // True if workshop changed since last save/load
let setsInitialized = false;    // Lazy init for the Sets tab

// ── Energy Line Animation (play mode) ──
let _energyAnimFrame = null;
let _energyAnimStart = null;
let _energyLastKeyColor = null;  // persists color across keyless tracks

// ── Auto-Save ──
let _saveTimer = null;

// ── Camelot Key Colors ──
const CAMELOT_COLORS = {
    "1A":"#7BEED9","1B":"#00D4D4","2A":"#4BF1A8","2B":"#00E67E",
    "3A":"#90ED7D","3B":"#6FDB5E","4A":"#D5E96E","4B":"#C6D84E",
    "5A":"#F5C895","5B":"#F5B270","6A":"#FFB3B3","6B":"#FF8FA3",
    "7A":"#FF99C8","7B":"#FF6DB5","8A":"#EEA5D8","8B":"#E780CE",
    "9A":"#D5B0E8","9B":"#C88FDE","10A":"#B8B5ED","10B":"#9F98E8",
    "11A":"#98C9F1","11B":"#7BB2ED","12A":"#6DD9ED","12B":"#00C8E8",
};
function camelotColor(key) {
    if (!key) return null;
    let k = key.trim();
    // Normalize: M/B/b → B (major), m/a/d/D → A (minor)... wait
    // Camelot: A = minor, B = major.  Data: m = minor → A, M/D = major → B
    const m = k.match(/^(\d{1,2})([A-Za-z])$/);
    if (!m) return null;
    const num = m[1];
    const letter = m[2];
    let norm;
    if (letter === "A" || letter === "a" || letter === "m") norm = num + "A";
    else if (letter === "B" || letter === "b" || letter === "M" || letter === "D" || letter === "d") norm = num + "B";
    else return null;
    return CAMELOT_COLORS[norm] || null;
}

// ── Init Sequence State ──
let _setInitRunning = false;  // true while init sequence is in progress

// ── Layout Constants ──
const SET_IMG = 48;
const SET_PAD = 4;
const SET_COL_W = SET_IMG + SET_PAD * 2;  // 56
const SET_GAP = 6;
const SET_GRID_H = 576;
const SET_GRID_PAD = 30;
const SET_AREA_H = SET_GRID_H + SET_GRID_PAD * 2;  // 636
const SET_BPM_MIN = 50;
const SET_BPM_MAX = 170;
const SET_BPM_LEVELS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const SET_BPM_GRIDLINES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];

// ── Tooltip ──
let setTooltipEl = null;

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

async function initSetBuilder() {
    if (setInitialized) return;
    setInitialized = true;

    // Tooltip
    setTooltipEl = document.createElement("div");
    setTooltipEl.className = "set-track-tooltip";
    document.body.appendChild(setTooltipEl);

    // Toolbar buttons
    document.getElementById("set-save-btn").addEventListener("click", saveCurrentSet);
    document.getElementById("set-save-as-btn").addEventListener("click", saveSetAs);
    // Mode toggle in side drawer
    document.getElementById("set-mode-workshop").addEventListener("click", () => switchMode("workshop"));
    document.getElementById("set-mode-playset").addEventListener("click", () => switchMode("playset"));
    // Mode toggle in base drawer (mirror)
    document.querySelector(".base-mode-workshop").addEventListener("click", () => switchMode("workshop"));
    document.querySelector(".base-mode-playset").addEventListener("click", () => switchMode("playset"));
    document.getElementById("set-export-btn").addEventListener("click", exportSet);
    document.getElementById("set-refill-btn").addEventListener("click", refillAllBpm);

    // Single Audio element for all set playback (Full Track + Short Preview)
    setAudio = new Audio();
    setAudio.volume = 0.7;
    setAudio.addEventListener("timeupdate", updatePlaySetProgress);
    setAudio.addEventListener("ended", onPlaySetTrackEnded);
    setAudio.addEventListener("error", onPlaySetTrackError);
    // Broadcast playing event so dance tab can react (setAudio doesn't exist at dance init time)
    setAudio.addEventListener("playing", () => {
        _clearAutoplayBlockedHint();
        _bpmSwapContext = null;  // playback succeeded — clear BPM swap state
        _isAdvancing = false;    // new track is playing — allow future advances
        startEnergyLineAnim();
        document.querySelectorAll(".set-eq-overlay").forEach(el => el.classList.add("eq-playing"));
        _clearPlayOverlayLoading();
        _updatePlayOverlayIcon();
        window.dispatchEvent(new CustomEvent("playset-playing"));
    });
    setAudio.addEventListener("pause", () => {
        stopEnergyLineAnim();
        document.querySelectorAll(".set-eq-overlay").forEach(el => el.classList.remove("eq-playing"));
        _updatePlayOverlayIcon();
    });

    // Now Playing controls
    document.getElementById("now-playing-play-pause").addEventListener("click", togglePlaySetPause);
    document.getElementById("now-playing-prev").addEventListener("click", playSetPrev);
    document.getElementById("now-playing-next").addEventListener("click", playSetNext);
    document.getElementById("now-playing-progress-bar").addEventListener("click", (e) => {
        if (!setAudio || !setAudio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setAudio.currentTime = pct * setAudio.duration;
    });

    // Drawer close
    document.getElementById("set-drawer-close").addEventListener("click", closeDrawer);

    // Base drawer controls
    document.getElementById("base-np-play-pause").addEventListener("click", togglePlaySetPause);
    document.getElementById("base-np-prev").addEventListener("click", playSetPrev);
    document.getElementById("base-np-next").addEventListener("click", playSetNext);
    document.getElementById("base-np-bpm-up").addEventListener("click", bpmSwapUp);
    document.getElementById("base-np-bpm-down").addEventListener("click", bpmSwapDown);
    document.getElementById("base-np-progress-bar").addEventListener("click", (e) => {
        if (!setAudio || !setAudio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setAudio.currentTime = pct * setAudio.duration;
    });
    document.getElementById("base-drawer-expand").addEventListener("click", expandFromBaseDrawer);
    document.getElementById("base-np-source").addEventListener("click", expandFromBaseDrawer);
    // Mobile: tap track details row to expand, tap detail panel to collapse
    document.querySelector(".base-drawer-left").addEventListener("click", () => {
        if (_isMobileView()) toggleBaseDrawerExpanded();
    });
    document.getElementById("base-drawer-detail").addEventListener("click", () => {
        if (_isMobileView()) collapseBaseDrawerExpanded();
    });

    // Drawer source search (debounced)
    let searchTimer = null;
    document.getElementById("set-drawer-search").addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadDrawerSources(e.target.value), 300);
    });

    // Track search button
    document.getElementById("set-search-btn").addEventListener("click", () => {
        openDrawer("search", null);
    });

    // Track search input (debounced)
    let trackSearchTimer = null;
    document.getElementById("set-drawer-track-search").addEventListener("input", (e) => {
        clearTimeout(trackSearchTimer);
        const q = e.target.value.trim();
        if (q.length < 2) {
            document.getElementById("set-drawer-search-results").innerHTML = "";
            document.getElementById("set-drawer-search-context").classList.add("hidden");
            return;
        }
        trackSearchTimer = setTimeout(() => searchTracks(q), 300);
    });

    // Keyboard
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (!setAudio.paused) stopPlayback();
            else if (setDrawerOpen) closeDrawer();
        }
    });

    // Mobile: vertically center grid in available space
    _updateWorkshopGridPosition();
    window.addEventListener("resize", _updateWorkshopGridPosition);
    // Recalculate when base drawer opens/closes (class change triggers transition)
    const baseDrawerEl = document.getElementById("base-drawer");
    if (baseDrawerEl) {
        new MutationObserver(_updateWorkshopGridPosition).observe(baseDrawerEl, {
            attributes: true, attributeFilter: ["class"]
        });
    }

    // Run the init sequence (loads state, checks audio, transitions to now-playing)
    const currentTab = document.querySelector(".tab-content:not(.hidden)");
    if (currentTab && currentTab.id === "tab-setbuilder") {
        // On the setbuilder tab — show the full init sequence in the drawer
        await _runSetInitSequence({ isNewLoad: false });
    } else {
        // Not on setbuilder tab — load silently in background
        await loadSavedSetState();
        const firstSlot = findNextPlaySetSlot(0);
        if (firstSlot >= 0) {
            setPlaySetIndex = firstSlot;
            const slot = setSlots[firstSlot];
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track) updateNowPlayingDrawer(track, firstSlot);
        }
        setAudioFlagsReady = refreshHasAudioFlags();
        updateModeToggleUI();
    }
}


function initEmptySlots(count) {
    if (!count) count = SET_DEFAULT_SLOTS;
    setResumeSlotIdx = -1;
    setSlots = [];
    for (let i = 0; i < count; i++) {
        setSlots.push({
            id: `slot-${Date.now()}-${i}`,
            source: null,
            tracks: [],
            selectedTrackIndex: null,
        });
    }
}

function _makeEmptySlot() {
    return {
        id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: null,
        tracks: [],
        selectedTrackIndex: null,
    };
}

/**
 * Ensure there is always a clear (empty) slot at the first and last positions.
 * Called after every mutation (assign, delete, drag, load).
 */
function ensureBookendSlots() {
    // Ensure first slot is clear
    if (setSlots.length === 0 || setSlots[0].source !== null) {
        setSlots.unshift(_makeEmptySlot());
    }
    // Ensure last 3 slots are clear
    while (true) {
        let emptyTail = 0;
        for (let i = setSlots.length - 1; i >= 0; i--) {
            if (setSlots[i].source === null) emptyTail++;
            else break;
        }
        if (emptyTail < 3) setSlots.push(_makeEmptySlot());
        else break;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// State Persistence
// ═══════════════════════════════════════════════════════════════════════════

function scheduleAutoSave() {
    clearTimeout(_saveTimer);
    setDirty = true;
    updateSaveButtons();
    _saveTimer = setTimeout(saveSetState, 1000);
}

async function saveSetState() {
    try {
        await fetch("/api/set-workshop/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slots: setSlots,
                set_id: currentSetId,
                set_name: currentSetName,
                phase_profile_id: activePhaseProfileId,
            }),
        });
    } catch (e) {
        console.error("Failed to save set state:", e);
    }
}

async function loadSavedSetState() {
    try {
        const res = await fetch("/api/set-workshop/state");
        const data = await res.json();
        if (data && data.slots && data.slots.length > 0) {
            setResumeSlotIdx = -1;
            setSlots = data.slots;
            currentSetId = data.set_id || null;
            currentSetName = data.set_name || null;
            setDirty = false;
            // Restore phase profile if saved
            if (data.phase_profile_id) {
                activePhaseProfileId = data.phase_profile_id;
                try {
                    const pRes = await fetch(`/api/phase-profiles/${data.phase_profile_id}`);
                    if (pRes.ok) {
                        const prof = await pRes.json();
                        setActivePhases = prof.phases;
                    }
                } catch (_) { /* keep default phases */ }
            }
            ensureBookendSlots();
            renderSet();
            updateSaveButtons();
            return;
        }
    } catch (e) {
        console.error("Failed to load set state:", e);
    }

    // Fallback: init empty (2-hour default)
    initEmptySlots();
    currentSetId = null;
    currentSetName = null;
    setDirty = false;
    renderSet();
    updateSaveButtons();
}


// ═══════════════════════════════════════════════════════════════════════════
// Save / Load Named Sets
// ═══════════════════════════════════════════════════════════════════════════

function updateSaveButtons() {
    const saveBtn = document.getElementById("set-save-btn");
    const nameEl = document.getElementById("set-current-name");
    if (!saveBtn || !nameEl) return;
    if (currentSetId) {
        saveBtn.style.display = "";
        saveBtn.disabled = !setDirty;
    } else {
        saveBtn.style.display = "none";
    }
    nameEl.textContent = currentSetName
        ? (setDirty && currentSetId ? currentSetName + " *" : currentSetName)
        : "";
}

async function saveCurrentSet() {
    if (!currentSetId) { saveSetAs(); return; }
    try {
        const res = await fetch(`/api/saved-sets/${currentSetId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slots: setSlots, name: currentSetName, phase_profile_id: activePhaseProfileId }),
        });
        if (res.ok) {
            setDirty = false;
            updateSaveButtons();
            showToast(`Saved "${currentSetName}"`);
        }
    } catch (e) {
        console.error("Save failed:", e);
        alert("Failed to save set.");
    }
}

async function saveSetAs() {
    const name = prompt("Set name:", currentSetName || "My Set");
    if (!name || !name.trim()) return;
    try {
        const res = await fetch("/api/saved-sets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim(), slots: setSlots, phase_profile_id: activePhaseProfileId }),
        });
        if (res.ok) {
            const data = await res.json();
            currentSetId = data.id;
            currentSetName = data.name;
            setDirty = false;
            updateSaveButtons();
            showToast(`Saved as "${currentSetName}"`);
        }
    } catch (e) {
        console.error("Save As failed:", e);
        alert("Failed to save set.");
    }
}

async function loadSavedSet(setId) {
    if (setDirty) {
        if (!confirm("You have unsaved changes. Discard and load a different set?")) return;
    }
    // Stop any current playback and reset mobile UI before loading the new set
    stopPlayback();
    if (_isMobileView()) closeBaseDrawer();

    // Fetch the set data once — reused by init sequence loadFn
    let cachedData = null;
    try {
        const res = await fetch(`/api/saved-sets/${setId}`);
        if (!res.ok) { alert("Failed to load set."); return; }
        cachedData = await res.json();
    } catch (e) {
        console.error("Failed to load set:", e);
        alert("Failed to load set.");
        return;
    }

    if (typeof switchToTab === "function") switchToTab("setbuilder");

    // Run the init sequence with the set load as the loadFn
    await _runSetInitSequence({
        isNewLoad: true,
        setName: cachedData.name || null,
        loadFn: async () => {
            const data = cachedData;
            setResumeSlotIdx = -1;
            setSlots = data.slots || [];
            currentSetId = data.id;
            currentSetName = data.name;
            setDirty = false;
            // Restore phase profile if saved with set
            if (data.phase_profile_id) {
                activePhaseProfileId = data.phase_profile_id;
                try {
                    const pRes = await fetch(`/api/phase-profiles/${data.phase_profile_id}`);
                    if (pRes.ok) {
                        const prof = await pRes.json();
                        setActivePhases = prof.phases;
                    }
                } catch (_) { /* keep current phases */ }
            }
            ensureBookendSlots();
            renderSet();
            updateSaveButtons();
            saveSetState();
        },
    });

    if (currentSetName) showToast(`Loaded "${currentSetName}"`);
}

function startNewSet() {
    if (setDirty) {
        if (!confirm("You have unsaved changes. Start a new set?")) return;
    }
    stopPlayback();
    initEmptySlots();
    currentSetId = null;
    currentSetName = null;
    setDirty = false;
    renderSet();
    updateSaveButtons();
    saveSetState();
    if (typeof switchToTab === "function") switchToTab("setbuilder");
}

// ── Sets Tab ──

async function initSetsTab() {
    if (setsInitialized) return;
    setsInitialized = true;
    document.getElementById("sets-new-btn").addEventListener("click", startNewSet);
    await loadSetsList();
}

async function loadSetsList() {
    try {
        const res = await fetch("/api/saved-sets");
        const data = await res.json();
        renderSetsGrid(data.sets || []);
    } catch (e) {
        console.error("Failed to load sets:", e);
    }
}

function renderSetsStats(sets) {
    const el = document.getElementById("sets-stats");
    if (!el) return;
    if (sets.length === 0) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");

    const totalTracks = sets.reduce((n, s) => n + (s.track_count || 0), 0);
    const totalMin = sets.reduce((n, s) => n + (s.duration_minutes || 0), 0);
    const durH = Math.floor(totalMin / 60);
    const durM = totalMin % 60;
    const durStr = durH > 0 ? `${durH}h ${durM}m` : `${durM}m`;

    el.innerHTML = [
        { v: sets.length, l: "Sets" },
        { v: totalTracks, l: "Total Tracks" },
        { v: durStr, l: "Total Duration" },
    ].map(s => `<div class="sets-stat"><div class="sets-stat-value">${s.v}</div><div class="sets-stat-label">${s.l}</div></div>`).join("");
}

function renderSetsGrid(sets) {
    const grid = document.getElementById("sets-grid");
    if (!grid) return;
    const emptyMsg = grid.querySelector(".sets-empty");

    // Remove old cards
    grid.querySelectorAll(".set-card").forEach(el => el.remove());

    // Stats bar
    renderSetsStats(sets);

    if (sets.length === 0) {
        if (emptyMsg) emptyMsg.classList.remove("hidden");
        return;
    }
    if (emptyMsg) emptyMsg.classList.add("hidden");

    for (const s of sets) {
        const card = document.createElement("div");
        card.className = "set-card" + (s.id === currentSetId ? " active" : "");
        card.dataset.setId = s.id;

        const durH = Math.floor(s.duration_minutes / 60);
        const durM = s.duration_minutes % 60;
        const durStr = durH > 0 ? `${durH}h ${durM}m` : `${durM}m`;
        const dateStr = s.updated_at
            ? new Date(s.updated_at).toLocaleDateString()
            : "";

        // Build tags
        let tagsHtml = "";
        if (s.bpm_range) {
            tagsHtml += `<span class="set-tag set-tag-bpm">${s.bpm_range[0]}-${s.bpm_range[1]} BPM</span>`;
        }
        if (s.keys && s.keys.length) {
            const keyStr = s.keys.length > 4 ? s.keys.slice(0, 4).join(", ") + "..." : s.keys.join(", ");
            tagsHtml += `<span class="set-tag set-tag-key">${escHtml(keyStr)}</span>`;
        }
        tagsHtml += `<span class="set-tag set-tag-dur">${durStr}</span>`;
        if (dateStr) {
            tagsHtml += `<span class="set-tag set-tag-date">${dateStr}</span>`;
        }

        // Build exemplar tracks
        let exHtml = "";
        if (s.exemplars && s.exemplars.length) {
            const rows = s.exemplars.map(t => `
                <div class="set-example-track">
                    <img class="set-example-art" data-artist="${escHtml(t.artist || "")}" data-title="${escHtml(t.title || "")}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">
                    <div class="set-example-info">
                        <div class="set-example-title">${escHtml(t.title || "")}</div>
                        <div class="set-example-artist">${escHtml(t.artist || "")}</div>
                    </div>
                </div>
            `).join("");
            exHtml = `<div class="set-card-examples"><div class="set-card-examples-title">Tracks</div>${rows}</div>`;
        }

        card.innerHTML = `
            <div class="set-card-header">
                <div class="set-card-name">${escHtml(s.name)}</div>
                <span class="set-card-badge">${s.track_count} tracks</span>
            </div>
            <div class="set-card-tags">${tagsHtml}</div>
            ${exHtml}
            <div class="set-card-actions">
                <button class="btn btn-sm btn-secondary set-card-load">Load</button>
                <button class="btn btn-sm btn-secondary set-card-export" title="Export M3U8 (Lexicon)">Export</button>
                <button class="btn btn-sm btn-danger set-card-delete" title="Delete">&times;</button>
            </div>
        `;

        // Load artwork for exemplar tracks
        card.querySelectorAll(".set-example-art").forEach(img => {
            const artist = img.dataset.artist;
            const title = img.dataset.title;
            if (artist || title) {
                fetch(`/api/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
                    .then(r => r.json())
                    .then(data => { if (data.url) img.src = data.url; })
                    .catch(() => {});
            }
        });

        card.querySelector(".set-card-load").addEventListener("click", (e) => {
            e.stopPropagation();
            loadSavedSet(s.id);
        });
        card.querySelector(".set-card-export").addEventListener("click", (e) => {
            e.stopPropagation();
            exportSavedSet(s.id, s.name);
        });
        card.querySelector(".set-card-delete").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteSavedSet(s.id, s.name);
        });
        card.addEventListener("click", () => loadSavedSet(s.id));

        grid.appendChild(card);
    }
}

async function exportSavedSet(setId, setName) {
    try {
        const res = await fetch(`/api/saved-sets/${setId}/export/m3u`);
        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const safeName = (setName || "DJ_Set").replace(/\s+/g, "_");
            a.download = `${safeName}.m3u8`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            const err = await res.json().catch(() => ({}));
            alert(err.error || "Export failed");
        }
    } catch (e) {
        console.error("Export failed:", e);
    }
}

async function deleteSavedSet(setId, setName) {
    if (!confirm(`Delete set "${setName}"?`)) return;
    try {
        await fetch(`/api/saved-sets/${setId}`, { method: "DELETE" });
        if (currentSetId === setId) {
            currentSetId = null;
            currentSetName = null;
            updateSaveButtons();
        }
        await loadSetsList();
    } catch (e) {
        console.error("Delete failed:", e);
    }
}


async function _checkAudioBatch(trackIds, timeoutMs = 15000) {
    /**Fetch has_audio flags for a set of track IDs. Returns {id: bool} map.*/
    if (trackIds.size === 0) return {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("/api/set-workshop/check-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_ids: [...trackIds] }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") {
            console.warn(`Audio check timed out (${timeoutMs}ms) for ${trackIds.size} tracks`);
        } else {
            console.error("Audio check failed:", e);
        }
        return {};
    }
}

function _applyAudioMap(audioMap) {
    /**Patch has_audio flags on all slot tracks from an {id: bool} map.*/
    for (const slot of setSlots) {
        for (const t of (slot.tracks || [])) {
            if (t && t.id != null && String(t.id) in audioMap) {
                t.has_audio = !!audioMap[String(t.id)];
            }
        }
    }
}

async function refreshHasAudioFlags() {
    // Stage 1: Check only selected tracks (fast — ~40 tracks max)
    const selectedIds = new Set();
    const otherIds = new Set();
    for (const slot of setSlots) {
        const tracks = slot.tracks || [];
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            if (!t || t.id == null) continue;
            if (i === slot.selectedTrackIndex) {
                selectedIds.add(t.id);
            } else {
                otherIds.add(t.id);
            }
        }
    }

    // Stage 1: selected tracks — blocks init
    const selectedMap = await _checkAudioBatch(selectedIds, 10000);
    _applyAudioMap(selectedMap);
    updateToolbarState();

    // Stage 2: remaining tracks — runs in background, doesn't block init
    if (otherIds.size > 0) {
        _checkAudioBatch(otherIds, 30000).then(otherMap => {
            _applyAudioMap(otherMap);
            updateToolbarState();
        });
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

function renderSet() {
    renderPhaseRow();
    renderInsertRow();
    renderKeyRow();
    renderBpmGrid();
    renderEnergyWave();
    renderTrackColumns();
    renderTimeRow();
    updateToolbarState();
}


function updateToolbarState() {
    const hasSelection = setSlots.some(s => s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex]);
    document.getElementById("set-export-btn").disabled = !hasSelection;
    document.getElementById("set-refill-btn").disabled = !hasSelection;
}


// ── Phase Row (energy phase indicators) ──

let setActivePhases = [
    { name: "Opening",    pct: [0, 20],   desc: "Slower BPM, spacious tracks, clearer grooves. Build curiosity rather than intensity.",  color: "#888888" },
    { name: "Build",      pct: [20, 60],  desc: "Gradually layer in bigger basslines, tighter percussion. The crowd starts to commit.",     color: "#AAAAAA" },
    { name: "Peak",       pct: [60, 85],  desc: "Full throttle \u2014 your biggest, most powerful tunes. Sustained high energy with minor dips for tension and release.",    color: "#CCCCCC" },
    { name: "Resolution", pct: [85, 100], desc: "Cool the room with deeper, mellower selections. Let the crowd breathe and land gracefully.",    color: "#999999" },
];
let activePhaseProfileId = null;

function setActivePhaseProfile(profileId, phases) {
    activePhaseProfileId = profileId;
    setActivePhases = phases;
    renderPhaseRow();
    scheduleAutoSave();
}

function renderPhaseRow() {
    const row = document.getElementById("set-phase-row");
    row.innerHTML = "";
    const total = setSlots.length;
    if (total === 0) return;

    const slotW = SET_COL_W + SET_GAP;  // 62px per slot

    // Skip bookend empty slots: 1 at start, 3 at end
    const leadEmpty = 1;
    const tailEmpty = 3;
    const contentSlots = Math.max(0, total - leadEmpty - tailEmpty);
    if (contentSlots <= 0) return;

    // Leading spacer for the first empty slot (subtract flex gap that follows)
    const leadSpacer = document.createElement("div");
    leadSpacer.style.width = `${leadEmpty * slotW - SET_GAP}px`;
    leadSpacer.style.flexShrink = "0";
    row.appendChild(leadSpacer);

    for (const phase of setActivePhases) {
        const startSlot = Math.round(contentSlots * phase.pct[0] / 100);
        const endSlot   = Math.round(contentSlots * phase.pct[1] / 100);
        const count     = endSlot - startSlot;
        if (count <= 0) continue;

        const cellW = count * slotW - SET_GAP;
        const el = document.createElement("div");
        el.className = "set-phase-cell";
        el.style.width = `${cellW}px`;
        el.style.setProperty("--phase-color", phase.color);
        el.innerHTML = `<span class="set-phase-name">${phase.name}</span>`
            + `<span class="set-phase-desc">${phase.desc}</span>`;
        row.appendChild(el);
    }
}

// ── Source Grouping ──

function buildSourceGroups() {
    const groups = [];
    let i = 0;
    while (i < setSlots.length) {
        const slot = setSlots[i];
        if (slot.source) {
            const key = `${slot.source.type}:${slot.source.id}`;
            let count = 1;
            while (i + count < setSlots.length &&
                   setSlots[i + count].source &&
                   `${setSlots[i + count].source.type}:${setSlots[i + count].source.id}` === key) {
                count++;
            }
            groups.push({
                startIdx: i, count, key,
                source: slot.source,
                slotIds: setSlots.slice(i, i + count).map(s => s.id)
            });
            i += count;
        } else {
            groups.push({ startIdx: i, count: 1, key: null, source: null, slotIds: [slot.id] });
            i++;
        }
    }
    return groups;
}

// ── Insert Row (delete buttons + "+" insert between every slot) ──

function renderInsertRow() {
    const row = document.getElementById("set-insert-row");
    row.innerHTML = "";

    for (let i = 0; i < setSlots.length; i++) {
        const slot = setSlots[i];

        // Delete button for this slot
        const cell = document.createElement("div");
        cell.className = "set-insert-spacer";
        cell.style.width = `${SET_COL_W}px`;
        const delBtn = document.createElement("span");
        delBtn.className = "set-delete-col-btn";
        delBtn.textContent = "\u2715";
        delBtn.title = "Delete column";
        delBtn.addEventListener("click", () => handleSlotControl(slot.id, "delete"));
        cell.appendChild(delBtn);
        row.appendChild(cell);

        // "+" insert button between every pair of slots
        if (i < setSlots.length - 1) {
            const wrap = document.createElement("div");
            wrap.className = "set-insert-col-btn";
            const circle = document.createElement("span");
            circle.textContent = "+";
            circle.title = "Insert blank column";
            const line = document.createElement("div");
            line.className = "set-insert-line";
            wrap.appendChild(circle);
            wrap.appendChild(line);
            const insertIdx = i + 1;
            wrap.addEventListener("click", () => insertBlankColumn(insertIdx));
            row.appendChild(wrap);
        }
    }
}

function insertBlankColumn(atIdx) {
    const blank = _makeEmptySlot();
    const idx = Math.max(0, Math.min(atIdx, setSlots.length));
    setSlots.splice(idx, 0, blank);
    // Adjust play-set index if inserting before current playing slot
    if (isPlaySetMode() && idx <= setPlaySetIndex) setPlaySetIndex++;
    ensureBookendSlots();
    renderSet();
    scheduleAutoSave();
}


// ── Key Row ──

function renderKeyRow() {
    const row = document.getElementById("set-key-row");
    row.innerHTML = "";

    for (const slot of setSlots) {
        const cell = document.createElement("div");
        cell.className = "set-key-cell";
        cell.dataset.slotId = slot.id;
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const key = slot.tracks[slot.selectedTrackIndex].key || "";
            cell.textContent = key;
            const color = camelotColor(key);
            if (color) {
                cell.style.color = color;
                cell.style.backgroundColor = color + "18";
                cell.style.borderColor = color + "40";
                cell.style.setProperty("--key-raw", color);
            }
        }
        row.appendChild(cell);
    }

    // Re-apply play-set-active styling after DOM rebuild
    if (isPlaySetMode() && setPlaySetIndex >= 0 && setPlaySetIndex < setSlots.length) {
        const activeSlot = setSlots[setPlaySetIndex];
        const keyCell = row.querySelector(`.set-key-cell[data-slot-id="${activeSlot.id}"]`);
        if (keyCell) keyCell.classList.add("play-set-active");
    }
}


// ── BPM Grid ──

function renderBpmGrid() {
    const grid = document.getElementById("set-bpm-grid");
    // Remove old gridlines
    grid.querySelectorAll(".set-bpm-gridline").forEach(el => el.remove());

    const slotW = SET_COL_W + SET_GAP;
    const totalW = setSlots.length * slotW;
    grid.style.width = `${totalW}px`;

    // Draw gridlines across the full BPM range
    for (const bpm of SET_BPM_GRIDLINES) {
        const line = document.createElement("div");
        line.className = "set-bpm-gridline";
        line.style.top = `${bpmToY(bpm)}px`;
        line.style.width = `${totalW}px`;
        grid.appendChild(line);
    }
}


// ── Energy Wave (reactive smooth curve) ──

function renderEnergyWave() {
    const svg = document.getElementById("set-energy-svg");
    const slotW = SET_COL_W + SET_GAP;
    const totalW = setSlots.length * slotW;

    svg.setAttribute("viewBox", `0 0 ${totalW} ${SET_AREA_H}`);
    svg.style.width = `${totalW}px`;
    svg.style.height = `${SET_AREA_H}px`;

    // Collect data points from slots with selected tracks
    const points = [];
    setSlots.forEach((slot, i) => {
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const track = slot.tracks[slot.selectedTrackIndex];
            const bpm = track.bpm || track.bpm_level || 100;
            const x = i * slotW + SET_COL_W / 2;
            const y = bpmToY(bpm);
            points.push({ x, y });
        }
    });

    if (points.length < 2) {
        svg.innerHTML = "";
        return;
    }

    // 6 lines with slightly different tensions for visual depth
    const tensions = [0.30, 0.25, 0.36, 0.22, 0.40, 0.18];
    const classes  = [
        "set-energy-line",
        "set-energy-line set-energy-line--ghost",
        "set-energy-line set-energy-line--ghost",
        "set-energy-line set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--ghost set-energy-line--ghost-far",
    ];

    const primaryD = catmullRomPath(points, tensions[0]);
    const fillD = primaryD
        + ` L ${points[points.length - 1].x} ${SET_AREA_H}`
        + ` L ${points[0].x} ${SET_AREA_H} Z`;

    let html = `<path class="set-energy-fill" d="${fillD}" />`;
    tensions.forEach((t, li) => {
        html += `<path class="${classes[li]}" d="${catmullRomPath(points, t)}" />`;
    });

    svg.innerHTML = html;
}

function catmullRomPath(points, tension) {
    if (typeof tension === "undefined") tension = 0.3;
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(i + 2, points.length - 1)];
        const t = 1 / (6 * (tension || 0.3));
        const cp1x = p1.x + (p2.x - p0.x) * t;
        const cp1y = p1.y + (p2.y - p0.y) * t;
        const cp2x = p2.x - (p3.x - p1.x) * t;
        const cp2y = p2.y - (p3.y - p1.y) * t;
        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
}

// ── Energy Line Animation (play-mode breathing effect) ──
// EXPERIMENTAL — remove this block to revert to static energy line

function startEnergyLineAnim() {
    if (_energyAnimFrame) return;  // already running
    _energyAnimStart = performance.now();
    _energyAnimTick();
}

function stopEnergyLineAnim() {
    if (_energyAnimFrame) {
        cancelAnimationFrame(_energyAnimFrame);
        _energyAnimFrame = null;
        _energyAnimStart = null;
    }
    _energyLastKeyColor = null;
    renderEnergyWave();  // snap back to static
}

function _energyAnimTick() {
    if (!setAudio || setAudio.paused) { stopEnergyLineAnim(); return; }

    const svg = document.getElementById("set-energy-svg");
    if (!svg) { _energyAnimFrame = null; return; }

    const slotW = SET_COL_W + SET_GAP;
    const totalW = setSlots.length * slotW;
    svg.setAttribute("viewBox", `0 0 ${totalW} ${SET_AREA_H}`);

    // Collect base points (same as renderEnergyWave)
    const points = [];
    setSlots.forEach((slot, i) => {
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const track = slot.tracks[slot.selectedTrackIndex];
            const bpm = track.bpm || track.bpm_level || 100;
            const x = i * slotW + SET_COL_W / 2;
            const y = bpmToY(bpm);
            points.push({ x, y, idx: i });
        }
    });

    if (points.length < 2) {
        svg.innerHTML = "";
        _energyAnimFrame = requestAnimationFrame(_energyAnimTick);
        return;
    }

    const elapsed = (performance.now() - _energyAnimStart) / 1000;

    // Use the currently-playing track's key color; carry forward if no key
    if (setPlaySetIndex >= 0 && setPlaySetIndex < setSlots.length) {
        const ps = setSlots[setPlaySetIndex];
        if (ps.selectedTrackIndex != null && ps.tracks[ps.selectedTrackIndex]) {
            const kc = camelotColor(ps.tracks[ps.selectedTrackIndex].key);
            if (kc) _energyLastKeyColor = kc;
        }
    }
    const stroke = _energyLastKeyColor || "var(--accent)";

    // 6 layered lines — each with a different seed offset so they diverge
    const layerSeeds  = [0, 137, 293, 419, 557, 683];      // phase offsets per layer
    const layerClasses = [
        "set-energy-line set-energy-line--alive",
        "set-energy-line set-energy-line--alive set-energy-line--ghost",
        "set-energy-line set-energy-line--alive set-energy-line--ghost",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
    ];

    let html = "";
    layerSeeds.forEach((lseed, li) => {
        // EXTREME organic motion — 6 layered sine waves per axis at
        // irrational frequency ratios, plus X wobble and wild tension swings
        const animated = points.map((p, i) => {
            const s = i * 7.31 + lseed;  // per-point seed + layer offset
            const dy = Math.sin(elapsed * 1.17 + s) * 5.0
                     + Math.sin(elapsed * 0.53 + s * 1.3) * 4.0
                     + Math.sin(elapsed * 2.71 + s * 0.7) * 3.0
                     + Math.sin(elapsed * 0.19 + s * 2.1) * 3.5
                     + Math.sin(elapsed * 3.41 + s * 0.4) * 2.0
                     + Math.sin(elapsed * 0.07 + s * 3.1) * 5.0;
            const dx = Math.sin(elapsed * 0.89 + s * 1.7) * 3.0
                     + Math.sin(elapsed * 1.61 + s * 0.9) * 2.0
                     + Math.sin(elapsed * 0.31 + s * 2.3) * 2.5;
            return { x: p.x + dx, y: p.y + dy };
        });

        // Tension swings — layer offset makes each curve bend differently
        const tension = 0.3
            + Math.sin(elapsed * 0.37 + lseed) * 0.10
            + Math.sin(elapsed * 0.83 + lseed * 0.7) * 0.08
            + Math.sin(elapsed * 0.13 + lseed * 1.3) * 0.06
            + Math.sin(elapsed * 1.53 + lseed * 0.4) * 0.05;

        const pathD = catmullRomPath(animated, tension);

        // Only the primary layer gets the fill
        if (li === 0) {
            const fillD = pathD
                + ` L ${animated[animated.length - 1].x} ${SET_AREA_H}`
                + ` L ${animated[0].x} ${SET_AREA_H} Z`;
            html += `<path class="set-energy-fill" d="${fillD}" style="fill:${stroke}" />`;
        }

        const glow = li === 0 ? 6 : li <= 2 ? 3 : 2;
        html += `<path class="${layerClasses[li]}" d="${pathD}"
              style="stroke:${stroke}; filter:drop-shadow(0 0 ${glow}px ${stroke})" />`;
    });

    svg.innerHTML = html;

    _energyAnimFrame = requestAnimationFrame(_energyAnimTick);
}


// ── Track Columns ──

function renderTrackColumns() {
    const container = document.getElementById("set-columns");
    container.innerHTML = "";

    setSlots.forEach((slot) => {
        const col = document.createElement("div");
        col.className = "set-column";
        col.dataset.slotId = slot.id;

        // Key color as CSS variable (shown on hover via CSS)
        const selTrack = (slot.selectedTrackIndex != null) ? slot.tracks[slot.selectedTrackIndex] : null;
        const colColor = selTrack ? camelotColor(selTrack.key) : null;
        if (colColor) {
            col.style.setProperty("--key-bg", `linear-gradient(to bottom, transparent, ${colColor}30)`);
            col.style.setProperty("--key-raw", colColor);
        }

        // Draggable for reordering + drop target for tracks
        col.draggable = true;
        col.addEventListener("dragstart", (e) => onSlotDragStart(e, slot.id));
        col.addEventListener("dragover", (e) => {
            onSlotDragOver(e);
            col.classList.add("drag-over");
        });
        col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
        col.addEventListener("drop", (e) => { col.classList.remove("drag-over"); onSlotDrop(e, slot.id); });
        col.addEventListener("dragend", () => { dragSlotId = null; dragGroupSlotIds = null; });

        if (!slot.source || slot.tracks.length === 0) {
            // Empty slot
            const placeholder = document.createElement("div");
            placeholder.className = "set-empty-slot";
            placeholder.addEventListener("click", () => {
                openDrawer("browse", slot.id);
            });
            col.appendChild(placeholder);
        } else {
            // Offset the entire column so the selected track sits at its actual BPM height
            const colOffset = selTrack
                ? bpmToY(selTrack.bpm || selTrack.bpm_level || 100) - bpmToY(selTrack.bpm_level || selTrack.bpm || 100)
                : 0;

            // Render tracks at their BPM Y positions (shifted by colOffset)
            slot.tracks.forEach((track, ti) => {
                if (!track) {
                    // Loading shimmer placeholder for empty BPM rows
                    if (slot._loading) {
                        const ph = document.createElement("div");
                        ph.className = "set-track-slot set-track-shimmer";
                        const level = SET_BPM_LEVELS[ti] || 100;
                        ph.style.top = `${bpmToY(level) - SET_IMG / 2}px`;
                        col.appendChild(ph);
                    }
                    return;
                }

                const isSelected = ti === slot.selectedTrackIndex;
                const shouldFadeIn = slot._fadeInExcept && track.id !== slot._fadeInExcept;
                const el = document.createElement("div");
                el.className = `set-track-slot${isSelected ? " selected" : ""}${shouldFadeIn ? " set-track-fade-in" : ""}`;
                if (shouldFadeIn) {
                    // Stagger delay: ripple outward from anchor position
                    const anchorIdx = slot.selectedTrackIndex || 0;
                    const dist = Math.abs(ti - anchorIdx);
                    el.style.animationDelay = `${dist * 60}ms`;
                }
                el.dataset.trackIdx = ti;
                el.dataset.slotId = slot.id;

                // Key-colored border for selected track
                if (isSelected) {
                    const kc = camelotColor(track.key);
                    if (kc) {
                        el.style.borderColor = kc;
                        el.style.boxShadow = `0 0 10px ${kc}66, 0 0 3px ${kc}33`;
                    }
                }

                // Position at BPM (offset so selected track aligns to actual BPM)
                const bpm = track.bpm_level || track.bpm || 100;
                el.style.top = `${bpmToY(bpm) - SET_IMG / 2 + colOffset}px`;

                // Label fallback
                const label = document.createElement("div");
                label.className = "set-track-label";
                label.textContent = (track.artist || "").split(/[,&]/)[0].trim().slice(0, 8);
                el.appendChild(label);

                // Artwork
                const img = document.createElement("img");
                img.alt = "";
                img.draggable = false;
                img.style.display = "none";
                img.onload = () => { img.style.display = ""; };
                img.onerror = () => { img.style.display = "none"; };
                el.appendChild(img);
                img.dataset.pendingArtist = track.artist || "";
                img.dataset.pendingTitle = track.title || "";

                // Click to select
                el.addEventListener("click", (e) => {
                    e.stopPropagation();
                    onTrackClick(slot.id, ti);
                });

                // Tooltip
                el.addEventListener("mouseenter", (e) => showTooltip(e, track));
                el.addEventListener("mouseleave", hideTooltip);

                col.appendChild(el);
            });
        }

        container.appendChild(col);
    });

    // Bypass IntersectionObserver — queue artwork directly (observer doesn't
    // reliably fire inside the horizontally-scrolling .set-grid-scroll container)
    if (typeof _queueArtwork === "function") {
        container.querySelectorAll("img[data-pending-artist]").forEach(img => {
            _queueArtwork(img.dataset.pendingArtist, img.dataset.pendingTitle, img);
            delete img.dataset.pendingArtist;
            delete img.dataset.pendingTitle;
        });
    }

    // Re-apply play-set-active styling + overlay after DOM rebuild
    const _audioActive = setAudio && setAudio.src && !setAudio.ended;
    if (_audioActive && setPlaySetIndex >= 0 && setPlaySetIndex < setSlots.length) {
        const activeSlot = setSlots[setPlaySetIndex];
        const col = container.querySelector(`.set-column[data-slot-id="${activeSlot.id}"]`);
        if (col) {
            col.classList.add("play-set-active");
            const activeTrack = activeSlot.tracks[activeSlot.selectedTrackIndex];
            createEqOverlay(col, activeTrack ? activeTrack.bpm : null);
            createPlayOverlay(col, setPlaySetIndex);
        }
    }
}


// ── Time Row ──

function renderTimeRow() {
    const row = document.getElementById("set-time-row");
    row.innerHTML = "";

    setSlots.forEach((_, i) => {
        const cell = document.createElement("div");
        cell.className = "set-time-cell";
        const mins = i * 3;
        cell.textContent = `${Math.floor(mins / 60)}:${(mins % 60).toString().padStart(2, "0")}`;
        row.appendChild(cell);
    });
}


// ═══════════════════════════════════════════════════════════════════════════
// Track Selection
// ═══════════════════════════════════════════════════════════════════════════

function onTrackClick(slotId, trackIdx) {
    const slot = setSlots.find(s => s.id === slotId);
    if (!slot || trackIdx < 0 || trackIdx >= slot.tracks.length) return;
    if (!slot.tracks[trackIdx]) return;

    const wasSelected = slot.selectedTrackIndex === trackIdx;
    const track = slot.tracks[trackIdx];
    const si = setSlots.indexOf(slot);

    if (!wasSelected) {
        slot.selectedTrackIndex = trackIdx;
        renderSet();
        scheduleAutoSave();
    }

    // Play the track respecting current mode (Full Track or Short Preview)
    // playSlot also opens the drawer and updates now-playing info
    if (track.has_audio) {
        playSlot(si);
    } else {
        // No audio — just show track info in drawer
        if (_isMobileView()) {
            if (!baseDrawerOpen) {
                baseDrawerOpen = true;
                const drawer = document.getElementById("base-drawer");
                document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));
                drawer.classList.add("open");
                // Default to expanded detail view on mobile
                drawer.classList.add("expanded");
                document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
            }
            updateNowPlayingDrawer(track, si);
            syncBaseDrawer();
        } else {
            openDrawer("now-playing", null);
            updateNowPlayingDrawer(track, si);
        }
    }
}



// ═══════════════════════════════════════════════════════════════════════════
// Slot Controls
// ═══════════════════════════════════════════════════════════════════════════

function handleSlotControl(slotId, action) {
    const idx = setSlots.findIndex(s => s.id === slotId);
    if (idx === -1) return;

    switch (action) {
        case "delete": {
            if (setSlots.length <= 1) return;
            const wasCurrent = isPlaySetMode() && idx === setPlaySetIndex;
            const wasBefore  = isPlaySetMode() && idx < setPlaySetIndex;
            setSlots.splice(idx, 1);
            if (wasBefore) setPlaySetIndex--;
            ensureBookendSlots();
            renderSet();
            scheduleAutoSave();
            // If we deleted the playing slot, advance to next playable
            if (wasCurrent) {
                const next = findNextPlaySetSlot(Math.min(setPlaySetIndex, setSlots.length - 1));
                if (next >= 0) playSlot(next);
                else stopPlayback();
            }
            break;
        }
    }
}


// ── Slot Reordering ──

let dragSlotId = null;
let dragGroupSlotIds = null;  // array of slot IDs when dragging a group

function onSlotDragStart(e, slotId) {
    dragSlotId = slotId;
    dragGroupSlotIds = null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "slot");
}

function onGroupDragStart(e, slotIds) {
    dragGroupSlotIds = slotIds;
    dragSlotId = slotIds[0];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "group");
}

function onSlotDragOver(e) {
    if (dragSlotId || dragGroupSlotIds) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    } else if (setDragTrack) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }
}

function onSlotDrop(e, targetSlotId) {
    e.preventDefault();

    // Track drop from drawer → delegate to onTrackDrop
    if (setDragTrack && !dragSlotId && !dragGroupSlotIds) {
        onTrackDrop(e, targetSlotId);
        return;
    }

    // Group drag — move all group slots as a block
    if (dragGroupSlotIds) {
        const targetIdx = setSlots.findIndex(s => s.id === targetSlotId);
        if (targetIdx === -1) return;
        // Don't drop onto itself
        if (dragGroupSlotIds.includes(targetSlotId)) {
            dragGroupSlotIds = null;
            dragSlotId = null;
            return;
        }
        // Extract group slots (in order)
        const groupSlots = dragGroupSlotIds.map(id => setSlots.find(s => s.id === id)).filter(Boolean);
        const playingSlotId = isPlaySetMode() ? setSlots[setPlaySetIndex]?.id : null;
        // Remove them from array
        for (const gs of groupSlots) {
            const idx = setSlots.indexOf(gs);
            if (idx !== -1) setSlots.splice(idx, 1);
        }
        // Find new target index after removal
        const newTargetIdx = setSlots.findIndex(s => s.id === targetSlotId);
        const insertIdx = newTargetIdx === -1 ? setSlots.length : newTargetIdx;
        // Insert group at target
        setSlots.splice(insertIdx, 0, ...groupSlots);
        // Re-sync play index after reorder
        if (playingSlotId) syncPlaySetIndex(playingSlotId);
        dragGroupSlotIds = null;
        dragSlotId = null;
        ensureBookendSlots();
        renderSet();
        scheduleAutoSave();
        return;
    }

    // Single slot drag
    if (!dragSlotId || dragSlotId === targetSlotId) return;

    const fromIdx = setSlots.findIndex(s => s.id === dragSlotId);
    const toIdx = setSlots.findIndex(s => s.id === targetSlotId);
    if (fromIdx === -1 || toIdx === -1) return;

    const playingSlotId = isPlaySetMode() ? setSlots[setPlaySetIndex]?.id : null;
    const [moved] = setSlots.splice(fromIdx, 1);
    setSlots.splice(toIdx, 0, moved);
    if (playingSlotId) syncPlaySetIndex(playingSlotId);
    dragSlotId = null;
    ensureBookendSlots();
    renderSet();
    scheduleAutoSave();
}


// ═══════════════════════════════════════════════════════════════════════════
// Drawer
// ═══════════════════════════════════════════════════════════════════════════

function openDrawer(mode, targetSlotId) {
    setDrawerMode = mode;
    setDrawerTargetSlotId = targetSlotId;
    setDrawerOpen = true;

    const drawer = document.getElementById("set-drawer");
    drawer.classList.add("open");

    // Push content left so drawer doesn't cover slots
    const tab = document.getElementById("tab-setbuilder");
    if (tab) tab.classList.add("drawer-open");

    // Hide all sections
    document.querySelectorAll(".set-drawer-section").forEach(s => s.classList.add("hidden"));

    if (mode === "browse") {
        document.getElementById("set-drawer-browse").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Assign Source";
        document.getElementById("set-drawer-search").value = "";
        loadDrawerSources("");
    } else if (mode === "detail") {
        document.getElementById("set-drawer-detail").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Source Detail";
        const slot = targetSlotId ? setSlots.find(s => s.id === targetSlotId) : null;
        if (slot && slot.source) {
            loadDrawerSourceDetail(slot.source);
        }
    } else if (mode === "search") {
        document.getElementById("set-drawer-search-mode").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Track Search";
        document.getElementById("set-drawer-track-search").value = "";
        document.getElementById("set-drawer-search-results").innerHTML = "";
        document.getElementById("set-drawer-selected-track").classList.add("hidden");
        document.getElementById("set-drawer-selected-track").innerHTML = "";
        document.getElementById("set-drawer-search-context").classList.add("hidden");
        setTimeout(() => document.getElementById("set-drawer-track-search").focus(), 350);
    } else if (mode === "init") {
        document.getElementById("set-drawer-init").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Loading Set";
        // Close base drawer if open
        if (baseDrawerOpen) closeBaseDrawer();
    } else if (mode === "now-playing") {
        document.getElementById("set-drawer-now-playing").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Now Playing";
        // Close base drawer if open (expanding back from base)
        if (baseDrawerOpen) closeBaseDrawer();
    }

    // Change close button text based on mode
    const closeBtn = document.getElementById("set-drawer-close");
    closeBtn.textContent = (mode === "now-playing") ? "Base Drawer" : "Close";

    // After layout shift, keep the target slot visible
    if (targetSlotId) {
        setTimeout(() => {
            const col = document.querySelector(`.set-column[data-slot-id="${targetSlotId}"]`);
            if (col) _scrollToActiveTrack(col);
        }, 320);  // wait for the 0.3s CSS transition
    }
}

function closeDrawer() {
    // In Play Mode: closing an edit drawer (browse/search/detail) returns
    // to Now Playing; closing Now Playing itself transitions to base drawer.
    if (isPlaySetMode() && setDrawerMode !== "now-playing" && setDrawerMode !== "init") {
        openDrawer("now-playing", null);
        return;
    }
    if (isPlaySetMode() && setDrawerMode === "now-playing") {
        transitionToBaseDrawer();
        return;
    }
    setDrawerOpen = false;
    setDrawerTargetSlotId = null;
    setDrawerMode = null;
    document.getElementById("set-drawer").classList.remove("open");

    // Restore full content width
    const tab = document.getElementById("tab-setbuilder");
    if (tab) tab.classList.remove("drawer-open");
}

// ── Base Drawer (bottom slide-up) ──

function transitionToBaseDrawer() {
    // Close the right drawer
    setDrawerOpen = false;
    setDrawerTargetSlotId = null;
    setDrawerMode = null;
    document.getElementById("set-drawer").classList.remove("open");
    const tab = document.getElementById("tab-setbuilder");
    if (tab) tab.classList.remove("drawer-open");

    // Push content up on ALL tabs so the fixed drawer doesn't cover anything
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));

    // Open the base drawer after right drawer starts sliding out
    setTimeout(() => {
        baseDrawerOpen = true;
        const drawer = document.getElementById("base-drawer");
        drawer.classList.add("open");
        // Default to expanded detail view on mobile
        if (_isMobileView()) {
            drawer.classList.add("expanded");
            syncBaseDrawerDetail();
            document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
        }
    }, 150);

    // Sync current now-playing data to base drawer
    syncBaseDrawer();
}

function closeBaseDrawer() {
    baseDrawerOpen = false;
    const drawer = document.getElementById("base-drawer");
    drawer.classList.remove("open", "expanded");
    document.querySelectorAll(".tab-content").forEach(t => {
        t.classList.remove("base-drawer-open", "base-drawer-expanded");
    });
}

function expandFromBaseDrawer() {
    // Transition back: close base drawer, open right drawer in now-playing
    openDrawer("now-playing", null);
}

function syncBaseDrawer() {
    // Copy current now-playing data to base drawer elements
    document.getElementById("base-np-title").textContent =
        document.getElementById("now-playing-title").textContent;
    document.getElementById("base-np-comment").textContent =
        document.getElementById("now-playing-comment").textContent;
    document.getElementById("base-np-counter").textContent =
        document.getElementById("now-playing-counter").textContent;

    // Build comma-separated artist line from right drawer
    const artist = document.getElementById("now-playing-artist").textContent;
    const bpm = document.getElementById("now-playing-bpm").textContent;
    const key = document.getElementById("now-playing-key").textContent;
    const year = document.getElementById("now-playing-year").textContent;
    document.getElementById("base-np-artist-line").textContent =
        [artist, bpm, key, year].filter(Boolean).join(", ");

    // Artwork
    const srcArt = document.getElementById("now-playing-artwork").src;
    if (srcArt) document.getElementById("base-np-artwork").src = srcArt;

    // Collection leaf title + description from the right drawer card
    const collSrc = document.getElementById("now-playing-collection-leaf");
    const leafH4 = collSrc.querySelector("h4");
    document.getElementById("base-np-collection").textContent = leafH4 ? leafH4.textContent : "";
    const descEl = collSrc.querySelector(".set-search-card-desc");
    if (descEl) {
        const fullSpan = descEl.querySelector(".set-search-card-desc-full");
        const raw = fullSpan ? fullSpan.textContent : descEl.textContent;
        document.getElementById("base-np-collection-desc").textContent =
            raw.replace(/Show (More|Less)/g, "").trim();
    }

    // Also appears in (compact)
    const alsoSrc = document.getElementById("now-playing-also-in");
    const alsoDst = document.getElementById("base-np-also-in");
    const links = alsoSrc.querySelectorAll(".also-in-link");
    alsoDst.textContent = links.length ? "Also in " + links.length + " more" : "";

    // Sync play/pause icon
    const mainIcon = document.getElementById("now-playing-play-pause").innerHTML;
    document.getElementById("base-np-play-pause").innerHTML = mainIcon;

    // Sync progress
    document.getElementById("base-np-progress-fill").style.width =
        document.getElementById("now-playing-progress-fill").style.width;
    document.getElementById("base-np-current-time").textContent =
        document.getElementById("now-playing-current-time").textContent;
    document.getElementById("base-np-duration").textContent =
        document.getElementById("now-playing-duration").textContent;
}


// ── Mobile Base Drawer: expand/collapse ──

function _isMobileView() {
    return window.matchMedia("(max-width: 768px)").matches;
}

// ── Mobile: vertically center grid in available viewport space ──
// When the expanded detail drawer is open, cap height at 5 track covers
// so the selected track sits in the middle with ~2 above and ~2 below.
const SET_MOBILE_EXPANDED_H = 300;

function _updateWorkshopGridPosition() {
    const wrapper = document.getElementById("set-grid-wrapper");
    if (!wrapper) return;

    if (!_isMobileView()) {
        wrapper.style.height = "";
        return;
    }

    const nav = document.getElementById("tab-bar");
    const drawer = document.getElementById("base-drawer");
    const header = document.querySelector(".unified-header");

    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const isExpanded = drawer && drawer.classList.contains("expanded");

    if (isExpanded) {
        // Fixed 5-cover grid height; drawer fills the remaining space
        wrapper.style.height = SET_MOBILE_EXPANDED_H + "px";
        const drawerH = window.innerHeight - headerH - SET_MOBILE_EXPANDED_H;
        if (drawer) drawer.style.height = Math.max(drawerH, 120) + "px";
    } else {
        // Clear explicit drawer height from expanded mode
        if (drawer) drawer.style.height = "";
        const drawerH = (drawer && drawer.classList.contains("open"))
            ? drawer.getBoundingClientRect().height : 0;
        const available = window.innerHeight - navH - drawerH;
        wrapper.style.height = Math.max(available, 100) + "px";
    }
}

// ── Center view on the selected track image in the active column ──
// Scrolls both horizontally (set-grid-scroll) and vertically (set-grid-wrapper on
// mobile, or set-bpm-grid area) so the playing track's cover art is as close to
// the center of the visible area as possible.
function _scrollToActiveTrack(col) {
    if (!col) return;

    // Find the selected track element within this column
    const trackEl = col.querySelector(".set-track-slot.selected");
    if (!trackEl) return;

    const scroller = document.getElementById("set-grid-scroll");
    if (!scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const trackRect = trackEl.getBoundingClientRect();

    // Horizontal offset: center track in viewport
    const trackCenterX = trackRect.left + trackRect.width / 2;
    const scrollerCenterX = scrollerRect.left + scrollerRect.width / 2;
    const offsetX = trackCenterX - scrollerCenterX;

    // Vertical offset: only on mobile where the scroller is also vertically scrollable
    let offsetY = 0;
    if (_isMobileView() && scroller.scrollHeight > scroller.clientHeight) {
        const trackCenterY = trackRect.top + trackRect.height / 2;
        const scrollerCenterY = scrollerRect.top + scrollerRect.height / 2;
        offsetY = trackCenterY - scrollerCenterY;
    }

    // Single scrollBy call for both axes to avoid cancellation
    scroller.scrollBy({ left: offsetX, top: offsetY, behavior: "smooth" });
}

// ── Mobile wide-column: swap selected track img to cover_big ──
function _upgradePlayingArtwork(col, track) {
    if (!_isMobileView() || !col || !track) return;
    const img = col.querySelector(".set-track-slot.selected img");
    if (!img) return;
    // Store original small src so we can restore later
    if (!img.dataset.smallSrc) img.dataset.smallSrc = img.src;
    // Fetch big artwork via the same endpoint used by now-playing drawer
    loadNowPlayingArtwork(track.artist, track.title, img);
    // Widen the matching insert-row spacer (inline width set by JS)
    const slotId = col.dataset.slotId;
    const spacer = _findInsertSpacer(slotId);
    if (spacer) { spacer.dataset.origWidth = spacer.style.width; spacer.style.width = "112px"; }
}

function _downgradePlayingArtwork(col) {
    if (!col) return;
    const img = col.querySelector(".set-track-slot.selected img");
    if (img && img.dataset.smallSrc) {
        img.src = img.dataset.smallSrc;
        delete img.dataset.smallSrc;
    }
    // Restore insert-row spacer width
    const slotId = col.dataset.slotId;
    const spacer = _findInsertSpacer(slotId);
    if (spacer && spacer.dataset.origWidth) {
        spacer.style.width = spacer.dataset.origWidth;
        delete spacer.dataset.origWidth;
    }
}

// Find the insert-row spacer (delete btn cell) for a given slot
function _findInsertSpacer(slotId) {
    if (!slotId) return null;
    // Insert row spacers don't have data attributes — match by index
    const colIdx = Array.from(document.querySelectorAll(".set-column")).findIndex(
        c => c.dataset.slotId === slotId
    );
    if (colIdx < 0) return null;
    return document.querySelectorAll(".set-insert-spacer")[colIdx] || null;
}

function _recenterAfterDrawerChange() {
    // After drawer height changes, recalculate grid size and re-center on active track
    setTimeout(() => {
        _updateWorkshopGridPosition();
        const activeCol = document.querySelector(".set-column.play-set-active");
        if (activeCol) _scrollToActiveTrack(activeCol);
    }, 350); // wait for CSS transition
}

function toggleBaseDrawerExpanded() {
    const drawer = document.getElementById("base-drawer");
    const isExpanded = drawer.classList.toggle("expanded");
    if (isExpanded) {
        syncBaseDrawerDetail();
        document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
    } else {
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("base-drawer-expanded"));
    }
    _recenterAfterDrawerChange();
}

function collapseBaseDrawerExpanded() {
    const drawer = document.getElementById("base-drawer");
    drawer.classList.remove("expanded");
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("base-drawer-expanded"));
    _recenterAfterDrawerChange();
}

function syncBaseDrawerDetail() {
    // Copy full detail from the now-playing side drawer into the expanded bottom drawer
    const title = document.getElementById("now-playing-title").textContent;
    const artist = document.getElementById("now-playing-artist").textContent;
    const bpm = document.getElementById("now-playing-bpm").textContent;
    const key = document.getElementById("now-playing-key").textContent;
    const year = document.getElementById("now-playing-year").textContent;
    const comment = document.getElementById("now-playing-comment").textContent;
    const artSrc = document.getElementById("now-playing-artwork").src;

    document.getElementById("base-detail-title").textContent = title;
    document.getElementById("base-detail-artist").textContent = artist;
    document.getElementById("base-detail-meta").textContent =
        [bpm, key, year].filter(Boolean).join("  \u00b7  ");
    document.getElementById("base-detail-comment").textContent = comment;
    if (artSrc) document.getElementById("base-detail-artwork-img").src = artSrc;

    // Collection info
    const collSrc = document.getElementById("now-playing-collection-leaf");
    const leafH4 = collSrc.querySelector("h4");
    const descEl = collSrc.querySelector(".set-search-card-desc");
    const collEl = document.getElementById("base-detail-collection");
    if (leafH4) {
        let html = "<strong>" + leafH4.textContent + "</strong>";
        if (descEl) {
            const fullSpan = descEl.querySelector(".set-search-card-desc-full");
            const raw = fullSpan ? fullSpan.textContent : descEl.textContent;
            html += "<br><span style='font-size:0.7rem;color:var(--text-muted);'>" +
                raw.replace(/Show (More|Less)/g, "").trim() + "</span>";
        }
        collEl.innerHTML = html;
    } else {
        collEl.innerHTML = "";
    }

    // Also in
    const alsoSrc = document.getElementById("now-playing-also-in");
    const links = alsoSrc.querySelectorAll(".also-in-link");
    const alsoEl = document.getElementById("base-detail-also-in");
    if (links.length) {
        alsoEl.innerHTML = "<span style='font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;'>Also appears in</span><br>" +
            Array.from(links).map(l => l.textContent).join(", ");
    } else {
        alsoEl.textContent = "";
    }
}

// Override expandFromBaseDrawer on mobile: expand in-place instead of opening side drawer
const _originalExpandFromBaseDrawer = expandFromBaseDrawer;
expandFromBaseDrawer = function() {
    if (_isMobileView()) {
        toggleBaseDrawerExpanded();
    } else {
        _originalExpandFromBaseDrawer();
    }
};


// ═══════════════════════════════════════════════════════════════════════════
// Init Sequence — step-by-step loading with progress bars
// ═══════════════════════════════════════════════════════════════════════════

function _addInitStep(log, label) {
    const el = document.createElement("div");
    el.className = "set-init-step";
    el.innerHTML = `
        <div class="set-init-step-row">
            <span class="init-icon"></span><span>${label}</span>
        </div>
        <div class="set-init-progress"><div class="set-init-progress-fill"></div></div>
    `;
    log.appendChild(el);
    return el;
}

function _markInitStep(el, state) {
    el.classList.remove("active", "done", "fail");
    el.classList.add(state);
}

function _setInitProgress(el, pct) {
    const fill = el.querySelector(".set-init-progress-fill");
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
}

/**
 * Run the set initialization sequence, showing progress in the appropriate panel.
 * @param {Object} opts
 * @param {boolean} opts.isNewLoad - true when loading a saved set (vs initial startup)
 * @param {string|null} opts.setName - name of set being loaded (for display)
 * @returns {Promise<boolean>} true if init succeeded and has a playable first track
 */
async function _runSetInitSequence(opts = {}) {
    if (_setInitRunning) return false;
    _setInitRunning = true;

    const isMobile = _isMobileView();
    let log, errorEl;

    if (isMobile) {
        // Show init in mobile base drawer
        const baseDrawer = document.getElementById("base-drawer");
        const initPanel = document.getElementById("base-drawer-init");
        log = document.getElementById("set-init-log-mobile");
        errorEl = document.getElementById("set-init-error-mobile");

        // Open the base drawer with the init panel visible
        baseDrawerOpen = true;
        baseDrawer.classList.add("open", "expanded");
        document.querySelectorAll(".tab-content").forEach(t => {
            t.classList.add("base-drawer-open", "base-drawer-expanded");
        });
        // Hide the normal detail and track info, show init
        document.getElementById("base-drawer-detail").style.display = "none";
        document.querySelector(".base-drawer-left").style.display = "none";
        initPanel.style.display = "block";
    } else {
        // Desktop: show init in right drawer
        openDrawer("init", null);
        log = document.getElementById("set-init-log");
        errorEl = document.getElementById("set-init-error");
    }

    // Reset
    log.innerHTML = "";
    errorEl.textContent = "";
    errorEl.classList.add("hidden");

    // Update header
    const headerText = opts.setName ? `Loading "${opts.setName}"` : "Loading Set";
    log.closest(".set-init-container").querySelector(".set-init-header").textContent = headerText;

    // ── Step 1: Load set data ──
    const stepLoad = _addInitStep(log, opts.isNewLoad ? "Loading set data" : "Restoring session state");
    _markInitStep(stepLoad, "active");
    _setInitProgress(stepLoad, 10);

    try {
        if (opts.isNewLoad && opts.loadFn) {
            _setInitProgress(stepLoad, 30);
            await opts.loadFn();
            _setInitProgress(stepLoad, 100);
        } else {
            // Initial startup — loadSavedSetState
            _setInitProgress(stepLoad, 30);
            await loadSavedSetState();
            _setInitProgress(stepLoad, 100);
        }
        _markInitStep(stepLoad, "done");
    } catch (e) {
        console.error("Set load failed:", e);
        _markInitStep(stepLoad, "fail");
        _setInitProgress(stepLoad, 100);
        errorEl.textContent = `Failed to load set data: ${e.message || e}`;
        errorEl.classList.remove("hidden");
        _setInitRunning = false;
        return false;
    }

    // ── Step 2: Validate slots ──
    const stepValidate = _addInitStep(log, "Validating set structure");
    _markInitStep(stepValidate, "active");
    _setInitProgress(stepValidate, 20);
    await new Promise(r => setTimeout(r, 100));

    const hasSlots = setSlots.length > 0;
    const filledSlots = setSlots.filter(s => s.selectedTrackIndex != null).length;
    _setInitProgress(stepValidate, 100);

    if (!hasSlots) {
        _markInitStep(stepValidate, "fail");
        errorEl.textContent = "No slots found. The set may be empty or corrupted.";
        errorEl.classList.remove("hidden");
        _setInitRunning = false;
        return false;
    }
    _markInitStep(stepValidate, filledSlots > 0 ? "done" : "fail");
    if (filledSlots === 0) {
        errorEl.textContent = "Set has no tracks assigned. Add tracks via the source browser.";
        errorEl.classList.remove("hidden");
        // Not a fatal error — still allow the workshop to open
    }

    // ── Step 3: Check audio availability ──
    const stepAudio = _addInitStep(log, "Checking audio availability");
    _markInitStep(stepAudio, "active");
    _setInitProgress(stepAudio, 10);

    try {
        _setInitProgress(stepAudio, 40);
        setAudioFlagsReady = refreshHasAudioFlags();
        await setAudioFlagsReady;
        _setInitProgress(stepAudio, 100);
        _markInitStep(stepAudio, "done");
    } catch (e) {
        console.error("Audio flags check failed:", e);
        _setInitProgress(stepAudio, 100);
        _markInitStep(stepAudio, "fail");
        errorEl.textContent = `Audio check failed: ${e.message || e}. Playback may be unavailable.`;
        errorEl.classList.remove("hidden");
        // Non-fatal — continue
    }

    // ── Step 4: Prepare first track ──
    const stepFirst = _addInitStep(log, "Preparing first track");
    _markInitStep(stepFirst, "active");
    _setInitProgress(stepFirst, 20);
    await new Promise(r => setTimeout(r, 100));

    const firstSlot = findNextPlaySetSlot(0);
    let firstTrack = null;
    if (firstSlot >= 0) {
        setPlaySetIndex = firstSlot;
        const slot = setSlots[firstSlot];
        firstTrack = slot.tracks[slot.selectedTrackIndex];
        if (firstTrack) {
            updateNowPlayingDrawer(firstTrack, firstSlot);
            _setInitProgress(stepFirst, 80);
        }
    }
    _setInitProgress(stepFirst, 100);
    _markInitStep(stepFirst, firstTrack ? "done" : "fail");

    if (!firstTrack && filledSlots > 0) {
        errorEl.textContent = "Could not find a playable first track. Tracks may lack audio files.";
        errorEl.classList.remove("hidden");
    }

    // ── Step 5: Position grid ──
    const stepPosition = _addInitStep(log, "Positioning workshop grid");
    _markInitStep(stepPosition, "active");
    _setInitProgress(stepPosition, 50);
    _updateWorkshopGridPosition();
    await new Promise(r => setTimeout(r, 300));
    _setInitProgress(stepPosition, 100);
    _markInitStep(stepPosition, "done");

    updateModeToggleUI();
    _setInitRunning = false;

    // ── Transition out after a brief pause ──
    await new Promise(r => setTimeout(r, 600));
    _completeInitSequence(firstTrack, firstSlot, !!opts.isNewLoad);

    return !!firstTrack;
}

// Activate a slot visually (column highlight, EQ, play overlay, drawer) without starting audio.
// Used on cold start so the user sees a "paused now-playing" state ready for play.
function _activateSlotVisual(slotIdx) {
    if (slotIdx < 0 || slotIdx >= setSlots.length) return;
    const slot = setSlots[slotIdx];
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    setPlaySetIndex = slotIdx;

    // Clear any previous active column
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    removePlayOverlay();

    // Activate column
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, slotIdx);
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }

    // Activate key cell
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update drawer info
    updateNowPlayingDrawer(track, slotIdx);

    // Show paused icon
    document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9654;";
}

function _completeInitSequence(firstTrack, firstSlotIdx, isNewLoad) {
    const isMobile = _isMobileView();

    if (isMobile) {
        // Hide the init panel, restore normal base drawer state
        document.getElementById("base-drawer-init").style.display = "none";
        // Restore elements hidden during init
        document.querySelector(".base-drawer-left").style.display = "";
        document.getElementById("base-drawer-detail").style.display = "";
        // Reposition grid now that drawer layout has changed
        _updateWorkshopGridPosition();

        if (firstTrack) {
            // Show expanded detail view by default on mobile
            const baseDrawer = document.getElementById("base-drawer");
            baseDrawer.classList.add("expanded");
            document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
            // Sync track info to base drawer
            syncBaseDrawer();
            syncBaseDrawerDetail();
            // Auto-play on user-triggered set load; visual-only on cold start
            if (isNewLoad && firstSlotIdx >= 0 && firstTrack.has_audio) {
                playSlot(firstSlotIdx);
            } else if (firstSlotIdx >= 0) {
                // Cold start — activate visually (paused), user presses play on overlay
                _activateSlotVisual(firstSlotIdx);
            }
        } else {
            // No track — close the base drawer entirely
            closeBaseDrawer();
        }
    } else {
        // Desktop: switch from init drawer to now-playing with first track
        if (firstTrack) {
            openDrawer("now-playing", null);
            // Auto-play on user-triggered set load; visual-only on cold start
            if (isNewLoad && firstSlotIdx >= 0 && firstTrack.has_audio) {
                playSlot(firstSlotIdx);
            } else if (firstSlotIdx >= 0) {
                // Cold start — activate visually (paused), user presses play on overlay
                _activateSlotVisual(firstSlotIdx);
            }
        } else {
            closeDrawer();
        }
    }

    // Scroll to the first track in the set (center both horizontally and vertically)
    if (firstSlotIdx >= 0) {
        setTimeout(() => {
            const col = document.querySelector(`.set-column[data-slot-id="${workshopSlots[firstSlotIdx]?.id}"]`);
            if (col) _scrollToActiveTrack(col);
        }, 400);
    }
}


// ── Browse Mode ──

async function loadDrawerSources(searchTerm) {
    try {
        const res = await fetch(`/api/set-workshop/sources?search=${encodeURIComponent(searchTerm || "")}`);
        const data = await res.json();
        renderDrawerPlaylists(data.playlists);
        renderDrawerCollectionLeaves(data.collection_leaves);
    } catch (e) {
        console.error("Failed to load sources:", e);
    }
}

function renderDrawerPlaylists(playlists) {
    const div = document.getElementById("set-drawer-playlists");
    div.innerHTML = "<h4>Playlists</h4>";
    if (!playlists || playlists.length === 0) {
        div.innerHTML += `<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.5rem;">No playlists found</div>`;
        return;
    }
    for (const pl of playlists) {
        const item = document.createElement("div");
        item.className = "set-drawer-source-item";
        item.innerHTML = `
            <span class="set-drawer-source-name">${escHtml(pl.name)}</span>
            <span class="set-drawer-source-count">${pl.track_count} tracks</span>
        `;
        item.addEventListener("click", () => assignSource("playlist", pl.id, null, pl.name));
        div.appendChild(item);
    }
}

function renderDrawerCollectionLeaves(leaves) {
    const div = document.getElementById("set-drawer-collection-leaves");
    div.innerHTML = "<h4>Collections</h4>";
    if (!leaves || leaves.length === 0) {
        div.innerHTML += `<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.5rem;">No collections available</div>`;
        return;
    }
    for (const leaf of leaves) {
        const item = document.createElement("div");
        item.className = "set-drawer-source-item";
        item.innerHTML = `
            <span class="set-drawer-source-name">${escHtml(leaf.title)}</span>
            <span class="set-drawer-source-count">${leaf.track_count} tracks</span>
        `;
        item.addEventListener("click", () => assignSource("tree_node", leaf.id, "collection", leaf.title));
        div.appendChild(item);
    }
}


// ── Detail Mode ──

async function loadDrawerSourceDetail(source) {
    try {
        const qs = `source_type=${source.type}&source_id=${encodeURIComponent(source.id)}&tree_type=${source.tree_type || ""}`;
        const res = await fetch(`/api/set-workshop/source-detail?${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof _clearDrawerLoading === "function") _clearDrawerLoading();
        renderDrawerDetail(data, source);
    } catch (e) {
        if (typeof _clearDrawerLoading === "function") _clearDrawerLoading();
        console.error("Failed to load source detail:", e);
    }
}


function renderDrawerDetail(data, source) {
    const headerDiv = document.getElementById("set-drawer-detail-header");
    headerDiv.innerHTML = `
        <h4>${escHtml(data.name || "")}</h4>
        ${data.description ? `<p class="set-drawer-desc">${escHtml(data.description)}</p>` : ""}
        <span class="set-drawer-count">${data.track_count || 0} tracks</span>
    `;

    const tracksDiv = document.getElementById("set-drawer-detail-tracks");
    tracksDiv.innerHTML = "";

    if (!data.tracks || data.tracks.length === 0) {
        return;
    }

    for (const track of data.tracks) {
        const row = document.createElement("div");
        row.className = "set-drawer-track-row";

        const safeArtist = escHtml(track.artist || "");
        const safeTitle = escHtml(track.title || "");

        row.draggable = true;
        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="false">
            <button class="btn-preview" data-artist="${safeArtist}" data-title="${safeTitle}" title="Preview">\u25B6</button>
            <div class="set-drawer-track-info">
                <span class="set-drawer-track-title">${safeTitle}</span>
                <span class="set-drawer-track-artist">${safeArtist}</span>
            </div>
            <div class="set-drawer-track-meta">
                <span>${track.bpm ? Math.round(track.bpm) + " BPM" : ""}</span><br>
                <span>${escHtml(track.key || "")}</span>
            </div>
        `;

        // Load artwork
        const img = row.querySelector("img");
        if (typeof loadArtwork === "function") {
            loadArtwork(track.artist, track.title, img);
        }

        // Drag — entire row is draggable, use artwork as drag image
        row.addEventListener("dragstart", (e) => {
            setDragTrack = {
                id: track.id,
                artist: track.artist,
                title: track.title,
                bpm: track.bpm,
                key: track.key || "",
                year: track.year || "",
                source_type: source.type,
                source_id: source.id,
                tree_type: source.tree_type,
            };
            e.dataTransfer.setData("text/plain", String(track.id));
            e.dataTransfer.effectAllowed = "copy";
            if (img.complete && img.naturalWidth > 0) {
                e.dataTransfer.setDragImage(img, 18, 18);
            }
        });
        row.addEventListener("dragend", () => { setDragTrack = null; });

        // Preview button
        row.querySelector(".btn-preview").addEventListener("click", (e) => {
            e.stopPropagation();
            if (typeof togglePreview === "function") {
                togglePreview(track.artist, track.title, e.currentTarget);
            }
        });

        // Click row to assign to target slot (if one is set)
        row.addEventListener("click", () => {
            if (setDrawerTargetSlotId) {
                assignSourceWithAnchor(source.type, source.id, source.tree_type, data.name, track.id);
            }
        });

        tracksDiv.appendChild(row);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Source Assignment
// ═══════════════════════════════════════════════════════════════════════════

async function assignSource(sourceType, sourceId, treeType, sourceName, anchorTrackId) {
    const targetId = setDrawerTargetSlotId;
    if (!targetId) return;

    const slot = setSlots.find(s => s.id === targetId);
    if (!slot) return;

    const usedIds = getUsedTrackIds(targetId);

    try {
        const body = {
            source_type: sourceType,
            source_id: sourceId,
            tree_type: treeType || "",
            used_track_ids: usedIds,
            name: sourceName || "",
        };
        if (anchorTrackId != null) body.anchor_track_id = anchorTrackId;

        const res = await fetch("/api/set-workshop/assign-source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || "Failed to assign source");
            return;
        }

        const data = await res.json();
        slot.source = {
            type: sourceType,
            id: sourceId,
            tree_type: treeType,
            name: data.source ? data.source.name : sourceName,
        };
        slot.tracks = data.tracks || [];
        slot.selectedTrackIndex = findDefaultSelection(slot.tracks, anchorTrackId);

        ensureBookendSlots();
        renderSet();
        scheduleAutoSave();

        // Switch drawer to detail mode for the assigned source so user can
        // drag individual tracks into the slot.
        setDrawerMode = "detail";
        setDrawerTargetSlotId = targetId;
        document.querySelectorAll(".set-drawer-section").forEach(s => s.classList.add("hidden"));
        document.getElementById("set-drawer-detail").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = slot.source.name || "Source Detail";
        loadDrawerSourceDetail(slot.source);
    } catch (e) {
        console.error("Assign source failed:", e);
        alert("Failed to assign source: " + e.message);
    }
}

async function assignSourceWithAnchor(sourceType, sourceId, treeType, sourceName, anchorTrackId) {
    return assignSource(sourceType, sourceId, treeType, sourceName, anchorTrackId);
}


function getUsedTrackIds(excludeSlotId) {
    const ids = [];
    for (const slot of setSlots) {
        if (slot.id === excludeSlotId) continue;
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            ids.push(slot.tracks[slot.selectedTrackIndex].id);
        }
    }
    return ids;
}

function findDefaultSelection(tracks, anchorTrackId) {
    if (!tracks || tracks.length === 0) return null;

    // If anchor specified, find it
    if (anchorTrackId != null) {
        const idx = tracks.findIndex(t => t && t.id === anchorTrackId);
        if (idx >= 0) return idx;
    }

    // Default to ~100 BPM level (index 4)
    if (tracks[4]) return 4;
    // Otherwise first non-null
    return tracks.findIndex(t => t != null);
}


// ═══════════════════════════════════════════════════════════════════════════
// Drag Track from Drawer into Slot
// ═══════════════════════════════════════════════════════════════════════════

async function onTrackDrop(e, slotId) {
    e.preventDefault();
    const col = e.currentTarget;
    col.classList.remove("drag-over");

    if (!setDragTrack) return;

    // Capture drag data locally — dragend can clear setDragTrack during await
    const drag = { ...setDragTrack };
    setDragTrack = null;

    const slot = setSlots.find(s => s.id === slotId);
    if (!slot) return;

    // If slot already has tracks from the same source, swap in-place
    if (slot.source && slot.tracks.length > 0 &&
        slot.source.type === drag.source_type &&
        slot.source.id === drag.source_id) {

        const dragBpm = drag.bpm || 100;

        // Find the track slot closest to the dragged track's BPM
        let bestIdx = 0;
        let bestDist = Infinity;
        slot.tracks.forEach((t, i) => {
            if (!t) return;
            const level = t.bpm_level || t.bpm || 100;
            const dist = Math.abs(level - dragBpm);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        });

        // Replace that track with the dragged one
        const replaced = slot.tracks[bestIdx];
        slot.tracks[bestIdx] = {
            id: drag.id,
            title: drag.title || "",
            artist: drag.artist || "",
            bpm: drag.bpm,
            key: drag.key || "",
            year: drag.year || "",
            bpm_level: replaced ? replaced.bpm_level : dragBpm,
        };
        slot.selectedTrackIndex = bestIdx;
        ensureBookendSlots();
        renderSet();
        scheduleAutoSave();
        return;
    }

    // Otherwise, assign as new source via API
    const usedIds = getUsedTrackIds(slotId);

    // ── Update drawer first: clear search results, show track details ──
    if (drag.from_search && setDrawerMode === "search") {
        document.getElementById("set-drawer-track-search").value = "";
        document.getElementById("set-drawer-search-results").innerHTML = "";
        loadTrackContext(drag);
    }

    // ── Phase 1: Immediately place anchor track + show loading shimmer ──
    const anchorBpm = drag.bpm || 100;
    const bestLevel = SET_BPM_LEVELS.reduce((best, lv) =>
        Math.abs(lv - anchorBpm) < Math.abs(best - anchorBpm) ? lv : best);
    const anchorIdx = SET_BPM_LEVELS.indexOf(bestLevel);

    // Build a placeholder tracks array: anchor at its level, null elsewhere
    const placeholderTracks = SET_BPM_LEVELS.map((lv, i) =>
        i === anchorIdx ? {
            id: drag.id, title: drag.title || "", artist: drag.artist || "",
            bpm: drag.bpm, key: drag.key || "", year: drag.year || "",
            bpm_level: bestLevel,
        } : null
    );
    slot.source = {
        type: drag.source_type, id: drag.source_id,
        tree_type: drag.tree_type, name: drag.name || "",
    };
    slot.tracks = placeholderTracks;
    slot.selectedTrackIndex = anchorIdx;
    slot._loading = true;
    ensureBookendSlots();
    renderSet();

    // ── Phase 2: Fetch full track list from API ──
    try {
        const res = await fetch("/api/set-workshop/drag-track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                track_id: drag.id,
                source_type: drag.source_type,
                source_id: drag.source_id,
                tree_type: drag.tree_type || "",
                track_ids: drag.track_ids || [],
                name: drag.name || "",
                used_track_ids: usedIds,
            }),
        });

        slot._loading = false;

        if (!res.ok) {
            console.error("Drag track failed:", res.status, await res.text());
            renderSet();
            return;
        }
        const data = await res.json();

        const src = data.source || {};
        slot.source = {
            type: src.type || drag.source_type,
            id: src.id || drag.source_id,
            tree_type: src.tree_type || drag.tree_type,
            name: src.name || "",
        };
        slot.tracks = data.tracks || [];

        // Select the dragged track
        const dragIdx = slot.tracks.findIndex(t => t && t.id === drag.id);
        slot.selectedTrackIndex = dragIdx >= 0 ? dragIdx : findDefaultSelection(slot.tracks);

        // Mark non-anchor tracks for fade-in animation
        slot._fadeInExcept = drag.id;

        ensureBookendSlots();
        renderSet();
        scheduleAutoSave();

        // Clear fade-in flag after staggered animation completes
        setTimeout(() => { delete slot._fadeInExcept; }, 900);
    } catch (e2) {
        slot._loading = false;
        console.error("Drag track failed:", e2);
        renderSet();
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Refill BPM — re-run BPM fill for all slots using current anchors
// ═══════════════════════════════════════════════════════════════════════════

async function refillAllBpm() {
    const btn = document.getElementById("set-refill-btn");
    if (btn.disabled) return;

    // Count slots that will be processed
    const filled = setSlots.filter(s => s.source && s.tracks.length > 0 && s.selectedTrackIndex != null);
    if (filled.length === 0) return;

    btn.disabled = true;
    btn.textContent = "Refilling…";

    // Mark all filled slots as loading (shimmer)
    for (const slot of setSlots) {
        if (!slot.source || !slot.tracks.length || slot.selectedTrackIndex == null) continue;
        const anchor = slot.tracks[slot.selectedTrackIndex];
        if (!anchor) continue;

        // Keep only the anchor, null out the rest
        const anchorBpm = anchor.bpm || 100;
        const bestLevel = SET_BPM_LEVELS.reduce((best, lv) =>
            Math.abs(lv - anchorBpm) < Math.abs(best - anchorBpm) ? lv : best);
        const anchorIdx = SET_BPM_LEVELS.indexOf(bestLevel);

        slot.tracks = SET_BPM_LEVELS.map((lv, i) =>
            i === anchorIdx ? { ...anchor, bpm_level: bestLevel } : null
        );
        slot.selectedTrackIndex = anchorIdx;
        slot._loading = true;
    }
    renderSet();

    // Stream results via SSE
    try {
        const res = await fetch("/api/set-workshop/refill-bpm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slots: setSlots.map(s => ({
                source: s.source,
                tracks: s.tracks,
                selectedTrackIndex: s.selectedTrackIndex,
            })) }),
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = JSON.parse(line.slice(6));

                if (data.done) break;

                const slot = setSlots[data.slot_index];
                if (!slot) continue;

                // Update source if it was auto-upgraded
                if (data.source) {
                    slot.source = {
                        type: data.source.type || slot.source.type,
                        id: data.source.id || slot.source.id,
                        tree_type: data.source.tree_type || slot.source.tree_type,
                        name: data.source.name || slot.source.name,
                    };
                }

                // Find the anchor track ID (the one we kept)
                const anchorTrack = slot.tracks.find(t => t !== null);
                const anchorId = anchorTrack ? anchorTrack.id : null;

                slot.tracks = data.tracks || [];
                slot._loading = false;

                // Select the anchor
                const anchorIdx = slot.tracks.findIndex(t => t && t.id === anchorId);
                slot.selectedTrackIndex = anchorIdx >= 0 ? anchorIdx : findDefaultSelection(slot.tracks);

                // Staggered fade-in for non-anchor tracks
                slot._fadeInExcept = anchorId;
                renderSet();
                setTimeout(() => { delete slot._fadeInExcept; }, 900);

                btn.textContent = `Refilling… ${data.progress}/${data.total}`;
            }
        }
    } catch (e) {
        console.error("Refill BPM failed:", e);
    }

    // Clean up
    for (const slot of setSlots) {
        delete slot._loading;
        delete slot._fadeInExcept;
    }
    btn.textContent = "Refill BPM";
    updateToolbarState();
    renderSet();
    scheduleAutoSave();
    showToast("BPM refill complete");
}


// ═══════════════════════════════════════════════════════════════════════════
// Preview All (30-sec Deezer previews)
// ═══════════════════════════════════════════════════════════════════════════

// Preview All removed — Short Preview mode IS "preview all"


// ═══════════════════════════════════════════════════════════════════════════
// Play Set (full-track local playback)
// ═══════════════════════════════════════════════════════════════════════════

function switchMode(mode) {
    if (mode === setWorkshopMode) return; // already in target mode

    const currentIdx = setPlaySetIndex;
    setWorkshopMode = mode;
    updateModeToggleUI();
    updateToolbarState();

    // Continue playback from current position in the new mode
    const idx = findNextPlaySetSlot(currentIdx >= 0 ? currentIdx : 0);
    if (idx >= 0) {
        playSlot(idx);
    }
}

function updateModeToggleUI() {
    const isWorkshop = setWorkshopMode === "workshop";
    // Side drawer toggle
    const workshopBtn = document.getElementById("set-mode-workshop");
    const playsetBtn  = document.getElementById("set-mode-playset");
    workshopBtn.classList.toggle("active", isWorkshop);
    playsetBtn.classList.toggle("active", !isWorkshop);
    // Base drawer toggle (mirror)
    const baseWs = document.querySelector(".base-mode-workshop");
    const basePl = document.querySelector(".base-mode-playset");
    if (baseWs) baseWs.classList.toggle("active", isWorkshop);
    if (basePl) basePl.classList.toggle("active", !isWorkshop);
}

// Start playing from slot 0 in Full Track mode (used by startup/dance boot)
function enterPlaySetMode() {
    setAudio.pause();
    _previewStartTime = 0;
    setWorkshopMode = "playset";
    updateModeToggleUI();
    updateToolbarState();

    // Start from slot 0 (playSlot handles drawer opening)
    const first = findNextPlaySetSlot(0);
    if (first >= 0) {
        playSlot(first);
    }
}

// Stop all playback and clean up visual state
function stopPlayback() {
    setAutoplayBlocked = false;
    setPlayGen++;
    if (setAudio) {
        setAudio.pause();
        setAudio.currentTime = 0;
        setAudio.src = "";
    }
    _previewStartTime = 0;
    stopEnergyLineAnim();
    removeAllEqOverlays();
    removePlayOverlay();
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );

    // Reset progress display
    document.getElementById("now-playing-progress-fill").style.width = "0%";
    document.getElementById("now-playing-current-time").textContent = "0:00";
    document.getElementById("now-playing-duration").textContent = "0:00";
    document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
    document.getElementById("base-np-progress-fill").style.width = "0%";
    document.getElementById("base-np-current-time").textContent = "0:00";
    document.getElementById("base-np-duration").textContent = "0:00";
    document.getElementById("base-np-play-pause").innerHTML = "&#9654;";

    // Notify Dance tab
    window.dispatchEvent(new CustomEvent("playset-stopped"));
}

// Legacy alias — still called from some places
function exitPlaySetMode(opts) {
    stopPlayback();
    setWorkshopMode = "workshop";
    updateModeToggleUI();
    updateToolbarState();
}


function syncPlaySetIndex(slotId) {
    const idx = setSlots.findIndex(s => s.id === slotId);
    if (idx >= 0) setPlaySetIndex = idx;
}

function findNextPlaySetSlot(fromIdx, wrap = true) {
    // Search forward from fromIdx
    for (let i = fromIdx; i < setSlots.length; i++) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null) {
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track && track.has_audio) return i;
        }
    }
    // Wrap around to beginning if enabled
    if (wrap && fromIdx > 0) {
        for (let i = 0; i < fromIdx; i++) {
            const slot = setSlots[i];
            if (slot.selectedTrackIndex != null) {
                const track = slot.tracks[slot.selectedTrackIndex];
                if (track && track.has_audio) return i;
            }
        }
    }
    return -1;
}

function findPrevPlaySetSlot(fromIdx) {
    for (let i = fromIdx; i >= 0; i--) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null) {
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track && track.has_audio) return i;
        }
    }
    return -1;
}

// ── EQ overlay helpers ──
const EQ_BAR_COUNT = 7;
const EQ_SPEEDS  = [1.2, 0.8, 1.5, 0.9, 1.35, 1.05, 1.4];   // seconds
const EQ_DELAYS  = [0, 0.12, 0.05, 0.18, 0.08, 0.22, 0.03];  // seconds
const EQ_IDLES   = [75, 60, 82, 55, 78, 65, 80];              // idle clip % (higher = shorter bar)

function createEqOverlay(col, bpm) {
    removeEqOverlay(col);

    // Position overlays relative to the selected track
    const selectedSlot = col.querySelector(".set-track-slot.selected");
    if (!selectedSlot) return;

    const trackTop = selectedSlot.offsetTop;
    const trackBottom = trackTop + selectedSlot.offsetHeight;

    // BPM-synced pulse: one full opacity cycle per two beats
    const pulseSpeed = bpm ? (120 / bpm) : 1.0;

    function makeBars(overlay) {
        for (let i = 0; i < EQ_BAR_COUNT; i++) {
            const bar = document.createElement("div");
            bar.className = "set-eq-bar";
            bar.style.setProperty("--eq-speed", EQ_SPEEDS[i] + "s");
            bar.style.setProperty("--eq-delay", EQ_DELAYS[i] + "s");
            bar.style.setProperty("--eq-idle", EQ_IDLES[i] + "%");
            overlay.appendChild(bar);
        }
    }

    // If audio is actively playing, animate immediately
    const eqPlaying = setAudio && !setAudio.paused ? " eq-playing" : "";

    // Top overlay: column top → track top edge, bars project upward
    const upOverlay = document.createElement("div");
    upOverlay.className = "set-eq-overlay set-eq-overlay-up" + eqPlaying;
    upOverlay.style.top = "0";
    upOverlay.style.bottom = (col.offsetHeight - trackTop) + "px";
    upOverlay.style.setProperty("--eq-pulse-speed", pulseSpeed + "s");
    makeBars(upOverlay);
    col.appendChild(upOverlay);

    // Bottom overlay: track bottom edge → column bottom, bars project downward
    const downOverlay = document.createElement("div");
    downOverlay.className = "set-eq-overlay set-eq-overlay-down" + eqPlaying;
    downOverlay.style.top = trackBottom + "px";
    downOverlay.style.bottom = "0";
    downOverlay.style.setProperty("--eq-pulse-speed", pulseSpeed + "s");
    makeBars(downOverlay);
    col.appendChild(downOverlay);
}

function removeEqOverlay(col) {
    col.querySelectorAll(".set-eq-overlay").forEach(el => el.remove());
}

function removeAllEqOverlays() {
    document.querySelectorAll(".set-eq-overlay").forEach(el => el.remove());
}

// ── Play Controls Overlay (crosshair on playing track) ──

function createPlayOverlay(col, slotIdx) {
    removePlayOverlay();

    const slot = setSlots[slotIdx];
    if (!slot) return;
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    const selectedEl = col.querySelector(".set-track-slot.selected");
    if (!selectedEl) return;

    const keyColor = camelotColor(track.key) || "#1db954";

    // BPM-synced pulse: one full cycle per 2 beats (matches EQ overlay)
    const bpm = track.bpm || 120;
    const pulseSpeed = 120 / bpm;

    // Container positioned relative to the column
    const overlay = document.createElement("div");
    overlay.className = "set-play-overlay";
    overlay.style.setProperty("--play-key-color", keyColor);
    overlay.style.setProperty("--play-pulse-speed", pulseSpeed + "s");
    if (setAudio && !setAudio.paused) overlay.classList.add("playing");

    // Use target dimensions — CSS transitions may not have completed yet.
    // On mobile, play-set-active enlarges track to 96×96 at left:8px in 112px col.
    // On desktop, track stays 48×48 at left:4px in 56px col.
    const isMobile = _isMobileView();
    const trackW = isMobile ? 96 : 48;
    const trackH = isMobile ? 96 : 48;
    const trackLeft = isMobile ? 8 : 4;
    const trackTop = selectedEl.offsetTop;  // Y position doesn't change
    const trackCX = trackLeft + trackW / 2;
    const trackCY = trackTop + trackH / 2;

    // Arm lengths
    const armLen = 36;

    // ── Scrim (dark backdrop behind the cross) ──
    const scrim = document.createElement("div");
    scrim.className = "set-play-scrim" + (setAudio && !setAudio.paused ? " playing" : "");
    scrim.style.left = (trackLeft - 2) + "px";
    scrim.style.top = (trackTop - 2) + "px";
    scrim.style.width = (trackW + 4) + "px";
    scrim.style.height = (trackH + 4) + "px";
    overlay.appendChild(scrim);

    // ── Center play/pause icon (visual only — scrim handles tap) ──
    const center = document.createElement("div");
    center.className = "set-play-center";
    center.style.left = (trackCX - 18) + "px";
    center.style.top = (trackCY - 18) + "px";
    center.innerHTML = (setAudio && !setAudio.paused) ? "&#9646;&#9646;" : "&#9654;";
    overlay.appendChild(center);

    // Scrim is the full-image play/pause tap target
    scrim.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlaySetPause();
        const isPlaying = setAudio && !setAudio.paused;
        center.innerHTML = isPlaying ? "&#9646;&#9646;" : "&#9654;";
        scrim.classList.toggle("playing", isPlaying);
        overlay.classList.toggle("playing", isPlaying);
    });

    // ── Left arm (previous track in set) ──
    const hasPrev = findPrevPlaySetSlot(slotIdx - 1) >= 0;
    const armLeft = document.createElement("div");
    armLeft.className = "set-play-arm arm-left";
    armLeft.style.left = (trackLeft - armLen) + "px";
    armLeft.style.top = trackCY + "px";
    armLeft.style.width = armLen + "px";
    const lineL = document.createElement("div");
    lineL.className = "set-play-arm-line";
    armLeft.appendChild(lineL);
    const btnL = document.createElement("div");
    btnL.className = "set-play-arm-btn" + (hasPrev ? "" : " disabled");
    btnL.innerHTML = "&#9664;&#9664;";
    btnL.addEventListener("click", (e) => { e.stopPropagation(); playSetPrev(); });
    armLeft.appendChild(btnL);
    overlay.appendChild(armLeft);

    // ── Right arm (next track in set) ──
    const hasNext = findNextPlaySetSlot(slotIdx + 1) >= 0;
    const armRight = document.createElement("div");
    armRight.className = "set-play-arm arm-right";
    armRight.style.left = (trackLeft + trackW) + "px";
    armRight.style.top = trackCY + "px";
    armRight.style.width = armLen + "px";
    const lineR = document.createElement("div");
    lineR.className = "set-play-arm-line";
    armRight.appendChild(lineR);
    const btnR = document.createElement("div");
    btnR.className = "set-play-arm-btn" + (hasNext ? "" : " disabled");
    btnR.innerHTML = "&#9654;&#9654;";
    btnR.addEventListener("click", (e) => { e.stopPropagation(); playSetNext(); });
    armRight.appendChild(btnR);
    overlay.appendChild(armRight);

    // ── Up arm (higher BPM track in slot) ──
    const cur = slot.selectedTrackIndex;
    let hasHigher = false;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) { hasHigher = true; break; }
    }
    const armUp = document.createElement("div");
    armUp.className = "set-play-arm arm-up";
    armUp.style.left = trackCX + "px";
    armUp.style.top = (trackTop - armLen) + "px";
    armUp.style.height = armLen + "px";
    const lineU = document.createElement("div");
    lineU.className = "set-play-arm-line";
    armUp.appendChild(lineU);
    const btnU = document.createElement("div");
    btnU.className = "set-play-arm-btn" + (hasHigher ? "" : " disabled");
    btnU.innerHTML = "&#9650;";
    btnU.addEventListener("click", (e) => { e.stopPropagation(); bpmSwapUp(); });
    armUp.appendChild(btnU);
    overlay.appendChild(armUp);

    // ── Down arm (lower BPM track in slot) ──
    let hasLower = false;
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) { hasLower = true; break; }
    }
    const armDown = document.createElement("div");
    armDown.className = "set-play-arm arm-down";
    armDown.style.left = trackCX + "px";
    armDown.style.top = (trackTop + trackH) + "px";
    armDown.style.height = armLen + "px";
    const lineD = document.createElement("div");
    lineD.className = "set-play-arm-line";
    armDown.appendChild(lineD);
    const btnD = document.createElement("div");
    btnD.className = "set-play-arm-btn" + (hasLower ? "" : " disabled");
    btnD.innerHTML = "&#9660;";
    btnD.addEventListener("click", (e) => { e.stopPropagation(); bpmSwapDown(); });
    armDown.appendChild(btnD);
    overlay.appendChild(armDown);

    col.appendChild(overlay);
}

function removePlayOverlay() {
    document.querySelectorAll(".set-play-overlay").forEach(el => el.remove());
}

// Update play overlay icon state (called from audio events)
function _updatePlayOverlayIcon() {
    const isPlaying = setAudio && !setAudio.paused;
    const overlay = document.querySelector(".set-play-overlay");
    if (overlay) overlay.classList.toggle("playing", isPlaying);
    const center = document.querySelector(".set-play-center");
    if (center) center.innerHTML = isPlaying ? "&#9646;&#9646;" : "&#9654;";
    const scrim = document.querySelector(".set-play-scrim");
    if (scrim) scrim.classList.toggle("playing", isPlaying);
}

// Show loading spinner on the play overlay center icon
function _setPlayOverlayLoading() {
    const center = document.querySelector(".set-play-center");
    if (center) center.classList.add("loading");
}

// Clear loading spinner (called when audio "playing" event fires)
function _clearPlayOverlayLoading() {
    const center = document.querySelector(".set-play-center");
    if (center) center.classList.remove("loading");
}

// Central dispatch: play slot respecting current mode
function playSlot(idx) {
    _isAdvancing = false;  // user-initiated play — reset auto-advance guard
    // Choose drawer: mobile always uses base drawer, desktop uses tab-based logic
    const isDanceTab = !document.getElementById("tab-dance")?.classList.contains("hidden");
    const useBaseDrawer = isDanceTab || _isMobileView();
    if (useBaseDrawer) {
        if (!baseDrawerOpen) {
            baseDrawerOpen = true;
            const drawer = document.getElementById("base-drawer");
            document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));
            drawer.classList.add("open");
            // Default to expanded detail view on mobile
            if (_isMobileView()) {
                drawer.classList.add("expanded");
                document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
            }
        }
    } else {
        // Desktop DJ mode: use side drawer
        if (!setDrawerOpen || setDrawerMode !== "now-playing") {
            openDrawer("now-playing", null);
        }
    }
    if (isPlaySetMode()) {
        playFullTrack(idx);
    } else {
        playSlotPreview(idx);
    }
}

async function playFullTrack(idx) {
    const gen = ++setPlayGen;

    if (idx < 0 || idx >= setSlots.length) return;

    // Pause current playback before switching source
    setAudio.pause();

    setPlaySetIndex = idx;
    const slot = setSlots[idx];
    const track = slot.tracks[slot.selectedTrackIndex];

    // Highlight column + EQ overlay + key cell
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, idx);
        // Delay scroll to let the wide-column CSS transition settle
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update play/pause button
    document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";

    // Set audio source to the backend streaming endpoint
    setAudio.src = `/api/audio/${track.id}`;
    setAudio.load();
    _previewStartTime = 0; // Full track mode — no preview window
    _setPlayOverlayLoading();
    setAudio.play().catch(err => {
        if (gen !== setPlayGen) return; // stale — another track was requested
        if (err.name === 'AbortError') return; // source changed, not a real error
        _clearPlayOverlayLoading();
        console.error("Playback failed:", err);

        // Autoplay blocked by browser — flag it so togglePlaySetPause resumes on click
        if (err.name === 'NotAllowedError') {
            console.warn("Autoplay blocked, waiting for user interaction");
            setAutoplayBlocked = true;
            _showAutoplayBlockedHint();
            return;
        }

        // BPM swap: try next track in same direction, or revert to original
        if (_bpmSwapContext) {
            _handleBpmSwapError();
            return;
        }

        // Other errors (404, format, network) — skip to next slot
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) {
            playFullTrack(next);
        }
    });

    // Update Now Playing drawer
    updateNowPlayingDrawer(track, idx);

    // Notify Dance tab of track change
    window.dispatchEvent(new CustomEvent("playset-track", { detail: { track, idx } }));
}

// Play a 30-second preview from the middle of the track using backend streaming
async function playSlotPreview(idx) {
    const gen = ++setPlayGen;

    if (idx < 0 || idx >= setSlots.length) return;

    setAudio.pause();

    setPlaySetIndex = idx;
    const slot = setSlots[idx];
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    // Highlight column + EQ overlay
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, idx);
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update play/pause button
    document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";

    // Load track and seek to middle once metadata is available
    _previewStartTime = 0;
    setAudio.src = `/api/audio/${track.id}`;
    setAudio.load();

    // Wait for duration to be known, then seek to middle
    const onLoaded = () => {
        setAudio.removeEventListener("loadedmetadata", onLoaded);
        if (gen !== setPlayGen) return; // stale
        const dur = setAudio.duration || 0;
        _previewStartTime = Math.max(0, dur / 2 - PREVIEW_DURATION / 2);
        setAudio.currentTime = _previewStartTime;
    };
    setAudio.addEventListener("loadedmetadata", onLoaded);

    _setPlayOverlayLoading();
    setAudio.play().catch(err => {
        if (gen !== setPlayGen) return;
        if (err.name === 'AbortError') return;
        _clearPlayOverlayLoading();
        console.error("Short Preview audio failed:", err);

        if (err.name === 'NotAllowedError') {
            setAutoplayBlocked = true;
            _showAutoplayBlockedHint();
            return;
        }

        // BPM swap: try next track in same direction, or revert to original
        if (_bpmSwapContext) {
            _handleBpmSwapError();
            return;
        }

        // Skip to next slot on error
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) playSlotPreview(next);
    });

    // Update Now Playing drawer
    updateNowPlayingDrawer(track, idx);

    // Notify Dance tab
    window.dispatchEvent(new CustomEvent("playset-track", { detail: { track, idx } }));
}

async function updateNowPlayingDrawer(track, slotIdx) {
    // Track info
    document.getElementById("now-playing-title").textContent = track.title || "";
    document.getElementById("now-playing-artist").textContent = track.artist || "";
    document.getElementById("now-playing-bpm").textContent = track.bpm ? Math.round(track.bpm) + " BPM" : "";
    document.getElementById("now-playing-key").textContent = track.key || "";
    document.getElementById("now-playing-year").textContent = track.year || "";

    // Counter
    const playable = setSlots.filter(s => {
        if (s.selectedTrackIndex == null) return false;
        const t = s.tracks[s.selectedTrackIndex];
        return t && t.has_audio;
    });
    const currentNum = playable.findIndex(s => setSlots.indexOf(s) === slotIdx) + 1;
    const counterText = `Track ${currentNum} of ${playable.length}`;
    document.getElementById("now-playing-counter").textContent = counterText;

    // Large artwork
    const artImg = document.getElementById("now-playing-artwork");
    artImg.src = "";
    loadNowPlayingArtwork(track.artist, track.title, artImg);

    // Also load artwork for base drawer
    const baseArtImg = document.getElementById("base-np-artwork");
    baseArtImg.src = "";
    loadNowPlayingArtwork(track.artist, track.title, baseArtImg);

    // Comment
    const commentEl = document.getElementById("now-playing-comment");
    commentEl.textContent = "";

    // Sync base drawer basic info
    document.getElementById("base-np-title").textContent = track.title || "";
    const bpmText = track.bpm ? Math.round(track.bpm) + " BPM" : "";
    const artistLine = [track.artist || "", bpmText, track.key || "", track.year || ""]
        .filter(Boolean).join(", ");
    document.getElementById("base-np-artist-line").textContent = artistLine;
    document.getElementById("base-np-counter").textContent = counterText;
    document.getElementById("base-np-comment").textContent = "";
    document.getElementById("base-np-collection").textContent = "";
    document.getElementById("base-np-collection-desc").textContent = "";
    document.getElementById("base-np-also-in").textContent = "";

    // Fetch collection tree context
    const collDiv = document.getElementById("now-playing-collection-leaf");
    const alsoInDiv = document.getElementById("now-playing-also-in");
    collDiv.innerHTML = "";
    alsoInDiv.innerHTML = "";
    try {
        const res = await fetch(`/api/set-workshop/track-context/${track.id}`);
        if (res.ok) {
            const data = await res.json();
            if (data.comment) {
                commentEl.textContent = data.comment;
                document.getElementById("base-np-comment").textContent = data.comment;
            }
            renderSearchCard("now-playing-collection-leaf", data.collection_leaf, "Collection", "tree_node", "collection");
            renderAlsoAppearsIn(alsoInDiv, data.also_in || []);
            // Base drawer: collection name + description
            if (data.collection_leaf && data.collection_leaf.name) {
                document.getElementById("base-np-collection").textContent = data.collection_leaf.name;
                document.getElementById("base-np-collection-desc").textContent =
                    data.collection_leaf.description || "";
            }
            if (data.also_in && data.also_in.length) {
                document.getElementById("base-np-also-in").textContent = "Also in " + data.also_in.length + " more";
            }
        }
    } catch (e) {
        console.error("Failed to load track context:", e);
    }

    // If the expanded base drawer is open (mobile detail view), sync it
    const baseDrawer = document.getElementById("base-drawer");
    if (baseDrawer && baseDrawer.classList.contains("expanded")) {
        syncBaseDrawerDetail();
    }

    // Update BPM arrow button states for current slot
    updateBpmArrowButtons();
}

function renderAlsoAppearsIn(container, leaves) {
    container.innerHTML = "";
    if (!leaves || leaves.length === 0) return;

    const header = document.createElement("div");
    header.className = "also-in-header";
    header.textContent = "Also appears in\u2026";
    container.appendChild(header);

    for (const leaf of leaves) {
        const link = document.createElement("a");
        link.className = "also-in-link";
        link.href = "#";
        link.textContent = `${leaf.title} (${leaf.track_count})`;
        link.addEventListener("click", (e) => {
            e.preventDefault();
            assignSource("tree_node", leaf.id, "collection", leaf.title);
        });
        container.appendChild(link);
    }
}

function loadNowPlayingArtwork(artist, title, imgEl) {
    fetch(`/api/artwork?artist=${encodeURIComponent(artist || "")}&title=${encodeURIComponent(title || "")}`)
        .then(r => r.json())
        .then(data => {
            const url = data.cover_big || data.cover_url || "";
            if (url) imgEl.src = url;
        })
        .catch(() => {});
}

// ── Autoplay blocked hint (pulsing play button) ──

function _showAutoplayBlockedHint() {
    const npBtn = document.getElementById("now-playing-play-pause");
    const baseBtn = document.getElementById("base-np-play-pause");
    npBtn.innerHTML = "&#9654;";
    baseBtn.innerHTML = "&#9654;";
    npBtn.classList.add("autoplay-blocked");
    baseBtn.classList.add("autoplay-blocked");
}

function _clearAutoplayBlockedHint() {
    // Removing the class lets the CSS transition on .now-playing-btn-main
    // smoothly animate width/height back to their default values
    document.getElementById("now-playing-play-pause").classList.remove("autoplay-blocked");
    document.getElementById("base-np-play-pause").classList.remove("autoplay-blocked");
}

function togglePlaySetPause() {
    if (!setAudio) return;

    // Autoplay was blocked — user click resumes playback
    if (setAutoplayBlocked) {
        setAutoplayBlocked = false;
        _clearAutoplayBlockedHint();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";
        setAudio.play().catch(() => {});
        return;
    }

    if (!setAudio.paused) {
        // Pause
        setAudio.pause();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9654;";
    } else if (setAudio.src && setAudio.currentTime > 0) {
        // Resume from current position
        setAudio.play().catch(() => {});
        document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";
    } else {
        // Nothing playing yet — start from current slot or slot 0
        const idx = findNextPlaySetSlot(setPlaySetIndex >= 0 ? setPlaySetIndex : 0);
        if (idx >= 0) playSlot(idx);
    }
}

function playSetPrev() {
    const prev = findPrevPlaySetSlot(setPlaySetIndex - 1);
    if (prev >= 0) playSlot(prev);
}

function playSetNext() {
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlot(next);
}

// ── BPM Up/Down: switch to higher/lower BPM track in current slot ──

function bpmSwapUp() {
    const slotIdx = setPlaySetIndex;
    const slot = setSlots[slotIdx];
    if (!slot) return;
    const cur = slot.selectedTrackIndex;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) {
            _bpmSwapContext = { direction: "up", origIndex: cur, slotIdx };
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(slotIdx);
            return;
        }
    }
}

function bpmSwapDown() {
    const slotIdx = setPlaySetIndex;
    const slot = setSlots[slotIdx];
    if (!slot) return;
    const cur = slot.selectedTrackIndex;
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) {
            _bpmSwapContext = { direction: "down", origIndex: cur, slotIdx };
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(slotIdx);
            return;
        }
    }
}

function _handleBpmSwapError() {
    const ctx = _bpmSwapContext;
    if (!ctx) return;

    const slot = setSlots[ctx.slotIdx];
    if (!slot) { _bpmSwapContext = null; return; }

    const cur = slot.selectedTrackIndex;
    const isUp = ctx.direction === "up";

    // Try next track in the same direction
    const start = isUp ? cur + 1 : cur - 1;
    const end = isUp ? slot.tracks.length : -1;
    const step = isUp ? 1 : -1;
    for (let i = start; i !== end; i += step) {
        if (slot.tracks[i]) {
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(ctx.slotIdx);
            return;  // keep _bpmSwapContext alive for the next attempt
        }
    }

    // No more tracks in that direction — revert to the original track
    slot.selectedTrackIndex = ctx.origIndex;
    _bpmSwapContext = null;
    renderSet();
    scheduleAutoSave();
    playSlot(ctx.slotIdx);
}

function updateBpmArrowButtons() {
    const upBtn = document.getElementById("base-np-bpm-up");
    const downBtn = document.getElementById("base-np-bpm-down");
    if (!upBtn || !downBtn) return;

    const slot = setSlots[setPlaySetIndex];
    if (!slot || slot.selectedTrackIndex == null) {
        upBtn.disabled = true;
        downBtn.disabled = true;
        return;
    }

    const cur = slot.selectedTrackIndex;
    let hasHigher = false, hasLower = false;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) { hasHigher = true; break; }
    }
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) { hasLower = true; break; }
    }
    upBtn.disabled = !hasHigher;
    downBtn.disabled = !hasLower;
}

function updatePlaySetProgress() {
    if (!setAudio || !setAudio.duration) return;

    // Short Preview mode: enforce 30s limit, then advance to next slot
    if (!isPlaySetMode() && _previewStartTime > 0) {
        const elapsed = setAudio.currentTime - _previewStartTime;
        if (elapsed >= PREVIEW_DURATION) {
            onPreviewEnded();
            return;
        }
        // Show progress relative to the 30s preview window
        const pct = (elapsed / PREVIEW_DURATION) * 100;
        document.getElementById("now-playing-progress-fill").style.width = pct + "%";
        document.getElementById("now-playing-current-time").textContent = formatPlaySetTime(elapsed);
        document.getElementById("now-playing-duration").textContent = formatPlaySetTime(PREVIEW_DURATION);
        document.getElementById("base-np-progress-fill").style.width = pct + "%";
        document.getElementById("base-np-current-time").textContent = formatPlaySetTime(elapsed);
        document.getElementById("base-np-duration").textContent = formatPlaySetTime(PREVIEW_DURATION);
        return;
    }

    const pct = (setAudio.currentTime / setAudio.duration) * 100;
    document.getElementById("now-playing-progress-fill").style.width = pct + "%";
    document.getElementById("now-playing-current-time").textContent = formatPlaySetTime(setAudio.currentTime);
    document.getElementById("now-playing-duration").textContent = formatPlaySetTime(setAudio.duration);
    // Sync base drawer progress
    document.getElementById("base-np-progress-fill").style.width = pct + "%";
    document.getElementById("base-np-current-time").textContent = formatPlaySetTime(setAudio.currentTime);
    document.getElementById("base-np-duration").textContent = formatPlaySetTime(setAudio.duration);
}

// Called when a Short Preview 30s window ends — advance to next slot (with wrap)
function onPreviewEnded() {
    if (_isAdvancing) return;  // already advancing — prevent cascade from repeated timeupdate
    _isAdvancing = true;
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlotPreview(next);
    else _isAdvancing = false;  // no next track — reset
}

function formatPlaySetTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// Called when setAudio "ended" fires (full track finished naturally)
function onPlaySetTrackEnded() {
    // In Full Track mode: advance to next slot (with wrap-around)
    if (isPlaySetMode()) {
        if (_isAdvancing) return;
        _isAdvancing = true;
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) {
            playFullTrack(next);
        } else {
            _isAdvancing = false;
        }
        return;
    }
    // In Short Preview mode: the timeupdate handler (onPreviewEnded) handles advance,
    // but if the track is shorter than the preview window, ended fires naturally
    onPreviewEnded();
}

function onPlaySetTrackError() {
    // If currentTime is 0, this is likely a stale error from an aborted load
    // (changing src aborts the previous fetch and fires an error event).
    // Genuine initial load failures are handled by play().catch() above.
    // Only auto-advance on mid-stream errors where audio was already playing.
    if (setAudio.currentTime === 0) return;
    console.warn("Playback: mid-stream audio error, skipping to next track");
    _isAdvancing = false;  // reset so the next advance can proceed
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlot(next);
}


// ═══════════════════════════════════════════════════════════════════════════
// Export M3U
// ═══════════════════════════════════════════════════════════════════════════

async function exportSet() {
    const slots = setSlots
        .filter(s => s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex])
        .map(s => ({ track_id: s.tracks[s.selectedTrackIndex].id }));

    if (slots.length === 0) {
        alert("No tracks selected in the set.");
        return;
    }

    const setName = currentSetName || `DJ_Set_${setSlots.length * 3}min`;

    try {
        const res = await fetch("/api/set-workshop/export-m3u", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slots,
                name: setName,
            }),
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const safeName = setName.replace(/\s+/g, "_");
            a.download = `${safeName}.m3u8`;
            a.click();
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        console.error("Export failed:", e);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Push to Set Workshop (called from other tabs)
// ═══════════════════════════════════════════════════════════════════════════

async function pushToSetWorkshop(trackIds, name, sourceType, sourceId, treeType) {
    if (!trackIds || trackIds.length === 0) {
        alert("No tracks to push.");
        return;
    }

    // Switch to Set Workshop tab
    if (typeof switchToTab === "function") {
        switchToTab("setbuilder");
    }

    await new Promise(r => setTimeout(r, 100));

    // Open drawer in detail mode — show loading status while fetching
    openDrawer("detail", null);
    if (typeof _showDrawerLoading === "function") {
        _showDrawerLoading(name || "Source");
    }

    await loadDrawerSourceDetail({
        type: sourceType || "adhoc",
        id: sourceId || null,
        tree_type: treeType || null,
    });

    showToast(`"${name || "Source"}" loaded \u2014 drag tracks to slots`);
}


// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function bpmToY(bpm) {
    // Map BPM to Y coordinate: 150 at top (SET_GRID_PAD), 60 at bottom
    return SET_GRID_PAD + SET_GRID_H * (1 - (bpm - SET_BPM_MIN) / (SET_BPM_MAX - SET_BPM_MIN));
}

function escHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showTooltip(e, track) {
    if (!setTooltipEl) return;
    setTooltipEl.innerHTML = `
        <div class="tt-title">${escHtml(track.title)}</div>
        <div class="tt-artist">${escHtml(track.artist)}</div>
        <div class="tt-meta">
            ${track.bpm ? `<span>${Math.round(track.bpm)} BPM</span>` : ""}
            ${track.key ? `<span>${escHtml(track.key)}</span>` : ""}
            ${track.year ? `<span>${track.year}</span>` : ""}
        </div>
    `;
    setTooltipEl.classList.add("visible");
    setTooltipEl.style.left = `${e.clientX + 12}px`;
    setTooltipEl.style.top = `${e.clientY + 12}px`;
}

function hideTooltip() {
    if (setTooltipEl) setTooltipEl.classList.remove("visible");
}

function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "set-push-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}


// ═══════════════════════════════════════════════════════════════════════════
// Track Search (drawer search mode)
// ═══════════════════════════════════════════════════════════════════════════

async function searchTracks(query) {
    try {
        const res = await fetch("/api/set-workshop/track-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
        });
        if (!res.ok) return;
        const data = await res.json();
        renderDrawerSearchResults(data.tracks);
        const selDiv = document.getElementById("set-drawer-selected-track");
        if (selDiv._searchCleanup) selDiv._searchCleanup();
        selDiv.classList.add("hidden");
        selDiv.innerHTML = "";
        document.getElementById("set-drawer-search-context").classList.add("hidden");
    } catch (e) {
        console.error("Track search failed:", e);
    }
}


function renderDrawerSearchResults(tracks) {
    const container = document.getElementById("set-drawer-search-results");
    container.innerHTML = "";

    if (!tracks || tracks.length === 0) {
        container.innerHTML = `<div class="set-drawer-empty">No tracks found</div>`;
        return;
    }

    for (const track of tracks) {
        const row = document.createElement("div");
        row.className = "set-drawer-track-row set-search-result-row";
        row.draggable = true;

        const safeArtist = escHtml(track.artist || "");
        const safeTitle = escHtml(track.title || "");

        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="false">
            <button class="btn-preview" data-artist="${safeArtist}" data-title="${safeTitle}" title="Preview">\u25B6</button>
            <div class="set-drawer-track-info">
                <span class="set-drawer-track-title">${safeTitle}</span>
                <span class="set-drawer-track-artist">${safeArtist}</span>
            </div>
            <div class="set-drawer-track-meta">
                ${track.bpm ? `<span>${Math.round(track.bpm)} BPM</span>` : ""}
                ${track.key ? `<span class="set-drawer-track-key">${escHtml(track.key)}</span>` : ""}
                ${track.year ? `<span>${track.year}</span>` : ""}
            </div>
        `;

        // Artwork
        const img = row.querySelector("img");
        if (typeof loadArtwork === "function") {
            loadArtwork(track.artist, track.title, img);
        }

        // Drag — entire row is draggable, use artwork as drag image
        row.addEventListener("dragstart", (e) => {
            setDragTrack = {
                id: track.id, artist: track.artist, title: track.title,
                bpm: track.bpm, key: track.key || "", year: track.year || "",
                source_type: "adhoc", source_id: null, track_ids: [track.id],
                from_search: true,
            };
            e.dataTransfer.setData("text/plain", String(track.id));
            e.dataTransfer.effectAllowed = "copy";
            // Use artwork thumbnail as the drag image
            if (img.complete && img.naturalWidth > 0) {
                e.dataTransfer.setDragImage(img, 18, 18);
            }
        });
        row.addEventListener("dragend", () => { setDragTrack = null; });

        // Preview
        row.querySelector(".btn-preview").addEventListener("click", (e) => {
            e.stopPropagation();
            if (typeof togglePreview === "function") {
                togglePreview(track.artist, track.title, e.currentTarget);
            }
        });

        // Click to select track: clear results, load context cards
        row.addEventListener("click", () => {
            document.getElementById("set-drawer-track-search").value = "";
            container.innerHTML = "";
            loadTrackContext(track);
        });

        container.appendChild(row);
    }
}


async function loadTrackContext(track) {
    const selectedDiv = document.getElementById("set-drawer-selected-track");
    const contextDiv = document.getElementById("set-drawer-search-context");

    // Clean up previous search playback
    if (selectedDiv._searchCleanup) selectedDiv._searchCleanup();

    // Show selected track immediately (drag source updated once collection leaf loads)
    selectedDiv.classList.remove("hidden");
    renderSelectedTrack(selectedDiv, track, null);

    // Scroll to top of the selected track (not the context cards)
    selectedDiv.scrollIntoView({ behavior: "smooth", block: "start" });

    contextDiv.classList.remove("hidden");

    // Loading state
    document.getElementById("set-search-card-collection").innerHTML =
        `<div class="set-search-card-loading">Loading\u2026</div>`;

    try {
        const res = await fetch(`/api/set-workshop/track-context/${track.id}`);
        if (!res.ok) {
            contextDiv.innerHTML = `<div class="set-drawer-empty">Failed to load context</div>`;
            return;
        }
        const data = await res.json();

        // Re-render selected track with collection leaf as drag source
        const collLeaf = data.collection_leaf && data.collection_leaf.available ? data.collection_leaf : null;
        renderSelectedTrack(selectedDiv, track, collLeaf);

        renderSearchCard("set-search-card-collection", data.collection_leaf, "Collection", "tree_node", "collection");
    } catch (e) {
        console.error("Track context failed:", e);
        contextDiv.innerHTML = `<div class="set-drawer-empty">Failed to load context</div>`;
    }
}


function renderSelectedTrack(container, track, collectionLeaf) {
    container.innerHTML = "";

    const safeArtist = escHtml(track.artist || "");
    const safeTitle = escHtml(track.title || "");

    // Hero layout matching Now Playing style
    const hero = document.createElement("div");
    hero.className = "selected-track-hero";
    hero.innerHTML = `
        <div class="now-playing-artwork-container">
            <img class="now-playing-artwork selected-track-art-big" alt="" draggable="true"
                 src="" style="cursor:grab;">
        </div>
        <div class="now-playing-track-info">
            <div class="now-playing-title">${safeTitle}</div>
            <div class="now-playing-artist">${safeArtist}</div>
            <div class="now-playing-meta">
                ${track.bpm ? `<span>${Math.round(track.bpm)} BPM</span>` : ""}
                ${track.key ? `<span>${escHtml(track.key)}</span>` : ""}
                ${track.year ? `<span>${track.year}</span>` : ""}
            </div>
        </div>
        <div class="selected-track-buttons">
            <button class="now-playing-btn selected-track-preview-btn" title="30s Preview">&#9654;</button>
            <button class="now-playing-btn now-playing-btn-main selected-track-play-btn" title="Play Full Track">&#9654;</button>
        </div>
        <div class="selected-track-progress hidden">
            <div class="now-playing-progress-bar">
                <div class="selected-track-progress-fill now-playing-progress-fill"></div>
            </div>
            <div class="now-playing-time">
                <span class="selected-track-current-time">0:00</span>
                <span class="selected-track-duration">0:00</span>
            </div>
        </div>
    `;

    // Big artwork (cover_big for higher res)
    const img = hero.querySelector(".selected-track-art-big");
    loadNowPlayingArtwork(track.artist, track.title, img);

    // Drag — source is the collection leaf (so slot gets filled from that leaf's track pool)
    img.addEventListener("dragstart", (e) => {
        setDragTrack = {
            id: track.id, artist: track.artist, title: track.title,
            bpm: track.bpm, key: track.key || "", year: track.year || "",
            source_type: collectionLeaf ? "tree_node" : "adhoc",
            source_id: collectionLeaf ? collectionLeaf.node_id : null,
            tree_type: collectionLeaf ? "collection" : "",
            track_ids: collectionLeaf ? [] : [track.id],
            name: collectionLeaf ? collectionLeaf.name : safeTitle,
        };
        e.dataTransfer.setData("text/plain", String(track.id));
        e.dataTransfer.effectAllowed = "copy";
    });
    img.addEventListener("dragend", () => { setDragTrack = null; });

    // 30s Preview button — uses backend streaming from middle
    const previewBtn = hero.querySelector(".selected-track-preview-btn");
    previewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Find the slot index for this track and play preview
        const si = setSlots.findIndex(s => {
            if (s.selectedTrackIndex == null) return false;
            const t = s.tracks[s.selectedTrackIndex];
            return t && t.id === track.id;
        });
        if (si >= 0 && track.has_audio) playSlotPreview(si);
    });

    // Full-track play button
    const playBtn = hero.querySelector(".selected-track-play-btn");
    const progressDiv = hero.querySelector(".selected-track-progress");
    const progressFill = hero.querySelector(".selected-track-progress-fill");
    const currentTimeEl = hero.querySelector(".selected-track-current-time");
    const durationEl = hero.querySelector(".selected-track-duration");

    playBtn.addEventListener("click", () => {
        // Stop any current set playback
        setAudio.pause();
        _previewStartTime = 0;

        if (!setAudio.paused && setAudio._searchTrackId === track.id) {
            // Pause current
            setAudio.pause();
            playBtn.innerHTML = "&#9654;";
        } else if (setAudio.paused && setAudio._searchTrackId === track.id && setAudio.currentTime > 0) {
            // Resume
            setAudio.play();
            playBtn.innerHTML = "&#9646;&#9646;";
        } else {
            // Play new track
            setAudio._searchTrackId = track.id;
            setAudio.src = `/api/audio/${track.id}`;
            setAudio.load();
            setAudio.play().catch(() => {
                playBtn.innerHTML = "&#9654;";
                progressDiv.classList.add("hidden");
            });
            playBtn.innerHTML = "&#9646;&#9646;";
            progressDiv.classList.remove("hidden");
        }
    });

    // Progress updates for search playback
    const onTimeUpdate = () => {
        if (setAudio._searchTrackId !== track.id) return;
        if (!setAudio.duration) return;
        const pct = (setAudio.currentTime / setAudio.duration) * 100;
        progressFill.style.width = pct + "%";
        currentTimeEl.textContent = formatPlaySetTime(setAudio.currentTime);
        durationEl.textContent = formatPlaySetTime(setAudio.duration);
    };
    const onEnded = () => {
        if (setAudio._searchTrackId !== track.id) return;
        playBtn.innerHTML = "&#9654;";
        progressFill.style.width = "0%";
        currentTimeEl.textContent = "0:00";
    };

    setAudio.addEventListener("timeupdate", onTimeUpdate);
    setAudio.addEventListener("ended", onEnded);
    setAudio.addEventListener("error", onEnded);

    // Store cleanup refs on container so re-render cleans up
    container._searchCleanup = () => {
        setAudio.removeEventListener("timeupdate", onTimeUpdate);
        setAudio.removeEventListener("ended", onEnded);
        setAudio.removeEventListener("error", onEnded);
        if (setAudio._searchTrackId === track.id && !setAudio.paused) {
            setAudio.pause();
            setAudio.src = "";
            setAudio._searchTrackId = null;
        }
    };

    container.appendChild(hero);
}


function renderSearchCard(containerId, cardData, cardTitle, sourceType, treeType) {
    const div = document.getElementById(containerId);

    if (!cardData) {
        div.innerHTML = `<div class="set-search-card-empty">Not available</div>`;
        return;
    }

    // Unavailable tree cards
    if (cardData.available === false) {
        div.innerHTML = `
            <div class="set-search-card-header">
                <div class="set-search-card-label">${escHtml(cardTitle)}</div>
            </div>
            <div class="set-search-card-empty">${escHtml(cardData.reason)}</div>
        `;
        return;
    }

    const name = cardData.name || cardTitle;
    const desc = cardData.description || "";
    const count = cardData.track_count || 0;
    const tracks = cardData.tracks || [];

    div.innerHTML = "";

    // Header
    const DESC_LIMIT = 350;
    const header = document.createElement("div");
    header.className = "set-search-card-header";

    let descHtml = "";
    if (desc) {
        if (desc.length > DESC_LIMIT) {
            const truncated = desc.slice(0, DESC_LIMIT).replace(/\s+\S*$/, "");
            descHtml = `<p class="set-search-card-desc">
                <span class="set-search-card-desc-short">${escHtml(truncated)}&hellip; <a href="#" class="set-search-card-toggle">Show More</a></span>
                <span class="set-search-card-desc-full hidden">${escHtml(desc)} <a href="#" class="set-search-card-toggle">Show Less</a></span>
            </p>`;
        } else {
            descHtml = `<p class="set-search-card-desc">${escHtml(desc)}</p>`;
        }
    }

    header.innerHTML = `
        <div class="set-search-card-label">${escHtml(cardTitle)}</div>
        <h4>${escHtml(name)}</h4>
        ${descHtml}
        <span class="set-search-card-count">${count} tracks</span>
    `;

    // Toggle show more/less
    header.querySelectorAll(".set-search-card-toggle").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const p = link.closest(".set-search-card-desc");
            p.querySelector(".set-search-card-desc-short").classList.toggle("hidden");
            p.querySelector(".set-search-card-desc-full").classList.toggle("hidden");
        });
    });

    div.appendChild(header);

    if (tracks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "set-search-card-empty";
        empty.textContent = "No tracks";
        div.appendChild(empty);
        return;
    }

    // Track list
    const list = document.createElement("div");
    list.className = "set-search-card-tracks";

    for (const track of tracks) {
        const row = document.createElement("div");
        row.className = "set-drawer-track-row";

        const safeArtist = escHtml(track.artist || "");
        const safeTitle = escHtml(track.title || "");

        row.draggable = true;
        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="false">
            <button class="btn-preview" data-artist="${safeArtist}" data-title="${safeTitle}" title="Preview">\u25B6</button>
            <div class="set-drawer-track-info">
                <span class="set-drawer-track-title">${safeTitle}</span>
                <span class="set-drawer-track-artist">${safeArtist}</span>
            </div>
            <div class="set-drawer-track-meta">
                ${track.bpm ? `<span>${Math.round(track.bpm)} BPM</span>` : ""}
                ${track.key ? `<span class="set-drawer-track-key">${escHtml(track.key)}</span>` : ""}
            </div>
        `;

        // Artwork
        const img = row.querySelector("img");
        if (typeof loadArtwork === "function") {
            loadArtwork(track.artist, track.title, img);
        }

        // Drag — entire row is draggable, use artwork as drag image
        const dragInfo = sourceType === "tree_node" && cardData.node_id
            ? { type: "tree_node", id: cardData.node_id, tree_type: treeType }
            : { type: "adhoc", id: null, track_ids: tracks.map(t => t.id) };

        row.addEventListener("dragstart", (e) => {
            setDragTrack = {
                id: track.id, artist: track.artist, title: track.title,
                bpm: track.bpm, key: track.key || "", year: track.year || "",
                source_type: dragInfo.type, source_id: dragInfo.id,
                tree_type: dragInfo.tree_type || "",
                track_ids: dragInfo.track_ids || [], name: name,
            };
            e.dataTransfer.setData("text/plain", String(track.id));
            e.dataTransfer.effectAllowed = "copy";
            if (img.complete && img.naturalWidth > 0) {
                e.dataTransfer.setDragImage(img, 18, 18);
            }
        });
        row.addEventListener("dragend", () => { setDragTrack = null; });

        // Preview
        row.querySelector(".btn-preview").addEventListener("click", (e) => {
            e.stopPropagation();
            if (typeof togglePreview === "function") {
                togglePreview(track.artist, track.title, e.currentTarget);
            }
        });

        list.appendChild(row);
    }

    div.appendChild(list);
}
