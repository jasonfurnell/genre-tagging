/* ── Set Workshop — User-Built DJ Sets ───────────────────────────────────── */

let setInitialized = false;

// ── Slot State ──
// Each slot: {id, source: {type, id, tree_type, name}|null, tracks: [], selectedTrackIndex: null}
let setSlots = [];
let setHours = 1;   // 1, 2, or 3 hours

// ── Drawer State ──
let setDrawerOpen = false;
let setDrawerMode = null;         // "browse" | "detail" | "suggest" | "search"
let setDrawerTargetSlotId = null; // which slot the drawer is acting on

// ── Drag State ──
let setDragTrack = null;          // track being dragged from drawer

// ── Play All State ──
let setPlayAllActive = false;
let setPlayAllIndex = 0;
let _setPlayAllOnEnded = null;  // current ended listener (for cleanup)

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
const SET_GRID_H = 300;
const SET_GRID_PAD = 125;
const SET_AREA_H = SET_GRID_H + SET_GRID_PAD * 2;  // 550
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
    document.getElementById("set-play-all-btn").addEventListener("click", togglePlayAll);
    document.getElementById("set-export-btn").addEventListener("click", exportSet);

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
            if (setDrawerOpen) closeDrawer();
            else if (setPlayAllActive) stopSetPlayAll();
        }
    });

    // Set length selector
    document.querySelectorAll(".set-length-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const hours = parseInt(btn.dataset.hours);
            if (hours === setHours) return;
            setHours = hours;
            document.querySelectorAll(".set-length-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            initEmptySlots(hours * 20);
            renderSet();
            scheduleAutoSave();
        });
    });

    // Load saved state or init empty grid
    await loadSavedSetState();
}


function initEmptySlots(count) {
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


// ═══════════════════════════════════════════════════════════════════════════
// State Persistence
// ═══════════════════════════════════════════════════════════════════════════

function scheduleAutoSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveSetState, 1000);
}

async function saveSetState() {
    try {
        await fetch("/api/set-workshop/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hours: setHours, slots: setSlots }),
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
            setHours = data.hours || 1;
            setSlots = data.slots;

            // Update hour selector UI
            document.querySelectorAll(".set-length-btn").forEach(b => {
                b.classList.toggle("active", parseInt(b.dataset.hours) === setHours);
            });

            renderSet();
            return;
        }
    } catch (e) {
        console.error("Failed to load set state:", e);
    }

    // Fallback: init empty
    initEmptySlots(setHours * 20);
    renderSet();
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
    document.getElementById("set-play-all-btn").disabled = !hasSelection;
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
                        <button class="set-ctrl-btn" data-action="move" title="Drag to reorder">&#8661;</button>
                        <button class="set-ctrl-btn" data-action="duplicate" title="Duplicate right">&#10697;</button>
                        <button class="set-ctrl-btn" data-action="suggest" title="Suggest similar">&#9733;</button>
                        <button class="set-ctrl-btn" data-action="delete" title="Delete slot">&#10005;</button>
                        <button class="set-ctrl-btn" data-action="clear" title="Clear source">&#8634;</button>
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
            let controlsHtml = `<div class="set-group-controls">`;
            for (let si = 0; si < group.count; si++) {
                const slotId = group.slotIds[si];
                controlsHtml += `
                    <div class="set-group-slot-controls" style="width:${SET_COL_W}px">
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="duplicate" title="Duplicate">&#10697;</button>
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="suggest" title="Suggest">&#9733;</button>
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="delete" title="Delete">&#10005;</button>
                        <button class="set-ctrl-btn" data-slot-id="${slotId}" data-action="clear" title="Clear">&#8634;</button>
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
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const key = slot.tracks[slot.selectedTrackIndex].key || "";
            cell.textContent = key;
            const color = camelotColor(key);
            if (color) {
                cell.style.color = color;
                cell.style.backgroundColor = color + "18";
                cell.style.borderColor = color + "40";
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

    // If play-all active, redirect to this slot
    if (setPlayAllActive && !wasSelected) {
        const si = setSlots.indexOf(slot);
        playSetTrackAt(si);
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
            renderSet();
            break;
        }
        case "delete": {
            if (setSlots.length <= 1) return;
            setSlots.splice(idx, 1);
            renderSet();
            break;
        }
        case "clear": {
            setSlots[idx].source = null;
            setSlots[idx].tracks = [];
            setSlots[idx].selectedTrackIndex = null;
            renderSet();
            break;
        }
        case "suggest": {
            openDrawer("suggest", slotId);
            break;
        }
        // "move" handled by drag-and-drop
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
    renderSet();
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
    } else if (mode === "suggest") {
        document.getElementById("set-drawer-suggest").classList.remove("hidden");
        document.getElementById("set-drawer-title").textContent = "Suggestions";
        const slot = setSlots.find(s => s.id === targetSlotId);
        if (slot && slot.source) {
            loadDrawerSuggestions(slot.source);
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
    setDrawerOpen = false;
    setDrawerTargetSlotId = null;
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
        renderDrawerTreeSection("set-drawer-genre-tree", "Genre Tree", data.genre_tree, "genre");
        renderDrawerTreeSection("set-drawer-scene-tree", "Scene Explorer", data.scene_tree, "scene");
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


// ── Suggest Mode ──

async function loadDrawerSuggestions(source) {
    try {
        const res = await fetch("/api/set-workshop/suggest-sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                source_type: source.type,
                source_id: source.id,
                tree_type: source.tree_type || "",
            }),
        });
        if (!res.ok) return;
        const data = await res.json();

        renderSuggestionList("set-drawer-suggest-similar", "Similar", data.similar);
        renderSuggestionList("set-drawer-suggest-up", "Energy Up", data.energy_up);
        renderSuggestionList("set-drawer-suggest-down", "Energy Down", data.energy_down);
    } catch (e) {
        console.error("Failed to load suggestions:", e);
    }
}

function renderSuggestionList(containerId, title, items) {
    const div = document.getElementById(containerId);
    div.innerHTML = `<h4>${escHtml(title)}</h4>`;

    if (!items || items.length === 0) {
        div.innerHTML += `<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.5rem;">None found</div>`;
        return;
    }

    for (const item of items) {
        const el = document.createElement("div");
        el.className = "set-drawer-source-item";
        el.innerHTML = `
            <span class="set-drawer-source-name">${escHtml(item.name)}</span>
            <span class="set-drawer-source-rel">${escHtml(item.relationship || "")}</span>
            <span class="set-drawer-source-count">${item.track_count} tracks</span>
        `;
        el.addEventListener("click", () => {
            assignSource(item.type || "tree_node", item.id, item.tree_type, item.name);
        });
        div.appendChild(el);
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
        renderSet();
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

        renderSet();
        scheduleAutoSave();
    } catch (e2) {
        console.error("Drag track failed:", e2);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// Play All
// ═══════════════════════════════════════════════════════════════════════════

function togglePlayAll() {
    if (setPlayAllActive) {
        stopSetPlayAll();
    } else {
        playAllSet();
    }
}

function playAllSet() {
    setPlayAllActive = true;
    setPlayAllIndex = 0;
    document.getElementById("set-play-all-btn").textContent = "Stop";

    // Find first slot with a selected track
    const first = findNextPlayableSlot(0);
    if (first >= 0) {
        playSetTrackAt(first);
    } else {
        stopSetPlayAll();
    }
}

function findNextPlayableSlot(fromIdx) {
    for (let i = fromIdx; i < setSlots.length; i++) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            return i;
        }
    }
    return -1;
}

async function playSetTrackAt(idx) {
    if (!setPlayAllActive || idx >= setSlots.length) {
        stopSetPlayAll();
        return;
    }

    setPlayAllIndex = idx;

    // Skip empty slots
    const slot = setSlots[idx];
    if (!slot || slot.selectedTrackIndex == null || !slot.tracks[slot.selectedTrackIndex]) {
        const next = findNextPlayableSlot(idx + 1);
        if (next >= 0) playSetTrackAt(next);
        else stopSetPlayAll();
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
                const next = findNextPlayableSlot(idx + 1);
                if (next >= 0) playSetTrackAt(next);
                else stopSetPlayAll();
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
                const next = findNextPlayableSlot(idx + 1);
                if (next >= 0) playSetTrackAt(next);
                else stopSetPlayAll();
            }
        }, 500);
    }
}

function stopSetPlayAll() {
    setPlayAllActive = false;
    document.getElementById("set-play-all-btn").textContent = "Play All";
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
        document.getElementById("set-drawer-selected-track").classList.add("hidden");
        document.getElementById("set-drawer-selected-track").innerHTML = "";
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

    // Show selected track immediately (drag source updated once genre leaf loads)
    selectedDiv.classList.remove("hidden");
    renderSelectedTrack(selectedDiv, track, null);

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

        renderSearchCard("set-search-card-genre", data.genre_leaf, "Genre Tree Leaf", "tree_node", "genre");
        renderSearchCard("set-search-card-scene", data.scene_leaf, "Scene Tree Leaf", "tree_node", "scene");

        contextDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
        console.error("Track context failed:", e);
        contextDiv.innerHTML = `<div class="set-drawer-empty">Failed to load context</div>`;
    }
}


function renderSelectedTrack(container, track, genreLeaf) {
    container.innerHTML = "";

    const safeArtist = escHtml(track.artist || "");
    const safeTitle = escHtml(track.title || "");

    const row = document.createElement("div");
    row.className = "set-drawer-track-row set-selected-track-row";
    row.innerHTML = `
        <img class="set-selected-track-art" alt="" draggable="true">
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

    // Preview
    row.querySelector(".btn-preview").addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof togglePreview === "function") {
            togglePreview(track.artist, track.title, e.currentTarget);
        }
    });

    container.appendChild(row);
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
            <div class="set-search-card-header"><h4>${escHtml(cardTitle)}</h4></div>
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
    const header = document.createElement("div");
    header.className = "set-search-card-header";
    header.innerHTML = `
        <h4>${escHtml(name)}</h4>
        ${desc ? `<p class="set-search-card-desc">${escHtml(desc)}</p>` : ""}
        <span class="set-search-card-count">${count} tracks</span>
    `;
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
