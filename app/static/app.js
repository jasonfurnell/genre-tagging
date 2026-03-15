/* ── Genre Tagger — Frontend (AG Grid) ───────────────────── */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// DOM refs
const uploadArea   = $("#upload-area");
const fileInput    = $("#file-input");
const summary      = $("#summary");
const toolbar      = $("#toolbar");
const btnTagAll    = $("#btn-tag-all");
const btnStop      = $("#btn-stop");
const btnClearAll  = $("#btn-clear-all");
const btnExport    = $("#btn-export");
const btnSettings  = $("#btn-settings");
const progressCtr  = $("#progress-container");
const progressBar  = $("#progress-bar");
const modal        = $("#settings-modal");
const gridDiv      = $("#track-grid");

let tracks = [];
let eventSource = null;
let gridApi = null;
let genreCounts = {};
let intersectionsInitialized = false;
let workshopInitialized = false;
let tracksInitialized = false;
let treeInitialized = false;
let autosetInitialized = false;
let chatInitialized = false;

const genreChart = $("#genre-chart");
const TOP_N_GENRES = 8;

// ── Preview Audio Player ─────────────────────────────────────
const previewAudio = new Audio();
previewAudio.volume = 0.7;
let currentPreviewTrackKey = null;

// ── Play-All State ──────────────────────────────────────────
const playAllState = { active: false, tracks: [], index: 0, containerEl: null, _internal: false };

previewAudio.addEventListener("ended", () => {
    resetAllPreviewButtons();
    currentPreviewTrackKey = null;
    if (playAllState.active) { playAllNext(); return; }
});
previewAudio.addEventListener("error", () => {
    resetAllPreviewButtons();
    currentPreviewTrackKey = null;
    if (playAllState.active) { playAllNext(); return; }
});

function makePreviewKey(artist, title) {
    return `${(artist || "").toLowerCase()}||${(title || "").toLowerCase()}`;
}

async function togglePreview(artist, title, buttonEl) {
    // Manual click during play-all → stop the sequence
    if (playAllState.active && !playAllState._internal) {
        stopPlayAll();
    }

    const key = makePreviewKey(artist, title);

    // Same track playing → pause
    if (currentPreviewTrackKey === key && !previewAudio.paused) {
        previewAudio.pause();
        setPreviewButtonState(buttonEl, "idle");
        currentPreviewTrackKey = null;
        return;
    }

    // Stop any current playback
    if (!previewAudio.paused) previewAudio.pause();
    resetAllPreviewButtons();

    setPreviewButtonState(buttonEl, "loading");

    try {
        const params = new URLSearchParams({ artist, title });
        const res = await fetch(`/api/preview?${params}`);
        const data = await res.json();

        if (!data.found || !data.preview_url) {
            setPreviewButtonState(buttonEl, "unavailable");
            // Skip unavailable tracks during play-all
            if (playAllState.active) { playAllNext(); }
            return;
        }

        previewAudio.src = data.preview_url;
        currentPreviewTrackKey = key;
        setPreviewButtonState(buttonEl, "playing");
        previewAudio.play();
    } catch (err) {
        console.error("Preview fetch failed:", err);
        setPreviewButtonState(buttonEl, "idle");
        if (playAllState.active) { playAllNext(); }
    }
}

// ── Play-All Functions ──────────────────────────────────────
function startPlayAll(examplesContainer) {
    // If already playing from this container, stop
    if (playAllState.active && playAllState.containerEl === examplesContainer) {
        stopPlayAll();
        return;
    }
    // Stop any existing play-all or preview
    if (playAllState.active) stopPlayAll();
    if (!previewAudio.paused) previewAudio.pause();
    resetAllPreviewButtons();
    currentPreviewTrackKey = null;

    let trackEls = examplesContainer.querySelectorAll(".tree-example-track");
    if (trackEls.length === 0) trackEls = examplesContainer.querySelectorAll("tr[data-tid]");
    if (trackEls.length === 0) return;

    const tracks = [];
    trackEls.forEach(el => {
        const btn = el.querySelector(".btn-preview");
        if (btn) {
            tracks.push({ artist: btn.dataset.artist, title: btn.dataset.title, trackEl: el, btnEl: btn });
        }
    });
    if (tracks.length === 0) return;

    playAllState.active = true;
    playAllState.tracks = tracks;
    playAllState.index = 0;
    playAllState.containerEl = examplesContainer;

    // Update button text
    const playAllBtn = examplesContainer.querySelector(".tree-play-all-btn, .play-all-btn");
    if (playAllBtn) {
        playAllBtn.textContent = "Stop";
        playAllBtn.classList.add("play-all-playing");
    }

    playAllPlayCurrent();
}

function stopPlayAll() {
    if (!playAllState.active) return;
    // Remove highlight from current track
    if (playAllState.tracks[playAllState.index]) {
        playAllState.tracks[playAllState.index].trackEl.classList.remove("play-all-active");
    }
    // Reset button text
    const playAllBtn = playAllState.containerEl?.querySelector(".tree-play-all-btn, .play-all-btn");
    if (playAllBtn) {
        playAllBtn.textContent = "Play All";
        playAllBtn.classList.remove("play-all-playing");
    }
    playAllState.active = false;
    playAllState.tracks = [];
    playAllState.index = 0;
    playAllState.containerEl = null;
}

function playAllPlayCurrent() {
    const track = playAllState.tracks[playAllState.index];
    if (!track) { stopPlayAll(); return; }
    track.trackEl.classList.add("play-all-active");
    playAllState._internal = true;
    togglePreview(track.artist, track.title, track.btnEl);
    playAllState._internal = false;
}

function playAllNext() {
    if (!playAllState.active) return;
    // Un-highlight current
    const current = playAllState.tracks[playAllState.index];
    if (current) current.trackEl.classList.remove("play-all-active");

    playAllState.index++;
    if (playAllState.index >= playAllState.tracks.length) {
        stopPlayAll();
        return;
    }
    playAllPlayCurrent();
}

function setPreviewButtonState(btn, state) {
    if (!btn) return;
    btn.classList.remove("preview-loading", "preview-playing", "preview-unavailable");
    btn.disabled = false;
    switch (state) {
        case "loading":
            btn.classList.add("preview-loading");
            btn.innerHTML = "\u25CC";
            btn.title = "Loading\u2026";
            btn.disabled = true;
            break;
        case "playing":
            btn.classList.add("preview-playing");
            btn.innerHTML = "\u2586\u2586";
            btn.title = "Pause preview";
            break;
        case "unavailable":
            btn.classList.add("preview-unavailable");
            btn.innerHTML = "\u266B";
            btn.title = "Preview not available";
            btn.disabled = true;
            break;
        default:
            btn.innerHTML = "\u25B6";
            btn.title = "Play 30s preview";
    }
}

function resetAllPreviewButtons() {
    document.querySelectorAll(".btn-preview.preview-playing").forEach(btn => {
        setPreviewButtonState(btn, "idle");
    });
}

// ── Album Artwork Loader (lazy + batch + queue) ─────────────
const artworkCache = new Map();          // "artist||title" -> url | ""
const artworkQueue = [];                 // pending jobs (visible elements only)
const artworkWaiting = new Map();        // key -> [jobs] for in-flight requests
let artworkBatchTimer = null;
let artworkInFlight = 0;
const ARTWORK_BATCH_SIZE = 40;
const ARTWORK_BATCH_DELAY = 150;         // ms debounce
const ARTWORK_MAX_INFLIGHT = 2;          // max concurrent batch requests

// IntersectionObserver — only queue artwork when the <img> scrolls into view
const artworkObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        artworkObserver.unobserve(img);
        const artist = img.dataset.artworkArtist;
        const title = img.dataset.artworkTitle;
        if (!artist || !title) continue;
        _queueArtwork(artist, title, img);
    }
}, { rootMargin: "200px" });             // start loading 200px before visible

function loadArtwork(artist, title, imgEl) {
    if (!artist || !title || !imgEl) return;
    const key = `${artist.toLowerCase()}||${title.toLowerCase()}`;

    // If already cached, apply immediately — no need to observe
    if (artworkCache.has(key)) {
        const url = artworkCache.get(key);
        if (url) { imgEl.src = url; imgEl.classList.add("artwork-loaded"); }
        return;
    }

    // Stash metadata on the element and let the observer decide when to fetch
    imgEl.dataset.artworkArtist = artist;
    imgEl.dataset.artworkTitle = title;
    artworkObserver.observe(imgEl);
}

function _queueArtwork(artist, title, imgEl) {
    const key = `${artist.toLowerCase()}||${title.toLowerCase()}`;

    // Re-check cache (may have been populated while waiting to intersect)
    if (artworkCache.has(key)) {
        const url = artworkCache.get(key);
        if (url) { imgEl.src = url; imgEl.classList.add("artwork-loaded"); }
        return;
    }
    // Already in-flight? Just attach the imgEl
    if (artworkWaiting.has(key)) {
        artworkWaiting.get(key).push({ imgEl });
        return;
    }
    artworkQueue.push({ artist, title, imgEl, key });
    scheduleBatchFlush();
}

function scheduleBatchFlush() {
    if (artworkBatchTimer) return;
    artworkBatchTimer = setTimeout(() => {
        artworkBatchTimer = null;
        flushArtworkBatch();
    }, ARTWORK_BATCH_DELAY);
}

function flushArtworkBatch() {
    if (artworkQueue.length === 0 || artworkInFlight >= ARTWORK_MAX_INFLIGHT) return;

    // Drain queue, deduplicate, resolve already-cached
    const batch = new Map();             // key -> { artist, title, jobs: [{imgEl}] }
    while (artworkQueue.length > 0 && batch.size < ARTWORK_BATCH_SIZE) {
        const job = artworkQueue.shift();
        if (artworkCache.has(job.key)) {
            const url = artworkCache.get(job.key);
            if (url && job.imgEl) { job.imgEl.src = url; job.imgEl.classList.add("artwork-loaded"); }
            continue;
        }
        if (artworkWaiting.has(job.key)) {
            artworkWaiting.get(job.key).push({ imgEl: job.imgEl });
            continue;
        }
        if (!batch.has(job.key)) batch.set(job.key, { artist: job.artist, title: job.title, jobs: [] });
        batch.get(job.key).jobs.push({ imgEl: job.imgEl });
    }

    if (batch.size === 0) {
        if (artworkQueue.length > 0) scheduleBatchFlush();
        return;
    }

    // Register as in-flight
    for (const [key, entry] of batch) artworkWaiting.set(key, entry.jobs);

    const payload = [];
    for (const [, entry] of batch) payload.push({ artist: entry.artist, title: entry.title });

    artworkInFlight++;
    fetch("/api/artwork/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            for (const [key, info] of Object.entries(data)) {
                const url = info.cover_url || "";
                artworkCache.set(key, url);
                const jobs = artworkWaiting.get(key) || [];
                for (const job of jobs) {
                    if (url && job.imgEl) {
                        job.imgEl.src = url;
                        job.imgEl.classList.add("artwork-loaded");
                    }
                }
                artworkWaiting.delete(key);
            }
        })
        .catch(() => {
            for (const [key] of batch) {
                artworkCache.set(key, "");
                artworkWaiting.delete(key);
            }
        })
        .finally(() => {
            artworkInFlight--;
            if (artworkQueue.length > 0) flushArtworkBatch();
        });

    // If queue still has items and we have capacity, flush another immediately
    if (artworkQueue.length > 0 && artworkInFlight < ARTWORK_MAX_INFLIGHT) {
        flushArtworkBatch();
    }
}

// ── Artwork warm-cache (background pre-fetch) ───────────────
let _warmPollTimer = null;

async function checkAndWarmArtworkCache() {
    try {
        const res = await fetch("/api/artwork/uncached-count");
        const data = await res.json();
        if (data.uncached > 0) {
            await fetch("/api/artwork/warm-cache", { method: "POST" });
            _startWarmPoll();
        } else {
            // All artwork cached — ensure local files are downloaded
            _startDownloadAll();
        }
    } catch (_) { /* ignore */ }
}

function _startWarmPoll() {
    const el = document.getElementById("artwork-warm-status");
    if (!el || _warmPollTimer) return;
    el.classList.remove("hidden");
    el.innerHTML = `<span class="artwork-warm-text">Loading artwork...</span>
        <div class="artwork-warm-bar"><div class="artwork-warm-bar-fill" style="width:0%"></div></div>`;
    _warmPollTimer = setInterval(async () => {
        try {
            const res = await fetch("/api/artwork/warm-cache/status");
            const st = await res.json();
            const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
            const fill = el.querySelector(".artwork-warm-bar-fill");
            const text = el.querySelector(".artwork-warm-text");
            if (fill) fill.style.width = pct + "%";
            if (text) text.textContent = `Loading artwork\u2026 ${st.done}/${st.total} (${st.found} found)`;
            if (!st.running) {
                clearInterval(_warmPollTimer);
                _warmPollTimer = null;
                if (text) text.textContent = `Artwork cached: ${st.found} found of ${st.total} tracks`;
                setTimeout(() => {
                    el.classList.add("hidden");
                    // After warm-cache finishes, download all artwork locally
                    _startDownloadAll();
                }, 1000);
            }
        } catch (_) {
            clearInterval(_warmPollTimer);
            _warmPollTimer = null;
            el.classList.add("hidden");
        }
    }, 1500);
}

// ── Download artwork to local files ──────────────────────────
let _dlPollTimer = null;

async function _startDownloadAll() {
    try {
        const res = await fetch("/api/artwork/download-all", { method: "POST" });
        const data = await res.json();
        // If nothing needs downloading, skip straight to retry
        if (data.status === "started") {
            _startDlPoll();
        } else {
            _startRetryNotFound();
        }
    } catch (_) { /* ignore */ }
}

function _startDlPoll() {
    const el = document.getElementById("artwork-warm-status");
    if (!el || _dlPollTimer) return;
    el.classList.remove("hidden");
    el.innerHTML = `<span class="artwork-warm-text">Downloading artwork...</span>
        <div class="artwork-warm-bar"><div class="artwork-warm-bar-fill" style="width:0%"></div></div>`;
    _dlPollTimer = setInterval(async () => {
        try {
            const res = await fetch("/api/artwork/download-all/status");
            const st = await res.json();
            const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
            const fill = el.querySelector(".artwork-warm-bar-fill");
            const text = el.querySelector(".artwork-warm-text");
            if (fill) fill.style.width = pct + "%";
            if (text) text.textContent = `Downloading artwork\u2026 ${st.done}/${st.total}`;
            if (!st.running) {
                clearInterval(_dlPollTimer);
                _dlPollTimer = null;
                if (text) text.textContent = `Artwork downloaded: ${st.downloaded} images saved locally`;
                setTimeout(() => {
                    el.classList.add("hidden");
                    // After download, retry not-found via iTunes + placeholders
                    _startRetryNotFound();
                }, 1000);
            }
        } catch (_) {
            clearInterval(_dlPollTimer);
            _dlPollTimer = null;
            el.classList.add("hidden");
        }
    }, 1500);
}

// ── Retry not-found artwork (iTunes fallback → placeholder) ──
let _retryPollTimer = null;

async function _startRetryNotFound() {
    try {
        const res = await fetch("/api/artwork/retry-not-found", { method: "POST" });
        const data = await res.json();
        if (data.status === "started") _startRetryPoll();
    } catch (_) { /* ignore */ }
}

function _startRetryPoll() {
    const el = document.getElementById("artwork-warm-status");
    if (!el || _retryPollTimer) return;
    el.classList.remove("hidden");
    el.innerHTML = `<span class="artwork-warm-text">Finding missing artwork...</span>
        <div class="artwork-warm-bar"><div class="artwork-warm-bar-fill" style="width:0%"></div></div>`;
    _retryPollTimer = setInterval(async () => {
        try {
            const res = await fetch("/api/artwork/retry-not-found/status");
            const st = await res.json();
            const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
            const fill = el.querySelector(".artwork-warm-bar-fill");
            const text = el.querySelector(".artwork-warm-text");
            if (fill) fill.style.width = pct + "%";
            if (text) text.textContent =
                `Finding missing artwork\u2026 ${st.done}/${st.total} (${st.itunes_found} found, ${st.placeholders} placeholders)`;
            if (!st.running) {
                clearInterval(_retryPollTimer);
                _retryPollTimer = null;
                if (text) text.textContent =
                    `Missing artwork resolved: ${st.itunes_found} found via iTunes, ${st.placeholders} placeholders generated`;
                setTimeout(() => el.classList.add("hidden"), 5000);
            }
        } catch (_) {
            clearInterval(_retryPollTimer);
            _retryPollTimer = null;
            el.classList.add("hidden");
        }
    }, 1500);
}

// ── AG Grid Setup ────────────────────────────────────────────

const theme = agGrid.themeQuartz.withPart(agGrid.colorSchemeDarkBlue).withParams({
    backgroundColor: "#1a1a2e",
    foregroundColor: "#eeeeee",
    headerBackgroundColor: "#16213e",
    borderColor: "#2a2a4a",
    rowHoverColor: "rgba(255,255,255,0.03)",
    headerFontWeight: 600,
    fontSize: 13,
    headerFontSize: 13,
    rowBorder: { color: "#2a2a4a" },
    columnBorder: false,
});

class ActionsCellRenderer {
    init(params) {
        this.eGui = document.createElement("div");
        this.eGui.style.display = "flex";
        this.eGui.style.gap = "4px";
        this.eGui.style.alignItems = "center";
        this.eGui.innerHTML = `
            <img class="track-artwork" alt="">
            <button class="btn-preview" title="Play 30s preview">\u25B6</button>
            <button class="btn btn-sm btn-secondary btn-retag">Re-tag</button>
            <button class="btn btn-sm btn-secondary btn-clear">Clear</button>
        `;
        const artworkImg = this.eGui.querySelector(".track-artwork");
        loadArtwork(params.data.artist, params.data.title, artworkImg);
        const previewBtn = this.eGui.querySelector(".btn-preview");
        previewBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(params.data.artist, params.data.title, previewBtn);
        });
        this.eGui.querySelector(".btn-retag").addEventListener("click", (e) => {
            e.stopPropagation();
            retagTrack(params.data.id);
        });
        this.eGui.querySelector(".btn-clear").addEventListener("click", (e) => {
            e.stopPropagation();
            clearTrack(params.data.id);
        });
    }
    getGui() { return this.eGui; }
    refresh() { return false; }
}

const columnDefs = [
    { field: "rowNum", headerName: "#", width: 65, resizable: false, sortable: false, suppressMovable: true },
    { field: "title", headerName: "Title", minWidth: 140, flex: 1 },
    { field: "artist", headerName: "Artist", minWidth: 140, flex: 1 },
    { field: "bpm", headerName: "BPM", width: 75 },
    { field: "key", headerName: "Key", width: 75 },
    { field: "year", headerName: "Year", width: 80 },
    {
        field: "comment",
        headerName: "Comment",
        minWidth: 200,
        flex: 2,
        editable: true,
        cellStyle: { whiteSpace: "normal", lineHeight: "1.4" },
        autoHeight: true,
        wrapText: true,
    },
    {
        headerName: "Actions",
        cellRenderer: ActionsCellRenderer,
        width: 220,
        resizable: false,
        sortable: false,
        suppressMovable: true,
    },
];

const gridOptions = {
    theme: theme,
    columnDefs: columnDefs,
    rowData: [],
    rowHeight: 64,
    domLayout: "autoHeight",
    getRowId: (params) => String(params.data.id),
    defaultColDef: {
        resizable: true,
        sortable: true,
        filter: true,
    },
    rowClassRules: {
        "untagged": (params) => params.data.status === "untagged",
    },
    onCellValueChanged: async (event) => {
        if (event.colDef.field !== "comment") return;
        const id = event.data.id;
        const comment = (event.newValue || "").trim();

        await fetch(`/api/track/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment }),
        });

        // Update local state
        const track = tracks.find((t) => t.id === id);
        if (track) {
            track.comment = comment;
            track.status = comment ? "tagged" : "untagged";
        }
        // Refresh the row to update class rules
        const rowNode = gridApi.getRowNode(String(id));
        if (rowNode) {
            rowNode.setData({ ...rowNode.data, status: track.status, comment });
            gridApi.flashCells({ rowNodes: [rowNode], columns: ["comment"] });
        }
        refreshSummary();
    },
    overlayNoRowsTemplate: '<span style="color:#999;padding:2rem;">Upload a CSV file to get started.</span>',
};

function initGrid() {
    if (gridApi) return;
    gridApi = agGrid.createGrid(gridDiv, gridOptions);
}

// ── Upload ──────────────────────────────────────────────────
uploadArea.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("dragover"); });
uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragover"));
uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
});

async function uploadFile(file) {
    // Stop any running tagging first
    if (eventSource) {
        await fetch("/api/tag/stop", { method: "POST" });
        finishTagging();
    }

    const form = new FormData();
    form.append("file", file);
    try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) { alert(data.error || "Upload failed"); return; }
        if (data.total === 0) {
            alert("The CSV file is empty (no data rows).");
            return;
        }
        updateSummary(data);
        if (data.duplicates_removed > 0) {
            showToast(`Removed ${data.duplicates_removed} duplicate tracks on upload`);
        }
        await loadTracks();
        toolbar.classList.remove("hidden");
        summary.classList.remove("hidden");
        $("#unified-header").classList.remove("hidden");
        if (typeof initSetBuilder === "function") initSetBuilder();
        checkAndWarmArtworkCache();
    } catch (err) {
        alert("Upload error: " + err.message);
    }
}

function updateSummary(data) {
    $("#summary-total").textContent = data.total + " tracks";
    $("#summary-tagged").textContent = data.tagged + " tagged";
    $("#summary-untagged").textContent = data.untagged + " untagged";
    btnTagAll.disabled = data.untagged === 0;
}

// ── Load & Render Tracks ────────────────────────────────────
async function loadTracks() {
    const res = await fetch("/api/tracks");
    tracks = await res.json();
    renderGrid();
}

function renderGrid() {
    initGrid();
    // Add row numbers
    const rowData = tracks.map((t, i) => ({ ...t, rowNum: i + 1 }));
    gridApi.setGridOption("rowData", rowData);
}

// ── Tagging ─────────────────────────────────────────────────
btnTagAll.addEventListener("click", startTagging);
btnStop.addEventListener("click", stopTagging);

async function startTagging() {
    const res = await fetch("/api/tag", { method: "POST" });
    const data = await res.json();
    if (!data.started) return;

    btnTagAll.classList.add("hidden");
    btnStop.classList.remove("hidden");
    progressCtr.classList.remove("hidden");
    progressBar.style.width = "0%";
    genreCounts = {};
    genreChart.innerHTML = "";
    genreChart.classList.remove("hidden");

    eventSource = new EventSource("/api/tag/progress");
    eventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.event === "progress") {
            // Update track in memory
            const track = tracks.find((t) => t.id === msg.id);
            if (track) {
                track.comment = msg.comment;
                track.status = msg.status;
                if (msg.year) track.year = msg.year;
            }
            // Update the AG Grid row
            const rowNode = gridApi.getRowNode(String(msg.id));
            if (rowNode) {
                const updates = { ...rowNode.data, comment: msg.comment, status: msg.status };
                if (msg.year) updates.year = msg.year;
                rowNode.setData(updates);
                const flashCols = ["comment"];
                if (msg.year) flashCols.push("year");
                gridApi.flashCells({ rowNodes: [rowNode], columns: flashCols });
            }
            // Genre chart
            if (msg.status === "tagged") updateGenreChart(msg.comment);
            // Progress bar
            const [done, total] = msg.progress.split("/").map(Number);
            progressBar.style.width = ((done / total) * 100) + "%";
            refreshSummary();
        }

        if (msg.event === "done" || msg.event === "stopped") {
            finishTagging();
        }
    };
    eventSource.onerror = () => finishTagging();
}

function finishTagging() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    btnStop.classList.add("hidden");
    btnTagAll.classList.remove("hidden");
    progressCtr.classList.add("hidden");
    refreshSummary();
}

async function stopTagging() {
    await fetch("/api/tag/stop", { method: "POST" });
    finishTagging();
}

function updateGenreChart(comment) {
    if (!comment) return;
    const parts = comment.split(";");
    for (let i = 0; i < 2 && i < parts.length; i++) {
        const genre = parts[i].trim();
        if (genre) genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    }
    renderGenreChart();
}

function renderGenreChart() {
    const sorted = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N_GENRES);
    if (sorted.length === 0) return;
    const max = sorted[0][1];
    genreChart.innerHTML = sorted.map(([genre, count]) =>
        `<div class="genre-bar-row">
            <span class="genre-bar-label" title="${genre}">${genre}</span>
            <div class="genre-bar-track">
                <span class="genre-bar-fill" style="width:${(count / max) * 100}%"></span>
            </div>
            <span class="genre-bar-count">${count}</span>
        </div>`
    ).join("");
}

function refreshSummary() {
    const tagged = tracks.filter((t) => t.status === "tagged").length;
    const untagged = tracks.length - tagged;
    $("#summary-total").textContent = tracks.length + " tracks";
    $("#summary-tagged").textContent = tagged + " tagged";
    $("#summary-untagged").textContent = untagged + " untagged";
    btnTagAll.disabled = untagged === 0;
}

// ── Per-track actions ───────────────────────────────────────
async function retagTrack(id) {
    const rowNode = gridApi.getRowNode(String(id));
    if (!rowNode) return;

    // Show spinner via row class
    rowNode.setData({ ...rowNode.data, _spinning: true });
    try {
        const res = await fetch(`/api/tag/${id}`, { method: "POST" });
        const data = await res.json();
        if (data.comment !== undefined) {
            const track = tracks.find((t) => t.id === id);
            if (track) {
                track.comment = data.comment;
                track.status = "tagged";
                if (data.year) track.year = data.year;
            }
            const updates = { ...rowNode.data, comment: data.comment, status: "tagged", _spinning: false };
            if (data.year) updates.year = data.year;
            rowNode.setData(updates);
            const flashCols = ["comment"];
            if (data.year) flashCols.push("year");
            gridApi.flashCells({ rowNodes: [rowNode], columns: flashCols });
        }
    } catch (err) {
        alert("Re-tag failed: " + err.message);
        rowNode.setData({ ...rowNode.data, _spinning: false });
    }
    refreshSummary();
}

async function clearTrack(id) {
    await fetch(`/api/track/${id}/clear`, { method: "POST" });
    const track = tracks.find((t) => t.id === id);
    if (track) { track.comment = ""; track.status = "untagged"; }
    const rowNode = gridApi.getRowNode(String(id));
    if (rowNode) {
        rowNode.setData({ ...rowNode.data, comment: "", status: "untagged" });
    }
    refreshSummary();
}

// ── Clear All ───────────────────────────────────────────────
btnClearAll.addEventListener("click", async () => {
    if (!confirm("Clear all comments? This cannot be undone.")) return;
    await fetch("/api/tracks/clear-all", { method: "POST" });
    tracks.forEach((t) => { t.comment = ""; t.status = "untagged"; });
    renderGrid();
    refreshSummary();
});

// ── Export ───────────────────────────────────────────────────
btnExport.addEventListener("click", () => {
    window.location = "/api/export";
});

// ── Settings Modal ──────────────────────────────────────────
btnSettings.addEventListener("click", openSettings);
$("#btn-cfg-close").addEventListener("click", () => modal.classList.add("hidden"));
$("#btn-cfg-save").addEventListener("click", saveSettings);
$("#btn-cfg-reset").addEventListener("click", resetSettings);

// Close modal on overlay click
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

async function openSettings() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    $("#cfg-model").value = cfg.model || "claude-sonnet-4-5-20250929";
    $("#cfg-system-prompt").value = cfg.system_prompt || "";
    $("#cfg-user-prompt").value = cfg.user_prompt_template || "";
    $("#cfg-delay").value = cfg.delay_between_requests ?? 1.5;

    // Path mapping
    const mapCheck = $("#cfg-path-map-enabled");
    mapCheck.checked = !!cfg.audio_path_map_enabled;
    $("#cfg-path-from").value = cfg.audio_path_from || "";
    $("#cfg-path-to").value = cfg.audio_path_to || "";
    $("#cfg-path-map-fields").classList.toggle("hidden", !mapCheck.checked);
    mapCheck.onchange = () => {
        $("#cfg-path-map-fields").classList.toggle("hidden", !mapCheck.checked);
    };

    modal.classList.remove("hidden");
}

async function saveSettings() {
    const body = {
        model: $("#cfg-model").value,
        system_prompt: $("#cfg-system-prompt").value,
        user_prompt_template: $("#cfg-user-prompt").value,
        delay_between_requests: parseFloat($("#cfg-delay").value) || 1.5,
        audio_path_map_enabled: $("#cfg-path-map-enabled").checked,
        audio_path_from: $("#cfg-path-from").value,
        audio_path_to: $("#cfg-path-to").value,
    };
    await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    modal.classList.add("hidden");
}

async function resetSettings() {
    if (!confirm("Reset prompts to defaults?")) return;
    await fetch("/api/config/reset", { method: "POST" });
    await openSettings();
}

// ── Mode + Tab Switching ──────────────────────────────────
const MODE_SUB_TABS = {
    dance: ["sets", "tree", "chat"],
    dj:    ["sets", "tagger", "intersections", "workshop", "tracks", "tree", "phases", "autoset", "chat"],
};
const MODE_HOME_TAB = { dance: "dance", dj: "setbuilder" };

const TAB_LABELS = {
    dance: "Dance", setbuilder: "Workshop", sets: "Sets", tagger: "Tagger",
    intersections: "Intersections", workshop: "Playlists", tracks: "Tracks",
    tree: "Trees", phases: "Phases", autoset: "Auto Set", chat: "Chat",
};

let _currentMode = "dj";  // Always start on Set.Makin; mode persists only within session
let _activeTab = "setbuilder";

function _updateModeToggleUI() {
    const track = document.getElementById("mode-toggle-track");
    if (!track) return;
    track.classList.toggle("dance", _currentMode === "dance");
    track.classList.toggle("dj", _currentMode === "dj");
}

function switchTab(target) {
    const previousTab = _activeTab;
    _activeTab = target;

    // Determine which mode this tab belongs to
    const mode = target === "dance" ? "dance" : target === "setbuilder" ? "dj" : _currentMode;
    if (mode !== _currentMode) {
        _currentMode = mode;
        localStorage.setItem("gt-mode", mode);
    }

    _updateModeToggleUI();

    // Update active highlight in hamburger menu
    $$(".hamburger-item[data-tab]").forEach(item => {
        item.classList.toggle("active", item.dataset.tab === target);
    });

    // Show/hide context-sensitive hamburger items
    const setBuilderActions = ["set-save-btn", "set-save-as-btn", "set-search-btn",
        "set-export-btn", "set-refill-btn"];
    setBuilderActions.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (target === "setbuilder" && id !== "set-save-btn") ? "" : "none";
    });
    const chatClearBtn = document.getElementById("chat-clear-btn");
    if (chatClearBtn) chatClearBtn.style.display = target === "chat" ? "" : "none";

    // Show correct tab content
    $$(".tab-content").forEach(tc => tc.classList.toggle("hidden", tc.id !== `tab-${target}`));

    // Close chat drawer when leaving chat tab
    if (target !== "chat" && typeof _chatCloseDrawer === "function" && typeof _chatDrawerOpen !== "undefined" && _chatDrawerOpen) {
        _chatCloseDrawer();
    }

    // Dance ↔ Workshop seamless switching (shared playback + drawer)
    if (target === "dance") {
        if (typeof startDance === "function") startDance();
        // Switch to base drawer if audio is playing
        if (typeof setAudio !== "undefined" && setAudio && !setAudio.paused) {
            if (typeof closeDrawer === "function" && typeof setDrawerOpen !== "undefined" && setDrawerOpen) closeDrawer();
            if (typeof baseDrawerOpen !== "undefined" && !baseDrawerOpen && typeof transitionToBaseDrawer === "function") {
                // Open base drawer directly (side drawer already closed above)
                baseDrawerOpen = true;
                document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));
                document.getElementById("base-drawer").classList.add("open");
                if (typeof syncBaseDrawer === "function") syncBaseDrawer();
            }
        }
    } else if (previousTab === "dance" && target === "setbuilder") {
        if (typeof stopDanceVisuals === "function") stopDanceVisuals();
        // Switch from base drawer to side drawer if audio is playing
        // On mobile: keep base drawer open (side drawer unusable on small screens)
        const _isMobile = window.matchMedia("(max-width: 768px)").matches;
        if (!_isMobile && typeof setAudio !== "undefined" && setAudio && !setAudio.paused) {
            if (typeof baseDrawerOpen !== "undefined" && baseDrawerOpen && typeof closeBaseDrawer === "function") closeBaseDrawer();
        }
    } else if (previousTab === "dance") {
        if (typeof stopDancePlayback === "function") stopDancePlayback();
    }

    // Lazy init tabs
    if (target === "intersections" && !intersectionsInitialized) { intersectionsInitialized = true; if (typeof initIntersections === "function") initIntersections(); }
    if (target === "workshop" && !workshopInitialized) { workshopInitialized = true; if (typeof initWorkshop === "function") initWorkshop(); }
    if (target === "tracks" && !tracksInitialized) { tracksInitialized = true; if (typeof initTracks === "function") initTracks(); }
    if (target === "tree" && !treeInitialized) { treeInitialized = true; if (typeof initTree === "function") initTree(); }
    if (target === "setbuilder") {
        if (typeof initSetBuilder === "function") initSetBuilder(); // idempotent via internal guard
        // Ensure now-playing drawer is open when landing on Workshop during playback
        const _isMobileSB = window.matchMedia("(max-width: 768px)").matches;
        if (typeof setAudio !== "undefined" && setAudio && !setAudio.paused) {
            if (_isMobileSB) {
                // Mobile: use base drawer instead of side drawer
                if (typeof baseDrawerOpen !== "undefined" && !baseDrawerOpen && typeof transitionToBaseDrawer === "function") {
                    baseDrawerOpen = true;
                    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));
                    document.getElementById("base-drawer").classList.add("open");
                    if (typeof syncBaseDrawer === "function") syncBaseDrawer();
                }
            } else {
                // Desktop: use side drawer
                if (typeof setDrawerOpen !== "undefined" && !setDrawerOpen && typeof openDrawer === "function") {
                    openDrawer("now-playing", null);
                }
            }
        }
    }
    if (target === "phases" && !phasesInitialized) { if (typeof initPhasesTab === "function") initPhasesTab(); }
    if (target === "sets") { if (typeof initSetsTab === "function") initSetsTab(); if (typeof loadSetsList === "function") loadSetsList(); }
    if (target === "autoset" && !autosetInitialized) { autosetInitialized = true; if (typeof initAutoSetTab === "function") initAutoSetTab(); }
    if (target === "chat" && !chatInitialized) { chatInitialized = true; if (typeof initChatTab === "function") initChatTab(); }

    // Reposition workshop grid after mode toggle (drawer/layout may have changed)
    if ((target === "setbuilder" || target === "dance") && typeof _recenterAfterDrawerChange === "function") {
        _recenterAfterDrawerChange();
    }
}

// ── Hamburger menu ────────────────────────────────────────
const _hamburgerBtn = document.getElementById("hamburger-btn");
const _hamburgerMenu = document.getElementById("hamburger-menu");

function _toggleHamburger() {
    _hamburgerMenu.classList.toggle("hidden");
}
function _closeHamburger() {
    _hamburgerMenu.classList.add("hidden");
}

_hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _toggleHamburger();
});

// Close menu when clicking outside
document.addEventListener("click", (e) => {
    if (!_hamburgerMenu.contains(e.target) && e.target !== _hamburgerBtn) {
        _closeHamburger();
    }
});

// Hamburger menu item clicks (only items with data-tab navigate)
$$(".hamburger-item[data-tab]").forEach(item => {
    item.addEventListener("click", () => {
        const target = item.dataset.tab;
        // Auto-switch mode if needed
        if (target === "dance") {
            _currentMode = "dance";
            localStorage.setItem("gt-mode", "dance");
        } else if (target === "setbuilder") {
            _currentMode = "dj";
            localStorage.setItem("gt-mode", "dj");
        }
        switchTab(target);
        _closeHamburger();
    });
});

// Action items in hamburger (save, search, etc.) close menu on click
$$(".hamburger-item[data-action]").forEach(item => {
    item.addEventListener("click", () => _closeHamburger());
});

// ── Mode toggle switch ────────────────────────────────────
document.getElementById("mode-toggle-track").addEventListener("click", (e) => {
    // Determine which side was clicked
    const track = document.getElementById("mode-toggle-track");
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const half = rect.width / 2;
    const clickedMode = clickX < half ? "dj" : "dance";

    // Only switch if clicking the other side
    if (clickedMode !== _currentMode) {
        _currentMode = clickedMode;
        localStorage.setItem("gt-mode", clickedMode);
        switchTab(MODE_HOME_TAB[clickedMode]);
    }
});

// ── Boot sequence (called from inline script after all JS files load) ────
async function boot() {
    // 1. Init AG Grid (cheap, just creates empty grid)
    initGrid();

    // 2. Show saved mode's home tab (lazy inits fire for that tab)
    switchTab(MODE_HOME_TAB[_currentMode]);

    // 3. Restore session data from autosave
    try {
        const res = await fetch("/api/restore");
        const data = await res.json();
        if (res.ok && data.total > 0) {
            updateSummary(data);
            await loadTracks();
            toolbar.classList.remove("hidden");
            summary.classList.remove("hidden");
            $("#unified-header").classList.remove("hidden");
            // Always init SetBuilder — it's the playback engine (audio + set state)
            // needed by Dance tab's Play button even when not on Workshop tab
            if (typeof initSetBuilder === "function") await initSetBuilder();
            checkAndWarmArtworkCache();
        }
    } catch (_) { /* no autosave available */ }
}

// ── Dropbox Integration ─────────────────────────────────────
let dropboxConnected = false;

async function checkDropboxStatus() {
    try {
        const res = await fetch("/api/dropbox/status");
        const data = await res.json();
        dropboxConnected = data.connected;
        updateDropboxUI(data);
    } catch (e) {
        console.error("Failed to check Dropbox status:", e);
    }
}

function updateDropboxUI(data) {
    const statusText = document.getElementById("dropbox-status-text");
    const connectBtn = document.getElementById("dropbox-connect-btn");
    const disconnectBtn = document.getElementById("dropbox-disconnect-btn");
    const statusDiv = document.getElementById("dropbox-status");
    if (!statusDiv) return;

    if (data.connected) {
        statusText.textContent = "Dropbox: Connected";
        statusDiv.classList.add("dropbox-connected");
        statusDiv.classList.remove("dropbox-disconnected");
        connectBtn.classList.add("hidden");
        disconnectBtn.classList.remove("hidden");
    } else {
        statusText.textContent = "Dropbox";
        statusDiv.classList.remove("dropbox-connected");
        statusDiv.classList.add("dropbox-disconnected");
        connectBtn.classList.remove("hidden");
        disconnectBtn.classList.add("hidden");
    }
}

async function connectDropbox() {
    try {
        const res = await fetch("/api/dropbox/auth-url");
        const data = await res.json();
        if (data.error) { alert(data.error); return; }
        const popup = window.open(data.url, "dropbox-auth",
            "width=600,height=700,menubar=no,toolbar=no");
        // Poll for popup close as fallback
        const pollTimer = setInterval(() => {
            if (popup && popup.closed) {
                clearInterval(pollTimer);
                checkDropboxStatus();
            }
        }, 1000);
    } catch (e) {
        console.error("Failed to initiate Dropbox auth:", e);
    }
}

window.onDropboxConnected = function() {
    checkDropboxStatus();
};

async function disconnectDropbox() {
    if (!confirm("Disconnect Dropbox? Audio playback from Dropbox will stop working.")) return;
    try {
        await fetch("/api/dropbox/disconnect", { method: "POST" });
        await checkDropboxStatus();
    } catch (e) {
        console.error("Failed to disconnect Dropbox:", e);
    }
}

checkDropboxStatus();

// ── Toast notifications ─────────────────────────────────────
function showToast(msg, duration = 4000) {
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ── Library Dedup Modal ─────────────────────────────────────
let _dedupData = null;

document.getElementById("dedup-btn")?.addEventListener("click", async () => {
    // Close hamburger menu
    document.getElementById("hamburger-menu")?.classList.add("hidden");
    const modal = document.getElementById("dedup-modal");
    const summaryEl = document.getElementById("dedup-summary");
    const groupsEl = document.getElementById("dedup-groups");
    const confirmBtn = document.getElementById("dedup-confirm");

    summaryEl.innerHTML = "Scanning for duplicates...";
    groupsEl.innerHTML = "";
    confirmBtn.disabled = true;
    modal.classList.remove("hidden");

    try {
        const res = await fetch("/api/library/duplicates");
        const data = await res.json();
        _dedupData = data;

        if (!data.duplicate_groups || data.duplicate_groups.length === 0) {
            summaryEl.innerHTML = "No duplicates found in your library.";
            return;
        }

        summaryEl.innerHTML = `
            <strong>${data.total_duplicates}</strong> duplicate tracks in
            <strong>${data.total_groups}</strong> groups will be merged.
            ${data.location_conflicts > 0
                ? `<span class="dedup-warning">${data.location_conflicts} group(s) have different file locations — review below.</span>`
                : ""}
        `;

        // Render groups
        groupsEl.innerHTML = data.duplicate_groups.map((group, gi) => {
            const rows = group.tracks.map(t => {
                const isWinner = t.is_winner;
                const comment = t.comment ? t.comment.substring(0, 80) + (t.comment.length > 80 ? "..." : "") : "(no comment)";
                return `
                    <label class="dedup-row ${isWinner ? "dedup-winner" : "dedup-loser"}">
                        <input type="radio" name="dedup-group-${gi}" value="${t.id}"
                               ${isWinner ? "checked" : ""}>
                        <span class="dedup-row-info">
                            <span class="dedup-row-meta">${t.bpm || "?"} BPM · ${t.key || "?"} · ${t.year || "?"}</span>
                            <span class="dedup-row-comment">${comment}</span>
                            ${group.location_conflict ? `<span class="dedup-row-location">${t.location || "(no location)"}</span>` : ""}
                        </span>
                        <span class="dedup-badge">${isWinner ? "KEEP" : "REMOVE"}</span>
                    </label>
                `;
            }).join("");
            return `
                <div class="dedup-group ${group.location_conflict ? "dedup-conflict" : ""}">
                    <div class="dedup-group-title">${group.tracks[0].artist} — ${group.tracks[0].title}
                        <span class="dedup-group-count">(${group.tracks.length} copies)</span>
                    </div>
                    ${rows}
                </div>
            `;
        }).join("");

        // Radio button changes update badges
        groupsEl.querySelectorAll("input[type=radio]").forEach(radio => {
            radio.addEventListener("change", () => {
                const groupDiv = radio.closest(".dedup-group");
                groupDiv.querySelectorAll(".dedup-row").forEach(row => {
                    const r = row.querySelector("input[type=radio]");
                    const badge = row.querySelector(".dedup-badge");
                    if (r.checked) {
                        row.classList.add("dedup-winner");
                        row.classList.remove("dedup-loser");
                        badge.textContent = "KEEP";
                    } else {
                        row.classList.remove("dedup-winner");
                        row.classList.add("dedup-loser");
                        badge.textContent = "REMOVE";
                    }
                });
            });
        });

        confirmBtn.disabled = false;
    } catch (err) {
        summaryEl.innerHTML = `Error: ${err.message}`;
    }
});

document.getElementById("dedup-cancel")?.addEventListener("click", () => {
    document.getElementById("dedup-modal").classList.add("hidden");
    _dedupData = null;
});

document.getElementById("dedup-confirm")?.addEventListener("click", async () => {
    const confirmBtn = document.getElementById("dedup-confirm");
    const summaryEl = document.getElementById("dedup-summary");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Cleaning...";

    // Collect winner overrides from radio buttons
    const overrides = {};
    if (_dedupData) {
        _dedupData.duplicate_groups.forEach((group, gi) => {
            const checked = document.querySelector(`input[name="dedup-group-${gi}"]:checked`);
            if (checked) {
                const winnerId = parseInt(checked.value);
                if (winnerId !== group.winner) {
                    overrides[gi] = winnerId;
                }
            }
        });
    }

    try {
        const res = await fetch("/api/library/deduplicate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ winner_overrides: overrides }),
        });
        const data = await res.json();

        if (data.status === "no_duplicates") {
            showToast("No duplicates to remove");
        } else {
            showToast(`Removed ${data.removed} duplicates — ${data.kept} tracks remaining`);
            // Reload tracks to reflect new IDs
            await loadTracks();
            const sumRes = await fetch("/api/tracks");
            const newTracks = await sumRes.json();
            updateSummary({ total: newTracks.length, tagged: newTracks.filter(t => t.comment && t.comment.trim()).length, untagged: newTracks.filter(t => !t.comment || !t.comment.trim()).length });
        }

        document.getElementById("dedup-modal").classList.add("hidden");
    } catch (err) {
        summaryEl.innerHTML = `Error: ${err.message}`;
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Remove Duplicates";
        _dedupData = null;
    }
});
