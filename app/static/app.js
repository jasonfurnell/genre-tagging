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

const genreChart = $("#genre-chart");
const TOP_N_GENRES = 8;

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
        this.eGui.innerHTML = `
            <button class="btn btn-sm btn-secondary btn-retag">Re-tag</button>
            <button class="btn btn-sm btn-secondary btn-clear">Clear</button>
        `;
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
        width: 145,
        resizable: false,
        sortable: false,
        suppressMovable: true,
    },
];

const gridOptions = {
    theme: theme,
    columnDefs: columnDefs,
    rowData: [],
    domLayout: "autoHeight",
    getRowId: (params) => String(params.data.id),
    defaultColDef: {
        resizable: true,
        sortable: true,
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
    modal.classList.remove("hidden");
}

async function saveSettings() {
    const body = {
        model: $("#cfg-model").value,
        system_prompt: $("#cfg-system-prompt").value,
        user_prompt_template: $("#cfg-user-prompt").value,
        delay_between_requests: parseFloat($("#cfg-delay").value) || 1.5,
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

// ── Initialize grid on page load ────────────────────────────
initGrid();
