/* ── Phase Profiles Tab ────────────────────────────────────────────────────── */

let phasesInitialized = false;
let _phaseProfiles = [];          // cached list from API
let _selectedProfileId = null;    // currently viewed profile
let _editingPhases = null;        // working copy of phases while editing
let _isNewProfile = false;        // true when creating from scratch

const _PHASE_PALETTE = [
    "#777777", "#999999", "#BBBBBB", "#CCCCCC",
    "#AAAAAA", "#888888", "#666666", "#DDDDDD",
];

// ── Init ──

function initPhasesTab() {
    if (phasesInitialized) return;
    phasesInitialized = true;

    document.getElementById("phases-new-btn").addEventListener("click", startNewProfile);
    document.getElementById("phases-add-btn").addEventListener("click", addPhaseRow);
    document.getElementById("phases-save-btn").addEventListener("click", saveProfile);
    document.getElementById("phases-delete-btn").addEventListener("click", deleteProfile);
    document.getElementById("phases-duplicate-btn").addEventListener("click", duplicateProfile);
    document.getElementById("phases-apply-btn").addEventListener("click", applyToWorkshop);

    document.getElementById("phases-name-input").addEventListener("input", onEditorChange);
    document.getElementById("phases-desc-input").addEventListener("input", onEditorChange);

    loadProfiles();
}


// ── Load & List ──

async function loadProfiles() {
    try {
        const res = await fetch("/api/phase-profiles");
        const data = await res.json();
        _phaseProfiles = data.profiles || [];
    } catch (e) {
        console.error("Failed to load phase profiles:", e);
        _phaseProfiles = [];
    }
    renderProfileList();
}

function renderProfileList() {
    const container = document.getElementById("phases-list");
    container.innerHTML = "";
    if (_phaseProfiles.length === 0) {
        container.innerHTML = '<p class="phases-empty">No profiles found.</p>';
        return;
    }
    for (const prof of _phaseProfiles) {
        const card = document.createElement("div");
        card.className = "phase-profile-card" + (prof.id === _selectedProfileId ? " active" : "");
        card.dataset.profileId = prof.id;

        const nameHtml = escHtml(prof.name)
            + (prof.is_default ? ' <span class="phases-badge">Default</span>' : "");
        const meta = `${prof.phases.length} phase${prof.phases.length !== 1 ? "s" : ""}`;

        card.innerHTML = `
            <div class="phase-profile-card-name">${nameHtml}</div>
            <div class="phase-profile-card-preview">${miniPreviewHtml(prof.phases)}</div>
            <div class="phase-profile-card-meta">${meta}</div>
        `;
        card.addEventListener("click", () => selectProfile(prof.id));
        container.appendChild(card);
    }
}

function miniPreviewHtml(phases) {
    return phases.map(p => {
        const w = p.pct[1] - p.pct[0];
        return `<div style="flex-grow:${w};background:${p.color};"></div>`;
    }).join("");
}


// ── Select / Edit ──

function selectProfile(id) {
    const prof = _phaseProfiles.find(p => p.id === id);
    if (!prof) return;

    _selectedProfileId = id;
    _isNewProfile = false;
    _editingPhases = JSON.parse(JSON.stringify(prof.phases));

    const editor = document.getElementById("phases-editor");
    editor.classList.remove("hidden");

    const isDefault = prof.is_default;

    const nameInput = document.getElementById("phases-name-input");
    nameInput.value = prof.name;
    nameInput.disabled = isDefault;

    const descInput = document.getElementById("phases-desc-input");
    descInput.value = prof.description || "";
    descInput.disabled = isDefault;

    document.getElementById("phases-default-badge").classList.toggle("hidden", !isDefault);
    document.getElementById("phases-add-btn").classList.toggle("hidden", isDefault);
    document.getElementById("phases-save-btn").classList.toggle("hidden", isDefault);
    document.getElementById("phases-delete-btn").classList.toggle("hidden", isDefault);

    renderPreviewBar(_editingPhases);
    renderPhaseTable(_editingPhases, !isDefault);
    highlightCard(id);
}

function highlightCard(id) {
    document.querySelectorAll(".phase-profile-card").forEach(c => {
        c.classList.toggle("active", c.dataset.profileId === id);
    });
}

function startNewProfile() {
    _selectedProfileId = null;
    _isNewProfile = true;
    _editingPhases = [
        { name: "Opening",    pct: [0, 25],   desc: "Start of set",    color: "#777777" },
        { name: "Build",      pct: [25, 50],  desc: "Build energy",    color: "#999999" },
        { name: "Peak",       pct: [50, 75],  desc: "Peak energy",     color: "#CCCCCC" },
        { name: "Resolution", pct: [75, 100], desc: "Wind down",       color: "#888888" },
    ];

    const editor = document.getElementById("phases-editor");
    editor.classList.remove("hidden");

    const nameInput = document.getElementById("phases-name-input");
    nameInput.value = "";
    nameInput.disabled = false;
    nameInput.focus();

    const descInput = document.getElementById("phases-desc-input");
    descInput.value = "";
    descInput.disabled = false;

    document.getElementById("phases-default-badge").classList.add("hidden");
    document.getElementById("phases-add-btn").classList.remove("hidden");
    document.getElementById("phases-save-btn").classList.remove("hidden");
    document.getElementById("phases-delete-btn").classList.add("hidden");

    highlightCard(null);
    renderPreviewBar(_editingPhases);
    renderPhaseTable(_editingPhases, true);
}


// ── Preview Bar ──

function renderPreviewBar(phases) {
    const bar = document.getElementById("phases-preview-bar");
    bar.innerHTML = "";
    for (const p of phases) {
        const w = p.pct[1] - p.pct[0];
        const seg = document.createElement("div");
        seg.className = "phases-preview-segment";
        seg.style.flexGrow = w;
        seg.style.setProperty("--phase-color", p.color);
        seg.textContent = p.name;
        bar.appendChild(seg);
    }
}


// ── Phase Table ──

function renderPhaseTable(phases, editable) {
    const table = document.getElementById("phases-table");
    table.innerHTML = "";

    for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        const row = document.createElement("div");
        row.className = "phase-row";
        row.dataset.index = i;

        // Name
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = p.name;
        nameInput.placeholder = "Phase name";
        nameInput.disabled = !editable;
        nameInput.addEventListener("input", () => { p.name = nameInput.value; onPhaseEdit(); });

        // Start %
        const startInput = document.createElement("input");
        startInput.type = "number";
        startInput.min = 0;
        startInput.max = 100;
        startInput.value = p.pct[0];
        startInput.disabled = !editable || i === 0; // first always starts at 0
        startInput.addEventListener("change", () => {
            let v = Math.round(Number(startInput.value));
            v = Math.max(0, Math.min(100, v));
            p.pct[0] = v;
            // adjust previous phase's end
            if (i > 0) phases[i - 1].pct[1] = v;
            renderPhaseTable(phases, editable);
            onPhaseEdit();
        });

        // End %
        const endInput = document.createElement("input");
        endInput.type = "number";
        endInput.min = 0;
        endInput.max = 100;
        endInput.value = p.pct[1];
        endInput.disabled = !editable || i === phases.length - 1; // last always ends at 100
        endInput.addEventListener("change", () => {
            let v = Math.round(Number(endInput.value));
            v = Math.max(0, Math.min(100, v));
            p.pct[1] = v;
            // adjust next phase's start
            if (i < phases.length - 1) phases[i + 1].pct[0] = v;
            renderPhaseTable(phases, editable);
            onPhaseEdit();
        });

        // Color
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = p.color;
        colorInput.disabled = !editable;
        colorInput.addEventListener("input", () => { p.color = colorInput.value; onPhaseEdit(); });

        // Description
        const descInput = document.createElement("input");
        descInput.type = "text";
        descInput.value = p.desc || "";
        descInput.placeholder = "Description";
        descInput.disabled = !editable;
        descInput.addEventListener("input", () => { p.desc = descInput.value; onPhaseEdit(); });

        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.className = "phase-row-remove";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove phase";
        if (!editable || phases.length <= 1) {
            removeBtn.style.visibility = "hidden";
        }
        removeBtn.addEventListener("click", () => removePhaseRow(i));

        row.appendChild(nameInput);
        row.appendChild(startInput);
        row.appendChild(endInput);
        row.appendChild(colorInput);
        row.appendChild(descInput);
        row.appendChild(removeBtn);
        table.appendChild(row);
    }
}

function onPhaseEdit() {
    renderPreviewBar(_editingPhases);
}

function onEditorChange() {
    // no-op for now, could add dirty indicator
}

function addPhaseRow() {
    if (!_editingPhases) return;
    const last = _editingPhases[_editingPhases.length - 1];
    const splitPct = Math.round((last.pct[0] + last.pct[1]) / 2);
    if (splitPct <= last.pct[0] || splitPct >= last.pct[1]) return; // not enough room

    const newPhase = {
        name: "New Phase",
        pct: [splitPct, last.pct[1]],
        desc: "",
        color: _PHASE_PALETTE[_editingPhases.length % _PHASE_PALETTE.length],
    };
    last.pct[1] = splitPct;
    _editingPhases.push(newPhase);

    renderPreviewBar(_editingPhases);
    renderPhaseTable(_editingPhases, true);
}

function removePhaseRow(index) {
    if (!_editingPhases || _editingPhases.length <= 1) return;
    const removed = _editingPhases.splice(index, 1)[0];
    // Redistribute: expand neighbor
    if (index > 0) {
        _editingPhases[index - 1].pct[1] = removed.pct[1];
    } else if (_editingPhases.length > 0) {
        _editingPhases[0].pct[0] = removed.pct[0];
    }

    renderPreviewBar(_editingPhases);
    renderPhaseTable(_editingPhases, true);
}


// ── CRUD Actions ──

async function saveProfile() {
    const name = document.getElementById("phases-name-input").value.trim();
    const description = document.getElementById("phases-desc-input").value.trim();
    if (!name) {
        showToast("Profile name is required");
        return;
    }
    // Ensure descs are strings
    const phases = _editingPhases.map(p => ({
        name: p.name.trim(),
        pct: [p.pct[0], p.pct[1]],
        desc: (p.desc || "").trim(),
        color: p.color,
    }));

    const body = { name, description, phases };
    let res;
    try {
        if (_isNewProfile || !_selectedProfileId) {
            res = await fetch("/api/phase-profiles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        } else {
            res = await fetch(`/api/phase-profiles/${_selectedProfileId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        }
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || "Save failed");
            return;
        }
        _selectedProfileId = data.id;
        _isNewProfile = false;
        showToast(`Saved "${data.name}"`);
        await loadProfiles();
        selectProfile(data.id);
    } catch (e) {
        console.error("Save profile error:", e);
        showToast("Save failed");
    }
}

async function deleteProfile() {
    if (!_selectedProfileId) return;
    const prof = _phaseProfiles.find(p => p.id === _selectedProfileId);
    if (!prof || prof.is_default) return;
    if (!confirm(`Delete "${prof.name}"?`)) return;

    try {
        const res = await fetch(`/api/phase-profiles/${_selectedProfileId}`, { method: "DELETE" });
        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || "Delete failed");
            return;
        }
        showToast(`Deleted "${prof.name}"`);
        _selectedProfileId = null;
        document.getElementById("phases-editor").classList.add("hidden");
        await loadProfiles();
    } catch (e) {
        console.error("Delete profile error:", e);
        showToast("Delete failed");
    }
}

async function duplicateProfile() {
    const sourceId = _selectedProfileId;
    if (!sourceId) return;
    const prof = _phaseProfiles.find(p => p.id === sourceId);
    if (!prof) return;

    const newName = prompt("Name for the duplicate:", prof.name + " (copy)");
    if (!newName || !newName.trim()) return;

    try {
        const res = await fetch(`/api/phase-profiles/${sourceId}/duplicate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || "Duplicate failed");
            return;
        }
        showToast(`Created "${data.name}"`);
        await loadProfiles();
        selectProfile(data.id);
    } catch (e) {
        console.error("Duplicate profile error:", e);
        showToast("Duplicate failed");
    }
}


// ── Apply to Set Workshop ──

function applyToWorkshop() {
    if (!_editingPhases || _editingPhases.length === 0) return;
    const profileId = _selectedProfileId || null;
    const phases = JSON.parse(JSON.stringify(_editingPhases));

    if (typeof setActivePhaseProfile === "function") {
        setActivePhaseProfile(profileId, phases);
    }

    const prof = _phaseProfiles.find(p => p.id === profileId);
    const name = prof ? prof.name : "Custom";
    showToast(`Applied "${name}" phase profile`);

    // Switch to Set Workshop tab
    const btn = document.querySelector('.tab-btn[data-tab="setbuilder"]');
    if (btn) btn.click();
}


// ── Helpers ──
// escHtml is defined in setbuilder.js (loaded before this file)
