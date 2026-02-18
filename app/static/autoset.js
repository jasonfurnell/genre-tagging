/**
 * Auto Set — narrative-driven DJ set builder.
 *
 * Provides UI for selecting a track source + phase profile, running the
 * 5-phase pipeline via SSE, and displaying the narrative result with an
 * "Open in Workshop" action.
 */

/* global phasesInitialized */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _autosetEventSource = null;
let _autosetBuildStart = null;
let _autosetResultData = null;

const AUTOSET_PHASES = [
    { key: "pool_analysis",     label: "Analysis",  icon: "1" },
    { key: "narrative_arc",     label: "Narrative",  icon: "2" },
    { key: "track_assignment",  label: "Assign",     icon: "3" },
    { key: "track_ordering",    label: "Order",      icon: "4" },
    { key: "assembly",          label: "Build",      icon: "5" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _as = (id) => document.getElementById(id);

function _asApiUrl(path) {
    return `/api/autoset${path}`;
}

function _asElapsed() {
    if (!_autosetBuildStart) return "0:00";
    const s = Math.round((Date.now() - _autosetBuildStart) / 1000);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initAutoSetTab() {
    // Load sources
    _asLoadSources();
    _asLoadProfiles();

    // Event listeners
    _as("autoset-source-type").addEventListener("change", _asLoadSources);
    _as("autoset-source-id").addEventListener("change", _asOnSourceChange);
    _as("autoset-generate-btn").addEventListener("click", _asStartBuild);
    _as("autoset-stop-btn").addEventListener("click", _asStopBuild);
    _as("autoset-open-workshop-btn").addEventListener("click", _asOpenInWorkshop);
    _as("autoset-regenerate-btn").addEventListener("click", () => {
        _as("autoset-result").classList.add("hidden");
        _asStartBuild();
    });
}

// ---------------------------------------------------------------------------
// Source & Profile Loading
// ---------------------------------------------------------------------------

async function _asLoadSources() {
    const type = _as("autoset-source-type").value;
    const picker = _as("autoset-source-id");
    picker.innerHTML = '<option value="">— Loading... —</option>';

    try {
        if (type === "playlist") {
            const res = await fetch("/api/workshop/playlists");
            const data = await res.json();
            const playlists = data.playlists || [];
            picker.innerHTML = '<option value="">— Select playlist —</option>';
            for (const pl of playlists) {
                const count = (pl.track_ids || []).length;
                const opt = document.createElement("option");
                opt.value = pl.id;
                opt.textContent = `${pl.name} (${count} tracks)`;
                opt.dataset.trackCount = count;
                picker.appendChild(opt);
            }
        } else if (type === "tree_node") {
            // Load collection tree leaves as sources
            const res = await fetch("/api/collection-tree");
            const data = await res.json();
            picker.innerHTML = '<option value="">— Select leaf —</option>';
            if (data && data.categories) {
                for (const cat of data.categories) {
                    if (cat.id === "all-collections") continue;
                    const optGroup = document.createElement("optgroup");
                    optGroup.label = cat.title || cat.id;
                    for (const leaf of (cat.leaves || [])) {
                        const opt = document.createElement("option");
                        opt.value = leaf.id;
                        opt.textContent = `${leaf.title} (${leaf.track_count || 0} tracks)`;
                        opt.dataset.trackCount = leaf.track_count || 0;
                        opt.dataset.treeType = "collection";
                        picker.appendChild(opt);  // Add to picker, not optGroup for simplicity
                    }
                }
            }
        }
    } catch (e) {
        picker.innerHTML = '<option value="">— Error loading sources —</option>';
    }

    _asOnSourceChange();
}

async function _asLoadProfiles() {
    try {
        const res = await fetch("/api/phase-profiles");
        const data = await res.json();
        const sel = _as("autoset-profile");
        sel.innerHTML = "";
        for (const p of (data.profiles || [])) {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            sel.appendChild(opt);
        }
    } catch (e) {
        // Keep default option
    }
}

function _asOnSourceChange() {
    const picker = _as("autoset-source-id");
    const selected = picker.options[picker.selectedIndex];
    const count = selected ? (selected.dataset.trackCount || 0) : 0;
    const countEl = _as("autoset-track-count");

    if (picker.value && parseInt(count) >= 10) {
        countEl.textContent = `${count} tracks`;
        countEl.classList.remove("autoset-warn");
        _as("autoset-generate-btn").disabled = false;
    } else if (picker.value) {
        countEl.textContent = `${count} tracks (need 10+)`;
        countEl.classList.add("autoset-warn");
        _as("autoset-generate-btn").disabled = true;
    } else {
        countEl.textContent = "";
        _as("autoset-generate-btn").disabled = true;
    }
}

// ---------------------------------------------------------------------------
// Build Pipeline
// ---------------------------------------------------------------------------

async function _asStartBuild() {
    const sourceType = _as("autoset-source-type").value;
    const sourceId = _as("autoset-source-id").value;
    const profileId = _as("autoset-profile").value;

    if (!sourceId) return;

    // Get tree_type if tree_node source
    const picker = _as("autoset-source-id");
    const selected = picker.options[picker.selectedIndex];
    const treeType = selected?.dataset?.treeType || "collection";

    // UI state
    _as("autoset-generate-btn").disabled = true;
    _as("autoset-stop-btn").classList.remove("hidden");
    _as("autoset-result").classList.add("hidden");
    _as("autoset-progress").classList.remove("hidden");
    _asInitProgress();
    _autosetBuildStart = Date.now();

    // Start SSE listener
    _asConnectSSE();

    // POST to start build
    try {
        const body = {
            source_type: sourceType,
            source_id: sourceId,
            phase_profile_id: profileId,
        };
        if (sourceType === "tree_node") {
            body.tree_type = treeType;
        }

        const res = await fetch(_asApiUrl("/build"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            _asAddLog(data.error || "Build failed to start", true);
            _asBuildFinished();
        }
    } catch (e) {
        _asAddLog("Network error: " + e.message, true);
        _asBuildFinished();
    }
}

function _asStopBuild() {
    fetch(_asApiUrl("/stop"), { method: "POST" });
}

function _asConnectSSE() {
    if (_autosetEventSource) {
        _autosetEventSource.close();
    }

    _autosetEventSource = new EventSource(_asApiUrl("/progress"));
    _autosetEventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.event === "progress") {
            _asUpdateProgress(msg.phase, msg.detail, msg.percent);
        }
        if (msg.event === "done") {
            _asAddLog("Set generation complete!");
            _asBuildFinished();
            _asLoadResult(msg.set_id);
        }
        if (msg.event === "error") {
            _asAddLog("Error: " + (msg.detail || "Unknown error"), true);
            _asBuildFinished();
        }
        if (msg.event === "stopped") {
            _asAddLog("Build stopped by user.");
            _asBuildFinished();
        }
    };
    _autosetEventSource.onerror = () => {
        // SSE reconnects automatically; only log if truly dead
    };
}

function _asBuildFinished() {
    if (_autosetEventSource) {
        _autosetEventSource.close();
        _autosetEventSource = null;
    }
    _as("autoset-generate-btn").disabled = false;
    _as("autoset-stop-btn").classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Progress UI
// ---------------------------------------------------------------------------

function _asInitProgress() {
    // Phase timeline
    const timeline = _as("autoset-phase-timeline");
    timeline.innerHTML = AUTOSET_PHASES.map(p =>
        `<div class="autoset-phase-step" data-phase="${p.key}">
            <span class="autoset-phase-icon">${p.icon}</span>
            <span class="autoset-phase-label">${p.label}</span>
        </div>`
    ).join("");

    // Reset progress
    _as("autoset-progress-bar").style.width = "0%";
    _as("autoset-progress-status").textContent = "Starting...";
    _as("autoset-log").innerHTML = "";
}

function _asUpdateProgress(phase, detail, percent) {
    // Update bar
    _as("autoset-progress-bar").style.width = percent + "%";
    _as("autoset-progress-status").textContent = detail;

    // Update phase timeline
    const steps = document.querySelectorAll(".autoset-phase-step");
    let foundCurrent = false;
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if (step.dataset.phase === phase) {
            step.classList.add("active");
            step.classList.remove("done");
            foundCurrent = true;
        } else if (foundCurrent) {
            step.classList.add("done");
            step.classList.remove("active");
        } else {
            step.classList.remove("active", "done");
        }
    }

    _asAddLog(detail);
}

function _asAddLog(detail, isError = false) {
    const log = _as("autoset-log");
    const entry = document.createElement("div");
    entry.className = "autoset-log-entry" + (isError ? " log-error" : "");
    const ts = _asElapsed();
    entry.innerHTML = `<span class="log-time">${ts}</span> ${_escHtml(detail)}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;

    // Keep last 50 entries
    while (log.children.length > 50) {
        log.removeChild(log.firstChild);
    }
}

function _escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Result Display
// ---------------------------------------------------------------------------

async function _asLoadResult(setId) {
    try {
        const res = await fetch(_asApiUrl("/result"));
        const data = await res.json();
        if (res.ok) {
            _autosetResultData = data;
            _asRenderResult(data, setId);
        }
    } catch (e) {
        _asAddLog("Failed to load result: " + e.message, true);
    }
}

function _asRenderResult(data, setId) {
    // Show result area
    _as("autoset-result").classList.remove("hidden");

    // Narrative
    _as("autoset-narrative-text").textContent = data.narrative || "";

    // Acts
    const actsEl = _as("autoset-acts");
    actsEl.innerHTML = "";

    const acts = data.acts || [];
    const tracks = data.ordered_tracks || [];

    for (let i = 0; i < acts.length; i++) {
        const act = acts[i];
        const actTracks = tracks.filter(t => t.act_idx === i);
        const color = act.color || "#888888";

        const actDiv = document.createElement("div");
        actDiv.className = "autoset-act";
        actDiv.style.borderLeftColor = color;

        let tracksHtml = actTracks.map((t, j) => {
            const num = tracks.indexOf(t) + 1;
            const bpm = t.bpm ? `${t.bpm} BPM` : "";
            const key = t.key || "";
            const mood = t.mood || "";
            return `<div class="autoset-act-track">
                <span class="autoset-track-num">${num}.</span>
                <span class="autoset-track-info">
                    <strong>${_escHtml(t.artist)}</strong> — ${_escHtml(t.title)}
                </span>
                <span class="autoset-track-meta">${bpm}${key ? " / " + key : ""}${mood ? " / " + mood : ""}</span>
            </div>`;
        }).join("");

        actDiv.innerHTML = `
            <div class="autoset-act-header" style="background:${color}20">
                <span class="autoset-act-name">${_escHtml(act.name)}</span>
                <span class="autoset-act-pct">${act.pct[0]}–${act.pct[1]}%</span>
                <span class="autoset-act-count">${actTracks.length} tracks</span>
            </div>
            <div class="autoset-act-tracks">${tracksHtml}</div>
        `;
        actsEl.appendChild(actDiv);
    }

    // Store set_id for workshop navigation
    _as("autoset-open-workshop-btn").dataset.setId = setId || "";
}

// ---------------------------------------------------------------------------
// Workshop Integration
// ---------------------------------------------------------------------------

async function _asOpenInWorkshop() {
    const setId = _as("autoset-open-workshop-btn").dataset.setId;
    if (!setId) return;

    // Grab source info from the build form before switching tabs
    const sourceType = _as("autoset-source-type").value;
    const sourceId = _as("autoset-source-id").value;
    const picker = _as("autoset-source-id");
    const selected = picker.options[picker.selectedIndex];
    const treeType = selected?.dataset?.treeType || null;
    const sourceName = selected?.textContent?.trim() || "Source";

    // Switch to Set Workshop tab and load the set
    const wsBtn = document.querySelector('.tab-btn[data-tab="setbuilder"]');
    if (wsBtn) wsBtn.click();

    // Trigger set load in setbuilder.js (if available)
    if (typeof loadSavedSet === "function") {
        await loadSavedSet(setId);
    }

    // Open the drawer with the source playlist so user can drag/swap tracks
    if (sourceType && sourceId && typeof openDrawer === "function") {
        await new Promise(r => setTimeout(r, 100));
        openDrawer("detail", null);
        if (typeof _showDrawerLoading === "function") {
            _showDrawerLoading(sourceName);
        }
        if (typeof loadDrawerSourceDetail === "function") {
            await loadDrawerSourceDetail({
                type: sourceType,
                id: sourceId,
                tree_type: treeType,
            });
        }
        showToast(`"${sourceName}" loaded — drag tracks to slots`);
    }
}
