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
let setBuilderInitialized = false;
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
        await loadTracks();
        toolbar.classList.remove("hidden");
        summary.classList.remove("hidden");
        $("#unified-header").classList.remove("hidden");
        if (!setBuilderInitialized) { setBuilderInitialized = true; if (typeof initSetBuilder === "function") initSetBuilder(); }
        if (typeof initDanceTab === "function") initDanceTab();
        if (typeof refreshDance === "function") refreshDance();
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

// ── Tab Switching ──────────────────────────────────────────
let _activeTab = "dance";  // dance is the default active tab
$$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        const previousTab = _activeTab;
        _activeTab = target;
        $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
        $$(".tab-content").forEach(tc => tc.classList.toggle("hidden", tc.id !== `tab-${target}`));
        $$(".tab-controls").forEach(tc => tc.classList.toggle("hidden", tc.id !== `tab-controls-${target}`));

        // Close chat drawer when leaving chat tab
        if (target !== "chat" && typeof _chatCloseDrawer === "function" && typeof _chatDrawerOpen !== "undefined" && _chatDrawerOpen) {
            _chatCloseDrawer();
        }

        // Dance ↔ Workshop seamless switching (shared playback)
        if (target === "dance") {
            if (typeof startDance === "function") startDance();
        } else if (previousTab === "dance" && target === "setbuilder") {
            // Dance → Workshop: keep audio playing, just stop robots + hide player
            if (typeof stopDanceVisuals === "function") stopDanceVisuals();
        } else if (previousTab === "dance") {
            // Dance → other tab: full stop (pause standalone audio, stop robots)
            if (typeof stopDancePlayback === "function") stopDancePlayback();
        }

        if (target === "intersections" && !intersectionsInitialized) {
            intersectionsInitialized = true;
            if (typeof initIntersections === "function") initIntersections();
        }
        if (target === "workshop" && !workshopInitialized) {
            workshopInitialized = true;
            if (typeof initWorkshop === "function") initWorkshop();
        }
        if (target === "tracks" && !tracksInitialized) {
            tracksInitialized = true;
            if (typeof initTracks === "function") initTracks();
        }
        if (target === "tree" && !treeInitialized) {
            treeInitialized = true;
            if (typeof initTree === "function") initTree();
        }
        if (target === "setbuilder" && !setBuilderInitialized) {
            setBuilderInitialized = true;
            if (typeof initSetBuilder === "function") initSetBuilder();
        }
        if (target === "phases" && !phasesInitialized) {
            if (typeof initPhasesTab === "function") initPhasesTab();
        }
        if (target === "sets") {
            if (typeof initSetsTab === "function") initSetsTab();
            if (typeof loadSetsList === "function") loadSetsList();
        }
        if (target === "autoset" && !autosetInitialized) {
            autosetInitialized = true;
            if (typeof initAutoSetTab === "function") initAutoSetTab();
        }
        if (target === "chat" && !chatInitialized) {
            chatInitialized = true;
            if (typeof initChatTab === "function") initChatTab();
        }
    });
});

// ── Initialize grid on page load ────────────────────────────
initGrid();

// ── Auto-restore last session on refresh ────────────────────
(async function tryRestore() {
    try {
        const res = await fetch("/api/restore");
        const data = await res.json();
        if (res.ok && data.total > 0) {
            updateSummary(data);
            await loadTracks();
            toolbar.classList.remove("hidden");
            summary.classList.remove("hidden");
            $("#unified-header").classList.remove("hidden");
            if (!setBuilderInitialized) { setBuilderInitialized = true; if (typeof initSetBuilder === "function") initSetBuilder(); }
            if (typeof initDanceTab === "function") initDanceTab();
            if (typeof refreshDance === "function") refreshDance();
            checkAndWarmArtworkCache();
        }
    } catch (_) { /* no autosave available */ }
})();

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
