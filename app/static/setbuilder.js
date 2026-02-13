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

// ── Drag State ──
let setDragTrack = null;          // track being dragged from drawer

// ── Preview All State (30-sec Deezer previews) ──
let setPlayAllActive = false;
let setPlayAllIndex = 0;
let _setPlayAllOnEnded = null;  // current ended listener (for cleanup)

// ── Play Set State (full-track local playback) ──
let setPlaySetActive = false;
let setPlaySetIndex = 0;
let setAudio = null;   // separate Audio element for full-track playback

// ── Saved Set State ──
let currentSetId = null;        // ID of the loaded saved set, or null
let currentSetName = null;      // Name of the loaded saved set
let setDirty = false;           // True if workshop changed since last save/load
let setsInitialized = false;    // Lazy init for the Sets tab

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

// ── Layout Constants ──
const SET_IMG = 48;
const SET_PAD = 4;
const SET_COL_W = SET_IMG + SET_PAD * 2;  // 56
const SET_GAP = 6;
const SET_GRID_H = 432;
const SET_GRID_PAD = 30;
const SET_AREA_H = SET_GRID_H + SET_GRID_PAD * 2;  // 492
const SET_BPM_MIN = 60;
const SET_BPM_MAX = 150;
const SET_BPM_LEVELS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

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
    document.getElementById("set-preview-all-btn").addEventListener("click", togglePreviewAll);
    document.getElementById("set-play-set-btn").addEventListener("click", togglePlaySet);
    document.getElementById("set-export-btn").addEventListener("click", exportSet);

    // Play Set: dedicated Audio element (separate from previewAudio)
    setAudio = new Audio();
    setAudio.volume = 0.7;
    setAudio.addEventListener("timeupdate", updatePlaySetProgress);
    setAudio.addEventListener("ended", onPlaySetTrackEnded);
    setAudio.addEventListener("error", onPlaySetTrackError);

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
            if (setPlaySetActive) stopPlaySet();
            else if (setDrawerOpen) closeDrawer();
            else if (setPlayAllActive) stopSetPreviewAll();
        }
    });

    // Load saved state or init empty grid
    await loadSavedSetState();
}


function initEmptySlots(count) {
    if (!count) count = SET_DEFAULT_SLOTS;
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
 * Called after every mutation (assign, delete, duplicate, drag, load).
 */
function ensureBookendSlots() {
    // Ensure first slot is clear
    if (setSlots.length === 0 || setSlots[0].source !== null) {
        setSlots.unshift(_makeEmptySlot());
    }
    // Ensure last slot is clear
    if (setSlots.length === 0 || setSlots[setSlots.length - 1].source !== null) {
        setSlots.push(_makeEmptySlot());
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
            setSlots = data.slots;
            currentSetId = data.set_id || null;
            currentSetName = data.set_name || null;
            setDirty = false;
            ensureBookendSlots();
            renderSet();
            updateSaveButtons();
            refreshHasAudioFlags();
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
            body: JSON.stringify({ slots: setSlots, name: currentSetName }),
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
            body: JSON.stringify({ name: name.trim(), slots: setSlots }),
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
    try {
        const res = await fetch(`/api/saved-sets/${setId}`);
        if (!res.ok) { alert("Failed to load set."); return; }
        const data = await res.json();
        setSlots = data.slots || [];
        currentSetId = data.id;
        currentSetName = data.name;
        setDirty = false;
        ensureBookendSlots();
        renderSet();
        updateSaveButtons();
        refreshHasAudioFlags();
        saveSetState(); // persist to working state immediately
        if (typeof switchToTab === "function") switchToTab("setbuilder");
        showToast(`Loaded "${currentSetName}"`);
    } catch (e) {
        console.error("Failed to load set:", e);
        alert("Failed to load set.");
    }
}

function startNewSet() {
    if (setDirty) {
        if (!confirm("You have unsaved changes. Start a new set?")) return;
    }
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

function renderSetsGrid(sets) {
    const grid = document.getElementById("sets-grid");
    if (!grid) return;
    const emptyMsg = grid.querySelector(".sets-empty");

    // Remove old cards
    grid.querySelectorAll(".set-card").forEach(el => el.remove());

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

        card.innerHTML = `
            <div class="set-card-name">${escHtml(s.name)}</div>
            <div class="set-card-meta">
                <span>${s.track_count} tracks</span>
                <span>${durStr}</span>
                <span>${dateStr}</span>
            </div>
            <div class="set-card-actions">
                <button class="btn btn-sm btn-secondary set-card-load">Load</button>
                <button class="btn btn-sm btn-danger set-card-delete" title="Delete">&times;</button>
            </div>
        `;

        card.querySelector(".set-card-load").addEventListener("click", (e) => {
            e.stopPropagation();
            loadSavedSet(s.id);
        });
        card.querySelector(".set-card-delete").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteSavedSet(s.id, s.name);
        });
        card.addEventListener("click", () => loadSavedSet(s.id));

        grid.appendChild(card);
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


async function refreshHasAudioFlags() {
    // Collect all unique track IDs across all slots
    const trackIds = new Set();
    for (const slot of setSlots) {
        for (const t of (slot.tracks || [])) {
            if (t && t.id != null) trackIds.add(t.id);
        }
    }
    if (trackIds.size === 0) return;

    try {
        const res = await fetch("/api/set-workshop/check-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_ids: [...trackIds] }),
        });
        if (!res.ok) return;
        const audioMap = await res.json();

        // Patch all tracks in all slots
        for (const slot of setSlots) {
            for (const t of (slot.tracks || [])) {
                if (t && t.id != null) {
                    t.has_audio = !!audioMap[String(t.id)];
                }
            }
        }
        updateToolbarState();
    } catch (e) {
        console.error("Failed to refresh has_audio flags:", e);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

function renderSet() {
    renderSlotHeaders();
    renderKeyRow();
    renderBpmGrid();
    renderEnergyWave();
    renderTrackColumns();
    renderPreviewRow();
    renderTimeRow();
    updateToolbarState();
}


function updateToolbarState() {
    const hasSelection = setSlots.some(s => s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex]);
    const hasAudioTracks = setSlots.some(s => {
        if (s.selectedTrackIndex == null) return false;
        const t = s.tracks[s.selectedTrackIndex];
        return t && t.has_audio;
    });
    document.getElementById("set-preview-all-btn").disabled = !hasSelection;
    document.getElementById("set-play-set-btn").disabled = !hasAudioTracks;
    document.getElementById("set-export-btn").disabled = !hasSelection;
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

// ── Slot Headers ──

function renderSlotHeaders() {
    const row = document.getElementById("set-slot-headers");
    row.innerHTML = "";

    const groups = buildSourceGroups();

    for (const group of groups) {
        if (group.count === 1) {
            // Single slot — render as before
            const slot = setSlots[group.startIdx];
            const header = document.createElement("div");
            header.className = "set-slot-header";
            header.dataset.slotId = slot.id;

            if (!slot.source) {
                header.innerHTML = `<button class="set-add-source-btn" title="Assign source">+</button>`;
                header.querySelector(".set-add-source-btn").addEventListener("click", () => {
                    openDrawer("browse", slot.id);
                });
            } else {
                const safeName = escHtml(slot.source.name || "Source");
                header.innerHTML = `
                    <div class="set-source-name" title="${safeName}">${safeName}</div>
                    <div class="set-slot-controls">
                        <button class="set-ctrl-btn" data-action="duplicate" title="Duplicate">&#10697;</button>
                        <button class="set-ctrl-btn" data-action="delete" title="Delete">&#10005;</button>
                    </div>
                `;
                header.querySelector(".set-source-name").addEventListener("click", () => {
                    openDrawer("detail", slot.id);
                });
                header.querySelectorAll(".set-ctrl-btn").forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        handleSlotControl(slot.id, btn.dataset.action);
                    });
                });
            }

            // Drag to reorder + accept track drops
            header.draggable = true;
            header.addEventListener("dragstart", (e) => onSlotDragStart(e, slot.id));
            header.addEventListener("dragover", (e) => {
                onSlotDragOver(e);
                if (setDragTrack) header.classList.add("drag-over");
            });
            header.addEventListener("dragleave", () => header.classList.remove("drag-over"));
            header.addEventListener("drop", (e) => { header.classList.remove("drag-over"); onSlotDrop(e, slot.id); });
            header.addEventListener("dragend", () => { dragSlotId = null; dragGroupSlotIds = null; });

            row.appendChild(header);
        } else {
            // Grouped slots — single spanning header
            const groupW = group.count * (SET_COL_W + SET_GAP) - SET_GAP;
            const header = document.createElement("div");
            header.className = "set-slot-header set-source-group";
            header.style.width = `${groupW}px`;
            header.dataset.slotIds = JSON.stringify(group.slotIds);
            header.dataset.slotId = group.slotIds[0]; // primary for drop target

            const safeName = escHtml(group.source.name || "Source");
            let controlsHtml = `<div class="set-group-slot-row">`;
            for (let si = 0; si < group.count; si++) {
                const slotId = group.slotIds[si];
                controlsHtml += `
                    <div class="set-slot-controls" style="width:${SET_COL_W}px" data-slot-id="${slotId}">
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="duplicate" title="Duplicate">&#10697;</button>
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="delete" title="Delete">&#10005;</button>
                    </div>`;
            }
            controlsHtml += `</div>`;

            header.innerHTML = `
                <div class="set-source-name set-group-label" title="${safeName}">${safeName}</div>
                ${controlsHtml}
            `;

            header.querySelector(".set-group-label").addEventListener("click", () => {
                openDrawer("detail", group.slotIds[0]);
            });
            header.querySelectorAll(".set-ctrl-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    handleSlotControl(btn.dataset.slotId, btn.dataset.action);
                });
            });

            // Drag entire group
            header.draggable = true;
            header.addEventListener("dragstart", (e) => onGroupDragStart(e, group.slotIds));
            header.addEventListener("dragover", (e) => {
                onSlotDragOver(e);
                if (setDragTrack) header.classList.add("drag-over");
            });
            header.addEventListener("dragleave", () => header.classList.remove("drag-over"));
            header.addEventListener("drop", (e) => { header.classList.remove("drag-over"); onSlotDrop(e, group.slotIds[0]); });
            header.addEventListener("dragend", () => { dragSlotId = null; dragGroupSlotIds = null; });

            row.appendChild(header);
        }
    }
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
}


// ── BPM Grid ──

function renderBpmGrid() {
    const grid = document.getElementById("set-bpm-grid");
    // Remove old gridlines
    grid.querySelectorAll(".set-bpm-gridline").forEach(el => el.remove());

    const slotW = SET_COL_W + SET_GAP;
    const totalW = setSlots.length * slotW;
    grid.style.width = `${totalW}px`;

    // Draw gridlines at each BPM level
    for (const bpm of SET_BPM_LEVELS) {
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

    const pathD = catmullRomPath(points);
    const fillD = pathD
        + ` L ${points[points.length - 1].x} ${SET_AREA_H}`
        + ` L ${points[0].x} ${SET_AREA_H} Z`;

    svg.innerHTML = `
        <path class="set-energy-fill" d="${fillD}" />
        <path class="set-energy-line" d="${pathD}" />
    `;
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
            // Render tracks at their BPM Y positions
            slot.tracks.forEach((track, ti) => {
                if (!track) return;

                const isSelected = ti === slot.selectedTrackIndex;
                const el = document.createElement("div");
                el.className = `set-track-slot${isSelected ? " selected" : ""}`;
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

                // Position at BPM
                const bpm = track.bpm_level || track.bpm || 100;
                el.style.top = `${bpmToY(bpm) - SET_IMG / 2}px`;

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
}


// ── Preview Row ──

function renderPreviewRow() {
    const row = document.getElementById("set-preview-row");
    row.innerHTML = "";

    setSlots.forEach((slot) => {
        const cell = document.createElement("div");
        cell.className = "set-preview-cell";

        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const track = slot.tracks[slot.selectedTrackIndex];
            const btn = document.createElement("button");
            btn.className = "btn-preview";
            btn.title = "Play 30s preview";
            btn.textContent = "\u25B6";
            btn.dataset.artist = track.artist || "";
            btn.dataset.title = track.title || "";
            btn.addEventListener("click", () => {
                if (typeof togglePreview === "function") {
                    togglePreview(track.artist, track.title, btn);
                }
            });
            cell.appendChild(btn);
        }

        row.appendChild(cell);
    });
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

    if (!wasSelected) {
        slot.selectedTrackIndex = trackIdx;
        renderSet();
        scheduleAutoSave();
    }

    // Always play/toggle preview on click
    const track = slot.tracks[trackIdx];
    if (typeof togglePreview === "function") {
        const si = setSlots.indexOf(slot);
        const btn = getSlotPreviewBtn(si);
        if (btn) togglePreview(track.artist, track.title, btn);
    }

    // If preview-all active, redirect to this slot
    if (setPlayAllActive && !wasSelected) {
        const si = setSlots.indexOf(slot);
        previewTrackAt(si);
    }
    // If play-set active, redirect to this slot
    if (setPlaySetActive && !wasSelected) {
        const si = setSlots.indexOf(slot);
        if (track && track.has_audio) {
            playFullTrack(si);
        }
    }
}

function getSlotPreviewBtn(slotIdx) {
    const row = document.getElementById("set-preview-row");
    if (row && row.children[slotIdx]) {
        return row.children[slotIdx].querySelector(".btn-preview");
    }
    return null;
}


// ═══════════════════════════════════════════════════════════════════════════
// Slot Controls
// ═══════════════════════════════════════════════════════════════════════════

function handleSlotControl(slotId, action) {
    const idx = setSlots.findIndex(s => s.id === slotId);
    if (idx === -1) return;

    switch (action) {
        case "duplicate": {
            const orig = setSlots[idx];
            const copy = {
                id: `slot-${Date.now()}`,
                source: orig.source ? { ...orig.source } : null,
                tracks: orig.tracks.map(t => t ? { ...t } : null),
                selectedTrackIndex: orig.selectedTrackIndex,
            };
            setSlots.splice(idx + 1, 0, copy);
            ensureBookendSlots();
            renderSet();
            scheduleAutoSave();
            break;
        }
        case "delete": {
            if (setSlots.length <= 1) return;
            setSlots.splice(idx, 1);
            ensureBookendSlots();
            renderSet();
            scheduleAutoSave();
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

    const [moved] = setSlots.splice(fromIdx, 1);
    setSlots.splice(toIdx, 0, moved);
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
    } else if (mode === "now-playing") {
        document.getElementById("set-drawer-now-playing").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Now Playing";
    }

    // After layout shift, keep the target slot visible
    if (targetSlotId) {
        setTimeout(() => {
            const header = document.querySelector(`.set-slot-header[data-slot-id="${targetSlotId}"]`);
            if (header) header.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
        }, 320);  // wait for the 0.3s CSS transition
    }
}

function closeDrawer() {
    // If now-playing mode, stop playback
    if (setDrawerMode === "now-playing" && setPlaySetActive) {
        stopPlaySet();
        return; // stopPlaySet will close the drawer
    }
    setDrawerOpen = false;
    setDrawerTargetSlotId = null;
    setDrawerMode = null;
    document.getElementById("set-drawer").classList.remove("open");

    // Restore full content width
    const tab = document.getElementById("tab-setbuilder");
    if (tab) tab.classList.remove("drawer-open");
}


// ── Browse Mode ──

async function loadDrawerSources(searchTerm) {
    try {
        const res = await fetch(`/api/set-workshop/sources?search=${encodeURIComponent(searchTerm || "")}`);
        const data = await res.json();
        renderDrawerPlaylists(data.playlists);
        renderDrawerTreeSection("set-drawer-scene-tree", "Scene Explorer", data.scene_tree, "scene");
        renderDrawerTreeSection("set-drawer-genre-tree", "Genre Tree", data.genre_tree, "genre");
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

function renderDrawerTreeSection(containerId, title, treeData, treeType) {
    const div = document.getElementById(containerId);
    div.innerHTML = `<h4>${escHtml(title)}</h4>`;
    if (!treeData || !treeData.available || !treeData.lineages || treeData.lineages.length === 0) {
        div.innerHTML += `<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.5rem;">Not available</div>`;
        return;
    }
    for (const lineage of treeData.lineages) {
        renderDrawerTreeNode(div, lineage, treeType, 0);
    }
}

function renderDrawerTreeNode(parentEl, node, treeType, depth) {
    const hasChildren = node.children && node.children.length > 0;

    const row = document.createElement("div");
    row.className = "set-drawer-tree-node";
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    row.innerHTML = `
        <span class="set-drawer-tree-toggle">${hasChildren ? "\u25B6" : "\u00B7"}</span>
        <span class="set-drawer-tree-title">${escHtml(node.title)}</span>
        <span class="set-drawer-tree-count">${node.track_count}</span>
    `;

    let childContainer = null;
    if (hasChildren) {
        childContainer = document.createElement("div");
        childContainer.className = "set-drawer-tree-children collapsed";
        for (const child of node.children) {
            renderDrawerTreeNode(childContainer, child, treeType, depth + 1);
        }
    }

    const toggle = row.querySelector(".set-drawer-tree-toggle");

    // Click on title → assign source
    row.querySelector(".set-drawer-tree-title").addEventListener("click", (e) => {
        e.stopPropagation();
        assignSource("tree_node", node.id, treeType, node.title);
    });

    // Click on toggle → expand/collapse
    if (hasChildren) {
        toggle.style.cursor = "pointer";
        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const collapsed = childContainer.classList.toggle("collapsed");
            toggle.textContent = collapsed ? "\u25B6" : "\u25BC";
        });
    }

    parentEl.appendChild(row);
    if (childContainer) parentEl.appendChild(childContainer);
}


// ── Detail Mode ──

async function loadDrawerSourceDetail(source) {
    try {
        const qs = `source_type=${source.type}&source_id=${encodeURIComponent(source.id)}&tree_type=${source.tree_type || ""}`;
        const res = await fetch(`/api/set-workshop/source-detail?${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        renderDrawerDetail(data, source);
    } catch (e) {
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

        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="true">
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

        // Make artwork draggable
        img.addEventListener("dragstart", (e) => {
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
        });
        img.addEventListener("dragend", () => { setDragTrack = null; });

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

    try {
        const res = await fetch("/api/set-workshop/drag-track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                track_id: drag.id,
                source_type: drag.source_type,
                source_id: drag.source_id,
                tree_type: drag.tree_type || "",
                used_track_ids: usedIds,
            }),
        });

        if (!res.ok) {
            console.error("Drag track failed:", res.status, await res.text());
            return;
        }
        const data = await res.json();

        slot.source = {
            type: drag.source_type,
            id: drag.source_id,
            tree_type: drag.tree_type,
            name: data.source ? data.source.name : "",
        };
        slot.tracks = data.tracks || [];

        // Select the dragged track
        const dragIdx = slot.tracks.findIndex(t => t && t.id === drag.id);
        slot.selectedTrackIndex = dragIdx >= 0 ? dragIdx : findDefaultSelection(slot.tracks);

        ensureBookendSlots();
        renderSet();
        scheduleAutoSave();
    } catch (e2) {
        console.error("Drag track failed:", e2);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Preview All (30-sec Deezer previews)
// ═══════════════════════════════════════════════════════════════════════════

function togglePreviewAll() {
    if (setPlayAllActive) {
        stopSetPreviewAll();
    } else {
        previewAllSet();
    }
}

function previewAllSet() {
    // Stop Play Set if active
    if (setPlaySetActive) stopPlaySet();

    setPlayAllActive = true;
    setPlayAllIndex = 0;
    document.getElementById("set-preview-all-btn").textContent = "Stop Preview";

    // Find first slot with a selected track
    const first = findNextPreviewableSlot(0);
    if (first >= 0) {
        previewTrackAt(first);
    } else {
        stopSetPreviewAll();
    }
}

function findNextPreviewableSlot(fromIdx) {
    for (let i = fromIdx; i < setSlots.length; i++) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            return i;
        }
    }
    return -1;
}

async function previewTrackAt(idx) {
    if (!setPlayAllActive || idx >= setSlots.length) {
        stopSetPreviewAll();
        return;
    }

    setPlayAllIndex = idx;

    // Skip empty slots
    const slot = setSlots[idx];
    if (!slot || slot.selectedTrackIndex == null || !slot.tracks[slot.selectedTrackIndex]) {
        const next = findNextPreviewableSlot(idx + 1);
        if (next >= 0) previewTrackAt(next);
        else stopSetPreviewAll();
        return;
    }

    // Highlight column
    document.querySelectorAll(".set-column.play-all-active").forEach(el => el.classList.remove("play-all-active"));
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-all-active");
        col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    const track = slot.tracks[slot.selectedTrackIndex];
    const btn = getSlotPreviewBtn(idx);

    // Clean up previous ended listener, then attach a new one
    if (typeof previewAudio !== "undefined" && previewAudio) {
        if (_setPlayAllOnEnded) {
            previewAudio.removeEventListener("ended", _setPlayAllOnEnded);
            previewAudio.removeEventListener("error", _setPlayAllOnEnded);
        }
        const onEnded = () => {
            previewAudio.removeEventListener("ended", onEnded);
            previewAudio.removeEventListener("error", onEnded);
            _setPlayAllOnEnded = null;
            if (setPlayAllActive) {
                const next = findNextPreviewableSlot(idx + 1);
                if (next >= 0) previewTrackAt(next);
                else stopSetPreviewAll();
            }
        };
        _setPlayAllOnEnded = onEnded;
        previewAudio.addEventListener("ended", onEnded);
        previewAudio.addEventListener("error", onEnded);
    }

    // Play
    if (typeof togglePreview === "function" && btn) {
        togglePreview(track.artist, track.title, btn);
    } else {
        // No preview available, skip after short delay
        setTimeout(() => {
            if (setPlayAllActive) {
                const next = findNextPreviewableSlot(idx + 1);
                if (next >= 0) previewTrackAt(next);
                else stopSetPreviewAll();
            }
        }, 500);
    }
}

function stopSetPreviewAll() {
    setPlayAllActive = false;
    document.getElementById("set-preview-all-btn").textContent = "Preview All";
    document.querySelectorAll(".set-column.play-all-active").forEach(el => el.classList.remove("play-all-active"));

    // Clean up ended listener
    if (typeof previewAudio !== "undefined" && previewAudio && _setPlayAllOnEnded) {
        previewAudio.removeEventListener("ended", _setPlayAllOnEnded);
        previewAudio.removeEventListener("error", _setPlayAllOnEnded);
        _setPlayAllOnEnded = null;
    }

    // Stop audio
    if (typeof previewAudio !== "undefined" && previewAudio && !previewAudio.paused) {
        previewAudio.pause();
        previewAudio.currentTime = 0;
    }

    // Reset any playing preview buttons
    if (typeof resetAllPreviewButtons === "function") {
        resetAllPreviewButtons();
    }
    document.querySelectorAll(".btn-preview.playing").forEach(btn => {
        btn.textContent = "\u25B6";
        btn.classList.remove("playing");
    });
}


// ═══════════════════════════════════════════════════════════════════════════
// Play Set (full-track local playback)
// ═══════════════════════════════════════════════════════════════════════════

function togglePlaySet() {
    if (setPlaySetActive) {
        stopPlaySet();
    } else {
        startPlaySet();
    }
}

function startPlaySet() {
    // Stop preview if playing
    if (setPlayAllActive) stopSetPreviewAll();
    if (typeof previewAudio !== "undefined" && !previewAudio.paused) {
        previewAudio.pause();
        previewAudio.currentTime = 0;
    }
    if (typeof resetAllPreviewButtons === "function") resetAllPreviewButtons();

    setPlaySetActive = true;
    setPlaySetIndex = 0;
    document.getElementById("set-play-set-btn").textContent = "Stop Set";

    // Open drawer in now-playing mode
    openDrawer("now-playing", null);

    // Find first playable slot (has audio file)
    const first = findNextPlaySetSlot(0);
    console.log("Play Set: first playable slot =", first,
        "| slots with has_audio:", setSlots.filter(s =>
            s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex]?.has_audio
        ).length);
    if (first >= 0) {
        playFullTrack(first);
    } else {
        console.warn("Play Set: no tracks with has_audio found");
        stopPlaySet();
    }
}

function stopPlaySet() {
    setPlaySetActive = false;
    if (setAudio) {
        setAudio.pause();
        setAudio.currentTime = 0;
        setAudio.src = "";
    }
    document.getElementById("set-play-set-btn").textContent = "Play Set";
    removeAllEqOverlays();
    document.querySelectorAll(".set-column.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );

    // Reset progress display
    document.getElementById("now-playing-progress-fill").style.width = "0%";
    document.getElementById("now-playing-current-time").textContent = "0:00";
    document.getElementById("now-playing-duration").textContent = "0:00";
    document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";

    // Close drawer if in now-playing mode
    if (setDrawerMode === "now-playing") {
        setDrawerOpen = false;
        setDrawerTargetSlotId = null;
        setDrawerMode = null;
        document.getElementById("set-drawer").classList.remove("open");
        const tab = document.getElementById("tab-setbuilder");
        if (tab) tab.classList.remove("drawer-open");
    }
}

function findNextPlaySetSlot(fromIdx) {
    for (let i = fromIdx; i < setSlots.length; i++) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null) {
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track && track.has_audio) return i;
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

function createEqOverlay(col) {
    removeEqOverlay(col);
    const overlay = document.createElement("div");
    overlay.className = "set-eq-overlay";
    for (let i = 0; i < EQ_BAR_COUNT; i++) {
        const bar = document.createElement("div");
        bar.className = "set-eq-bar";
        bar.style.setProperty("--eq-speed", EQ_SPEEDS[i] + "s");
        bar.style.setProperty("--eq-delay", EQ_DELAYS[i] + "s");
        overlay.appendChild(bar);
    }
    col.appendChild(overlay);
}

function removeEqOverlay(col) {
    const existing = col.querySelector(".set-eq-overlay");
    if (existing) existing.remove();
}

function removeAllEqOverlays() {
    document.querySelectorAll(".set-eq-overlay").forEach(el => el.remove());
}

async function playFullTrack(idx) {
    if (!setPlaySetActive || idx < 0 || idx >= setSlots.length) {
        stopPlaySet();
        return;
    }

    setPlaySetIndex = idx;
    const slot = setSlots[idx];
    const track = slot.tracks[slot.selectedTrackIndex];

    // Highlight column + EQ overlay + key cell
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        createEqOverlay(col);
        col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update play/pause button
    document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";

    // Set audio source to the backend streaming endpoint
    setAudio.src = `/api/audio/${track.id}`;
    setAudio.load();
    setAudio.play().catch(err => {
        console.error("Play Set audio failed:", err);
        onPlaySetTrackError();
    });

    // Update Now Playing drawer
    updateNowPlayingDrawer(track, idx);
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
    document.getElementById("now-playing-counter").textContent =
        `Track ${currentNum} of ${playable.length}`;

    // Large artwork
    const artImg = document.getElementById("now-playing-artwork");
    artImg.src = "";
    loadNowPlayingArtwork(track.artist, track.title, artImg);

    // Fetch tree context (genre leaf + scene leaf)
    const genreDiv = document.getElementById("now-playing-genre-leaf");
    const sceneDiv = document.getElementById("now-playing-scene-leaf");
    genreDiv.innerHTML = "";
    sceneDiv.innerHTML = "";
    try {
        const res = await fetch(`/api/set-workshop/track-context/${track.id}`);
        if (res.ok) {
            const data = await res.json();
            renderSearchCard("now-playing-scene-leaf", data.scene_leaf, "Scene Tree", "tree_node", "scene");
            renderSearchCard("now-playing-genre-leaf", data.genre_leaf, "Genre Tree", "tree_node", "genre");
        }
    } catch (e) {
        console.error("Failed to load track context:", e);
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

function togglePlaySetPause() {
    if (!setAudio) return;
    if (setAudio.paused) {
        setAudio.play();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
    } else {
        setAudio.pause();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
    }
}

function playSetPrev() {
    if (!setPlaySetActive) return;
    const prev = findPrevPlaySetSlot(setPlaySetIndex - 1);
    if (prev >= 0) playFullTrack(prev);
}

function playSetNext() {
    if (!setPlaySetActive) return;
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) {
        playFullTrack(next);
    } else {
        stopPlaySet();
    }
}

function updatePlaySetProgress() {
    if (!setAudio || !setAudio.duration) return;
    const pct = (setAudio.currentTime / setAudio.duration) * 100;
    document.getElementById("now-playing-progress-fill").style.width = pct + "%";
    document.getElementById("now-playing-current-time").textContent = formatPlaySetTime(setAudio.currentTime);
    document.getElementById("now-playing-duration").textContent = formatPlaySetTime(setAudio.duration);
}

function formatPlaySetTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function onPlaySetTrackEnded() {
    if (!setPlaySetActive) return;
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) {
        playFullTrack(next);
    } else {
        stopPlaySet();
    }
}

function onPlaySetTrackError() {
    if (!setPlaySetActive) return;
    console.warn("Play Set: audio error, skipping to next track");
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) {
        setTimeout(() => playFullTrack(next), 500);
    } else {
        stopPlaySet();
    }
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

    const totalMinutes = setSlots.length * 3;

    try {
        const res = await fetch("/api/set-workshop/export-m3u", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slots,
                name: `DJ_Set_${totalMinutes}min`,
            }),
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `DJ_Set_${totalMinutes}min.m3u8`;
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

    // Open drawer in detail mode — user drags tracks to slots
    openDrawer("detail", null);
    loadDrawerSourceDetail({
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
    document.getElementById("tab-setbuilder").appendChild(toast);
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
        renderSearchResults(data.tracks);
        const selDiv = document.getElementById("set-drawer-selected-track");
        if (selDiv._searchCleanup) selDiv._searchCleanup();
        selDiv.classList.add("hidden");
        selDiv.innerHTML = "";
        document.getElementById("set-drawer-search-context").classList.add("hidden");
    } catch (e) {
        console.error("Track search failed:", e);
    }
}


function renderSearchResults(tracks) {
    const container = document.getElementById("set-drawer-search-results");
    container.innerHTML = "";

    if (!tracks || tracks.length === 0) {
        container.innerHTML = `<div class="set-drawer-empty">No tracks found</div>`;
        return;
    }

    for (const track of tracks) {
        const row = document.createElement("div");
        row.className = "set-drawer-track-row set-search-result-row";

        const safeArtist = escHtml(track.artist || "");
        const safeTitle = escHtml(track.title || "");

        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="true">
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

        // Drag
        img.addEventListener("dragstart", (e) => {
            setDragTrack = {
                id: track.id, artist: track.artist, title: track.title,
                bpm: track.bpm, key: track.key || "", year: track.year || "",
                source_type: "adhoc", source_id: null, track_ids: [track.id],
            };
            e.dataTransfer.setData("text/plain", String(track.id));
            e.dataTransfer.effectAllowed = "copy";
        });
        img.addEventListener("dragend", () => { setDragTrack = null; });

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

    // Show selected track immediately (drag source updated once genre leaf loads)
    selectedDiv.classList.remove("hidden");
    renderSelectedTrack(selectedDiv, track, null);

    // Scroll to top of the selected track (not the context cards)
    selectedDiv.scrollIntoView({ behavior: "smooth", block: "start" });

    contextDiv.classList.remove("hidden");

    // Loading state
    ["set-search-card-genre", "set-search-card-scene"].forEach(id => {
        document.getElementById(id).innerHTML = `<div class="set-search-card-loading">Loading\u2026</div>`;
    });

    try {
        const res = await fetch(`/api/set-workshop/track-context/${track.id}`);
        if (!res.ok) {
            contextDiv.innerHTML = `<div class="set-drawer-empty">Failed to load context</div>`;
            return;
        }
        const data = await res.json();

        // Re-render selected track with genre leaf as drag source
        const genreLeaf = data.genre_leaf && data.genre_leaf.available ? data.genre_leaf : null;
        renderSelectedTrack(selectedDiv, track, genreLeaf);

        renderSearchCard("set-search-card-scene", data.scene_leaf, "Scene Tree", "tree_node", "scene");
        renderSearchCard("set-search-card-genre", data.genre_leaf, "Genre Tree", "tree_node", "genre");
    } catch (e) {
        console.error("Track context failed:", e);
        contextDiv.innerHTML = `<div class="set-drawer-empty">Failed to load context</div>`;
    }
}


function renderSelectedTrack(container, track, genreLeaf) {
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

    // Drag — source is the genre leaf (so slot gets filled from that leaf's track pool)
    img.addEventListener("dragstart", (e) => {
        setDragTrack = {
            id: track.id, artist: track.artist, title: track.title,
            bpm: track.bpm, key: track.key || "", year: track.year || "",
            source_type: genreLeaf ? "tree_node" : "adhoc",
            source_id: genreLeaf ? genreLeaf.node_id : null,
            tree_type: genreLeaf ? "genre" : "",
            track_ids: genreLeaf ? [] : [track.id],
            name: genreLeaf ? genreLeaf.name : safeTitle,
        };
        e.dataTransfer.setData("text/plain", String(track.id));
        e.dataTransfer.effectAllowed = "copy";
    });
    img.addEventListener("dragend", () => { setDragTrack = null; });

    // 30s Preview button
    const previewBtn = hero.querySelector(".selected-track-preview-btn");
    previewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof togglePreview === "function") {
            togglePreview(track.artist, track.title, previewBtn);
        }
    });

    // Full-track play button
    const playBtn = hero.querySelector(".selected-track-play-btn");
    const progressDiv = hero.querySelector(".selected-track-progress");
    const progressFill = hero.querySelector(".selected-track-progress-fill");
    const currentTimeEl = hero.querySelector(".selected-track-current-time");
    const durationEl = hero.querySelector(".selected-track-duration");

    playBtn.addEventListener("click", () => {
        // Stop Play Set if active
        if (setPlaySetActive) stopPlaySet();
        // Stop Deezer preview if playing
        if (typeof previewAudio !== "undefined" && !previewAudio.paused) {
            previewAudio.pause();
            previewAudio.currentTime = 0;
        }
        if (typeof resetAllPreviewButtons === "function") resetAllPreviewButtons();

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

        row.innerHTML = `
            <img class="set-drawer-track-art" alt="" draggable="true">
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

        // Drag — tree leaf cards use tree_node source, similar uses adhoc
        const dragInfo = sourceType === "tree_node" && cardData.node_id
            ? { type: "tree_node", id: cardData.node_id, tree_type: treeType }
            : { type: "adhoc", id: null, track_ids: tracks.map(t => t.id) };

        img.addEventListener("dragstart", (e) => {
            setDragTrack = {
                id: track.id, artist: track.artist, title: track.title,
                bpm: track.bpm, key: track.key || "", year: track.year || "",
                source_type: dragInfo.type, source_id: dragInfo.id,
                tree_type: dragInfo.tree_type || "",
                track_ids: dragInfo.track_ids || [], name: name,
            };
            e.dataTransfer.setData("text/plain", String(track.id));
            e.dataTransfer.effectAllowed = "copy";
        });
        img.addEventListener("dragend", () => { setDragTrack = null; });

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
