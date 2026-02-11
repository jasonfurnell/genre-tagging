/* ── Set Workshop — Frontend ─────────────────────────────────────────────── */

let setInitialized = false;
let setData = null;            // Full set from /generate
let setVibeOptions = [];       // Tree nodes for dropdowns
let setSlotSelections = [];    // Per-slot selected index (0–4)

const setSettings = {
    duration: 60,
    energyPreset: "classic_arc",
    keyPreset: "harmonic_flow",
    startKey: "8B",
    treeType: "genre",
    vibePreset: "journey",
    bpmMin: 70,
    bpmMax: 140,
};

// Layout constants
const SET_IMG = 48;
const SET_PAD = 4;             // padding each side of image in column
const SET_COL_W = SET_IMG + SET_PAD * 2;  // 56
const SET_GAP = 6;
const SET_STACK_GAP = 2;
const SET_GRID_H = 300;        // BPM grid height (px)
const SET_GRID_PAD = 125;      // padding above/below grid for stack overflow
const SET_AREA_H = SET_GRID_H + SET_GRID_PAD * 2;  // total area height
const SET_BPM_MIN = 60;
const SET_BPM_MAX = 140;

// Tooltip element (created once)
let setTooltipEl = null;

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

async function initSetBuilder() {
    if (setInitialized) return;
    setInitialized = true;

    // Toolbar buttons
    document.getElementById("set-generate-btn").addEventListener("click", generateSet);
    document.getElementById("set-settings-btn").addEventListener("click", toggleSettings);
    document.getElementById("set-play-all-btn").addEventListener("click", playAllSet);
    document.getElementById("set-export-btn").addEventListener("click", exportSet);

    // Duration toggle
    document.querySelectorAll(".set-dur-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".set-dur-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            setSettings.duration = parseInt(btn.dataset.dur);
        });
    });

    // Settings panel
    document.getElementById("set-settings-close").addEventListener("click", toggleSettings);
    document.getElementById("set-settings-apply").addEventListener("click", applySettings);

    // Settings inputs → sync to setSettings
    document.getElementById("set-energy-preset").addEventListener("change", e => {
        setSettings.energyPreset = e.target.value;
        previewEnergyWave();
    });
    document.getElementById("set-key-preset").addEventListener("change", e => {
        setSettings.keyPreset = e.target.value;
    });
    document.getElementById("set-start-key").addEventListener("change", e => {
        setSettings.startKey = e.target.value;
    });
    document.getElementById("set-tree-type").addEventListener("change", async e => {
        setSettings.treeType = e.target.value;
        await loadPresets();
    });
    const vibePresetEl = document.getElementById("set-vibe-preset");
    if (vibePresetEl) {
        vibePresetEl.addEventListener("change", e => {
            setSettings.vibePreset = e.target.value;
        });
    }

    // Populate start key dropdown (1A–12B)
    populateKeyDropdown();

    // Create tooltip element
    setTooltipEl = document.createElement("div");
    setTooltipEl.className = "set-track-tooltip";
    document.body.appendChild(setTooltipEl);

    // Load presets & vibe options
    await loadPresets();

    // Preview initial energy wave in settings
    previewEnergyWave();
}

// ═══════════════════════════════════════════════════════════════════════════
// Presets & vibe options
// ═══════════════════════════════════════════════════════════════════════════

async function loadPresets() {
    try {
        const res = await fetch(`/api/set-workshop/presets?tree_type=${setSettings.treeType}`);
        const data = await res.json();
        setVibeOptions = data.vibe_options || [];
        if (!data.tree_available) {
            const ph = document.getElementById("set-placeholder");
            if (ph) {
                ph.querySelector(".ws-placeholder").textContent =
                    "No Collection Tree found. Build one in the Collection Tree tab first.";
            }
        }
    } catch (e) {
        console.error("Failed to load set presets:", e);
    }
}

function populateKeyDropdown() {
    const sel = document.getElementById("set-start-key");
    sel.innerHTML = "";
    for (let n = 1; n <= 12; n++) {
        for (const l of ["A", "B"]) {
            const opt = document.createElement("option");
            opt.value = `${n}${l}`;
            opt.textContent = `${n}${l}`;
            if (`${n}${l}` === setSettings.startKey) opt.selected = true;
            sel.appendChild(opt);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Generate Set
// ═══════════════════════════════════════════════════════════════════════════

async function generateSet() {
    const btn = document.getElementById("set-generate-btn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    try {
        const vibes = collectVibeAssignments();

        const res = await fetch("/api/set-workshop/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                duration: setSettings.duration,
                energy_preset: setSettings.energyPreset,
                key_preset: setSettings.keyPreset,
                start_key: setSettings.startKey,
                tree_type: setSettings.treeType,
                vibe_preset: setSettings.vibePreset,
                vibes: vibes.length ? vibes : undefined,
                bpm_min: setSettings.bpmMin,
                bpm_max: setSettings.bpmMax,
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.error || "Generation failed");
            return;
        }

        setData = await res.json();
        setSlotSelections = setData.slots.map(s => s.selected_index || 2);

        // Enable toolbar buttons
        document.getElementById("set-play-all-btn").disabled = false;
        document.getElementById("set-export-btn").disabled = false;

        renderSet();
    } catch (e) {
        console.error("Set generation failed:", e);
        alert("Generation failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Generate Set";
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Collect current vibe assignments from dropdowns (if grid is rendered)
// ═══════════════════════════════════════════════════════════════════════════

function collectVibeAssignments() {
    if (!setData) return [];
    const vibes = [];
    document.querySelectorAll(".set-vibe-dropdown").forEach(dd => {
        vibes.push({
            row: parseInt(dd.dataset.vibeRow),
            col_start: parseInt(dd.dataset.colStart),
            col_end: parseInt(dd.dataset.colEnd),
            node_id: dd.value || null,
            title: dd.selectedOptions[0]?.textContent || "",
        });
    });
    return vibes;
}

// ═══════════════════════════════════════════════════════════════════════════
// Render Set
// ═══════════════════════════════════════════════════════════════════════════

function renderSet() {
    if (!setData) return;

    document.getElementById("set-placeholder").classList.add("hidden");
    document.getElementById("set-grid-wrapper").classList.remove("hidden");

    renderVibeRows();
    renderKeyRow();
    renderBpmGrid();
    renderEnergyWave();
    renderTrackColumns();
    renderPreviewRow();
    renderTimeRow();
}

// ── Vibe Rows ────────────────────────────────────────────────────────────

function renderVibeRows() {
    const row1 = document.getElementById("set-vibe-row-1");
    const row2 = document.getElementById("set-vibe-row-2");
    row1.innerHTML = "";
    row2.innerHTML = "";

    const slotW = SET_COL_W + SET_GAP;
    const vibes = setData.vibes || [];

    for (const v of vibes) {
        const cell = document.createElement("div");
        cell.className = "set-vibe-cell";
        const left = v.col_start * slotW;
        const width = (v.col_end - v.col_start + 1) * slotW - SET_GAP;
        cell.style.left = `${left}px`;
        cell.style.width = `${width}px`;

        const dd = document.createElement("select");
        dd.className = "set-vibe-dropdown";
        dd.dataset.vibeRow = v.row;
        dd.dataset.colStart = v.col_start;
        dd.dataset.colEnd = v.col_end;

        // Empty option
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "— select vibe —";
        dd.appendChild(emptyOpt);

        // Populate from vibe options
        for (const opt of setVibeOptions) {
            const o = document.createElement("option");
            o.value = opt.id;
            const indent = "  ".repeat(opt.depth);
            o.textContent = `${indent}${opt.title} (${opt.track_count})`;
            if (opt.id === v.node_id) o.selected = true;
            dd.appendChild(o);
        }

        dd.addEventListener("change", () => onVibeChange(dd));
        cell.appendChild(dd);

        if (v.row === 0) row1.appendChild(cell);
        else row2.appendChild(cell);
    }

    // Set min-width for rows
    const numSlots = setData.slots.length;
    const totalW = numSlots * slotW;
    row1.style.minWidth = `${totalW}px`;
    row2.style.minWidth = `${totalW}px`;
    row1.style.position = "relative";
    row2.style.position = "relative";
}

// ── Key Row ──────────────────────────────────────────────────────────────

function renderKeyRow() {
    const row = document.getElementById("set-key-row");
    row.innerHTML = "";
    for (const slot of setData.slots) {
        const cell = document.createElement("div");
        cell.className = "set-key-cell";
        cell.textContent = slot.target_key;
        row.appendChild(cell);
    }
}

// ── BPM Grid (gridlines) ────────────────────────────────────────────────

function renderBpmGrid() {
    const grid = document.getElementById("set-bpm-grid");
    // Remove old gridlines
    grid.querySelectorAll(".set-bpm-gridline").forEach(el => el.remove());

    // Add gridlines at 60, 80, 100, 120, 140
    for (let bpm = SET_BPM_MIN; bpm <= SET_BPM_MAX; bpm += 20) {
        const line = document.createElement("div");
        line.className = "set-bpm-gridline";
        line.style.top = `${bpmToY(bpm)}px`;
        grid.appendChild(line);
    }

    // Set grid width
    const numSlots = setData.slots.length;
    const totalW = numSlots * (SET_COL_W + SET_GAP);
    grid.style.width = `${totalW}px`;
}

// ── Energy Wave SVG ─────────────────────────────────────────────────────

function renderEnergyWave() {
    const svg = document.getElementById("set-energy-svg");
    const wave = setData.energy_wave;
    const n = wave.length;
    const slotW = SET_COL_W + SET_GAP;

    const points = wave.map((bpm, i) => {
        const x = i * slotW + SET_COL_W / 2;
        const y = bpmToY(bpm);
        return { x, y };
    });

    const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const fillD = lineD +
        ` L ${points[n - 1].x} ${SET_AREA_H} L ${points[0].x} ${SET_AREA_H} Z`;

    const totalW = n * slotW;
    svg.setAttribute("viewBox", `0 0 ${totalW} ${SET_AREA_H}`);
    svg.style.width = `${totalW}px`;
    svg.style.height = `${SET_AREA_H}px`;
    svg.innerHTML = `
        <path class="set-energy-fill" d="${fillD}" />
        <path class="set-energy-line" d="${lineD}" />
    `;
}

// ── Track Columns ───────────────────────────────────────────────────────

function renderTrackColumns() {
    const container = document.getElementById("set-columns");
    container.innerHTML = "";

    setData.slots.forEach((slot, si) => {
        const col = document.createElement("div");
        col.className = "set-column";
        col.dataset.slotIndex = si;

        const stack = document.createElement("div");
        stack.className = "set-slot-stack";
        stack.dataset.slotIndex = si;

        // Position vertically: selected track center at target BPM Y
        const centerY = bpmToY(slot.target_bpm);
        const selectedIdx = setSlotSelections[si] || 0;
        const imgH = SET_IMG + SET_STACK_GAP;
        const stackTop = centerY - (selectedIdx * imgH) - SET_IMG / 2;
        stack.style.top = `${stackTop}px`;

        if (slot.tracks.length === 0) {
            // Empty slot
            const empty = document.createElement("div");
            empty.className = "set-track-slot empty";
            stack.appendChild(empty);
        } else {
            slot.tracks.forEach((track, ti) => {
                const el = document.createElement("div");
                el.className = `set-track-slot${ti === selectedIdx ? " selected" : ""}`;
                el.dataset.trackIdx = ti;
                el.dataset.slotIdx = si;

                // Text fallback label (always visible, image overlays when loaded)
                const label = document.createElement("div");
                label.className = "set-track-label";
                label.textContent = (track.artist || "").split(/[,&]/)[0].trim().slice(0, 8);
                el.appendChild(label);

                const img = document.createElement("img");
                img.alt = "";
                img.draggable = false;
                img.style.display = "none";  // hidden until artwork loads
                img.onload = () => { img.style.display = ""; };
                img.onerror = () => { img.style.display = "none"; };
                el.appendChild(img);

                if (typeof loadArtwork === "function") {
                    loadArtwork(track.artist, track.title, img);
                }

                // Click to select + preview
                el.addEventListener("click", (e) => {
                    e.stopPropagation();
                    onTrackClick(si, ti);
                });

                // Hover tooltip
                el.addEventListener("mouseenter", (e) => showTooltip(e, track, slot));
                el.addEventListener("mouseleave", hideTooltip);

                stack.appendChild(el);
            });
        }

        // Mouse wheel to cycle selection
        stack.addEventListener("wheel", (e) => {
            e.preventDefault();
            const dir = e.deltaY > 0 ? 1 : -1;
            const current = setSlotSelections[si] || 0;
            const maxIdx = Math.max((slot.tracks.length || 1) - 1, 0);
            const next = Math.max(0, Math.min(maxIdx, current + dir));
            if (next !== current) selectTrack(si, next);
        }, { passive: false });

        col.appendChild(stack);
        container.appendChild(col);
    });
}

// ── Preview Row ─────────────────────────────────────────────────────────

function renderPreviewRow() {
    const row = document.getElementById("set-preview-row");
    row.innerHTML = "";

    setData.slots.forEach((slot, si) => {
        const cell = document.createElement("div");
        cell.className = "set-preview-cell";

        if (slot.tracks.length > 0) {
            const btn = document.createElement("button");
            btn.className = "btn-preview";
            btn.textContent = "\u25B6";
            btn.title = "Preview selected track";

            btn.addEventListener("click", () => {
                const ti = setSlotSelections[si] || 0;
                const track = slot.tracks[ti];
                if (track && typeof togglePreview === "function") {
                    togglePreview(track.artist, track.title, btn);
                }
            });

            cell.appendChild(btn);
        }

        row.appendChild(cell);
    });
}

// ── Time Row ────────────────────────────────────────────────────────────

function renderTimeRow() {
    const row = document.getElementById("set-time-row");
    row.innerHTML = "";
    for (const slot of setData.slots) {
        const cell = document.createElement("div");
        cell.className = "set-time-cell";
        cell.textContent = slot.time_label;
        row.appendChild(cell);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Slot Machine: Select Track
// ═══════════════════════════════════════════════════════════════════════════

function selectTrack(slotIdx, trackIdx) {
    const slot = setData.slots[slotIdx];
    if (!slot || trackIdx < 0 || trackIdx >= slot.tracks.length) return;

    setSlotSelections[slotIdx] = trackIdx;

    // Update DOM: selection highlighting
    const stack = document.querySelector(`.set-slot-stack[data-slot-index="${slotIdx}"]`);
    if (!stack) return;

    stack.querySelectorAll(".set-track-slot").forEach((el, i) => {
        el.classList.toggle("selected", i === trackIdx);
    });

    // Reposition stack so selected track aligns with BPM Y
    const centerY = bpmToY(slot.target_bpm);
    const imgH = SET_IMG + SET_STACK_GAP;
    const stackTop = centerY - (trackIdx * imgH) - SET_IMG / 2;
    stack.style.transition = "top 0.3s ease";
    stack.style.top = `${stackTop}px`;
    setTimeout(() => { stack.style.transition = ""; }, 350);
}

// ═══════════════════════════════════════════════════════════════════════════
// Track Click: Select + Preview
// ═══════════════════════════════════════════════════════════════════════════

function onTrackClick(slotIdx, trackIdx) {
    const slot = setData.slots[slotIdx];
    if (!slot || trackIdx < 0 || trackIdx >= slot.tracks.length) return;

    const wasSelected = setSlotSelections[slotIdx] === trackIdx;
    const track = slot.tracks[trackIdx];
    if (!track || typeof togglePreview !== "function") return;

    // Select if not already selected
    if (!wasSelected) {
        selectTrack(slotIdx, trackIdx);
    }

    if (setPlayAllActive && !wasSelected) {
        // During play-all + clicked a non-selected track:
        // redirect the play-all sequence to continue from this slot
        playSetTrackAt(slotIdx);
    } else {
        // Normal click: preview the track (toggle play/pause)
        const previewBtn = getSlotPreviewBtn(slotIdx);
        if (previewBtn) {
            togglePreview(track.artist, track.title, previewBtn);
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
// Vibe Dropdown Change → Re-fetch tracks
// ═══════════════════════════════════════════════════════════════════════════

async function onVibeChange(dropdown) {
    if (!setData) return;

    const colStart = parseInt(dropdown.dataset.colStart);
    const colEnd = parseInt(dropdown.dataset.colEnd);

    // Update vibe assignment in setData
    for (const v of setData.vibes) {
        if (v.col_start === colStart && v.col_end === colEnd && v.row === parseInt(dropdown.dataset.vibeRow)) {
            v.node_id = dropdown.value || null;
            v.title = dropdown.selectedOptions[0]?.textContent || "";
            break;
        }
    }

    // Determine affected slots
    const affected = new Set();
    for (let c = colStart; c <= colEnd; c++) {
        if (c < setData.slots.length) affected.add(c);
    }

    // Re-fetch tracks for each affected slot
    for (const si of affected) {
        const slot = setData.slots[si];
        const vibeIds = getVibeIdsForSlot(si);
        if (vibeIds.length === 0) continue;

        const usedIds = getAdjacentUsedIds(si);

        try {
            const res = await fetch("/api/set-workshop/slot-tracks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slot_index: si,
                    target_bpm: slot.target_bpm,
                    target_key: slot.target_key,
                    vibe_node_ids: vibeIds,
                    tree_type: setSettings.treeType,
                    used_track_ids: usedIds,
                    key_mode: setSettings.keyPreset,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                slot.tracks = data.tracks;
                setSlotSelections[si] = Math.min(2, Math.max(0, (data.tracks.length || 1) - 1));
            }
        } catch (e) {
            console.error(`Failed to refresh slot ${si}:`, e);
        }
    }

    // Re-render track columns
    renderTrackColumns();
}

function getVibeIdsForSlot(slotIdx) {
    const ids = [];
    for (const v of (setData.vibes || [])) {
        if (v.col_start <= slotIdx && slotIdx <= v.col_end && v.node_id) {
            ids.push(v.node_id);
        }
    }
    return ids;
}

function getAdjacentUsedIds(slotIdx) {
    const ids = [];
    for (let si = Math.max(0, slotIdx - 2); si <= Math.min(setData.slots.length - 1, slotIdx + 2); si++) {
        if (si === slotIdx) continue;
        const slot = setData.slots[si];
        const sel = setSlotSelections[si];
        if (slot.tracks[sel]) ids.push(slot.tracks[sel].id);
    }
    return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// Play All
// ═══════════════════════════════════════════════════════════════════════════

let setPlayAllIndex = -1;
let setPlayAllActive = false;
let setPlayAllAdvanceCleanup = null;

function playAllSet() {
    if (!setData) return;
    const btn = document.getElementById("set-play-all-btn");

    if (setPlayAllActive) {
        // Stop
        stopSetPlayAll();
        return;
    }

    setPlayAllActive = true;
    setPlayAllIndex = 0;
    btn.textContent = "Stop";
    btn.classList.add("play-all-playing");

    playSetTrackAt(0);
}

async function playSetTrackAt(idx) {
    // Clean up previous advance listeners (prevents stale callbacks)
    if (setPlayAllAdvanceCleanup) {
        setPlayAllAdvanceCleanup();
        setPlayAllAdvanceCleanup = null;
    }

    if (!setPlayAllActive || idx >= setData.slots.length) {
        stopSetPlayAll();
        return;
    }

    setPlayAllIndex = idx;

    // Highlight current column
    document.querySelectorAll(".set-column").forEach(col => col.classList.remove("play-all-active"));
    const col = document.querySelector(`.set-column[data-slot-index="${idx}"]`);
    if (col) {
        col.classList.add("play-all-active");
        col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    const slot = setData.slots[idx];
    const selIdx = setSlotSelections[idx] || 0;
    const track = slot.tracks[selIdx];

    if (track && typeof togglePreview === "function") {
        const previewBtn = getSlotPreviewBtn(idx);

        if (previewBtn) {
            let advanced = false;
            const advance = () => {
                if (advanced) return;
                advanced = true;
                cleanup();
                if (setPlayAllActive) playSetTrackAt(idx + 1);
            };
            const cleanup = () => {
                previewAudio.removeEventListener("ended", advance);
                previewAudio.removeEventListener("error", advance);
            };

            previewAudio.addEventListener("ended", advance);
            previewAudio.addEventListener("error", advance);
            setPlayAllAdvanceCleanup = cleanup;

            // Call togglePreview and wait for it to resolve
            await togglePreview(track.artist, track.title, previewBtn);

            // If audio didn't start (no preview found), skip after a short pause
            if (!advanced && (previewAudio.paused || previewAudio.src === "")) {
                setTimeout(advance, 500);
            }
        } else {
            setTimeout(() => playSetTrackAt(idx + 1), 100);
        }
    } else {
        setTimeout(() => playSetTrackAt(idx + 1), 100);
    }
}

function stopSetPlayAll() {
    if (setPlayAllAdvanceCleanup) {
        setPlayAllAdvanceCleanup();
        setPlayAllAdvanceCleanup = null;
    }

    setPlayAllActive = false;
    setPlayAllIndex = -1;

    const btn = document.getElementById("set-play-all-btn");
    btn.textContent = "Play All";
    btn.classList.remove("play-all-playing");

    document.querySelectorAll(".set-column").forEach(col => col.classList.remove("play-all-active"));

    // Stop audio
    if (typeof previewAudio !== "undefined") {
        previewAudio.pause();
        previewAudio.src = "";
    }
    if (typeof resetAllPreviewButtons === "function") resetAllPreviewButtons();
}

// ═══════════════════════════════════════════════════════════════════════════
// Export M3U
// ═══════════════════════════════════════════════════════════════════════════

async function exportSet() {
    if (!setData) return;

    const slots = setData.slots.map((slot, i) => ({
        track_id: slot.tracks[setSlotSelections[i]]?.id,
    }));

    try {
        const res = await fetch("/api/set-workshop/export-m3u", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slots,
                name: `DJ_Set_${setSettings.duration}min`,
            }),
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `DJ_Set_${setSettings.duration}min.m3u8`;
            a.click();
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        console.error("Export failed:", e);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Settings Panel
// ═══════════════════════════════════════════════════════════════════════════

function toggleSettings() {
    const panel = document.getElementById("set-settings-panel");
    panel.classList.toggle("open");
    panel.classList.toggle("hidden", !panel.classList.contains("open"));
}

async function applySettings() {
    // Read settings from panel
    setSettings.energyPreset = document.getElementById("set-energy-preset").value;
    setSettings.keyPreset = document.getElementById("set-key-preset").value;
    setSettings.startKey = document.getElementById("set-start-key").value;
    setSettings.treeType = document.getElementById("set-tree-type").value;
    setSettings.vibePreset = document.getElementById("set-vibe-preset")?.value || "journey";
    setSettings.bpmMin = parseInt(document.getElementById("set-bpm-min").value) || 70;
    setSettings.bpmMax = parseInt(document.getElementById("set-bpm-max").value) || 140;

    // Discard old vibe assignments so the backend auto-fills fresh vibes
    // from the (possibly new) tree type and vibe preset
    setData = null;

    toggleSettings();
    await loadPresets();   // ensure vibe options match the selected tree type
    await generateSet();
}

async function previewEnergyWave() {
    const container = document.getElementById("set-energy-preview");
    if (!container) return;

    const numSlots = setSettings.duration / 3;
    try {
        const res = await fetch(
            `/api/set-workshop/energy-wave?preset=${setSettings.energyPreset}` +
            `&num_slots=${numSlots}&bpm_min=${setSettings.bpmMin}&bpm_max=${setSettings.bpmMax}`
        );
        const data = await res.json();
        const wave = data.wave;
        if (!wave || !wave.length) return;

        const w = container.clientWidth || 260;
        const h = 50;
        const minB = setSettings.bpmMin;
        const maxB = setSettings.bpmMax;
        const rangeB = maxB - minB || 1;

        const pts = wave.map((bpm, i) => {
            const x = (i / (wave.length - 1)) * w;
            const y = h - ((bpm - minB) / rangeB) * h;
            return `${x},${y}`;
        });

        container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
            <polyline class="set-energy-preview-line" points="${pts.join(" ")}" />
        </svg>`;
    } catch (e) {
        console.error("Energy wave preview failed:", e);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tooltip
// ═══════════════════════════════════════════════════════════════════════════

function showTooltip(e, track, slot) {
    if (!setTooltipEl) return;
    setTooltipEl.innerHTML = `
        <div class="tt-title">${escHtml(track.title)}</div>
        <div class="tt-artist">${escHtml(track.artist)}</div>
        <div class="tt-meta">
            <span>BPM: ${track.bpm}</span>
            <span>Key: ${track.key}</span>
            ${track.year ? `<span>Year: ${track.year}</span>` : ""}
        </div>
    `;
    setTooltipEl.classList.add("visible");
    setTooltipEl.style.left = `${e.clientX + 12}px`;
    setTooltipEl.style.top = `${e.clientY - 10}px`;
}

function hideTooltip() {
    if (setTooltipEl) setTooltipEl.classList.remove("visible");
}

function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function bpmToY(bpm) {
    // Convert BPM value to Y pixel position in the grid area
    // BPM_MAX at top (y = SET_GRID_PAD), BPM_MIN at bottom (y = SET_GRID_PAD + SET_GRID_H)
    const pct = (bpm - SET_BPM_MIN) / (SET_BPM_MAX - SET_BPM_MIN);
    return SET_GRID_PAD + SET_GRID_H * (1 - pct);
}

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard Navigation
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("keydown", (e) => {
    if (!setData) return;
    // Only handle if Set Workshop tab is active
    const tab = document.getElementById("tab-setbuilder");
    if (!tab || tab.classList.contains("hidden")) return;

    if (e.key === "Escape" && setPlayAllActive) {
        stopSetPlayAll();
        e.preventDefault();
    }
});
