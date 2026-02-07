/* ── Playlist Workshop — Frontend ─────────────────────────── */

// Cached analysis data
let wsAnalysis = null;
let wsPlaylists = [];
let wsSelectedPlaylist = null;
let wsSearchResults = [];
let wsSearchTrackIds = [];

// Sort state: { table: "search"|"playlist", col: string, asc: boolean }
let wsSort = { table: null, col: null, asc: true };

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function abbreviate(s, max) {
    max = max || 14;
    return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function extractGenres(comment) {
    if (!comment) return "";
    const parts = comment.split(";");
    return parts.slice(0, 2).map(p => p.trim()).filter(Boolean).join("; ");
}

// ── Table sort utility ──────────────────────────────────────

function sortTracks(tracksArr, col, asc) {
    const copy = [...tracksArr];
    copy.sort((a, b) => {
        let va = a[col], vb = b[col];
        if (va == null || va === "") va = undefined;
        if (vb == null || vb === "") vb = undefined;
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        // Numeric columns
        if (col === "bpm" || col === "year") {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
            return asc ? va - vb : vb - va;
        }
        // String columns
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });
    return copy;
}

function sortArrow(table, col) {
    if (wsSort.table !== table || wsSort.col !== col) return "";
    return wsSort.asc ? " \u25B2" : " \u25BC";
}

function handleSearchSort(col) {
    if (wsSort.table === "search" && wsSort.col === col) {
        wsSort.asc = !wsSort.asc;
    } else {
        wsSort = { table: "search", col, asc: true };
    }
    const sorted = sortTracks(wsSearchResults, col, wsSort.asc);
    renderSearchResults(sorted, true);
}

// ── Init ─────────────────────────────────────────────────────

async function initWorkshop() {
    renderFilterBar([]);
    loadAnalysis();
    loadPlaylists();
}

// ── Analysis & Heatmap ──────────────────────────────────────

async function loadAnalysis() {
    const status = $("#ws-heatmap-status");
    status.textContent = "Analyzing...";
    try {
        const res = await fetch("/api/workshop/analysis");
        if (!res.ok) throw new Error("Analysis failed");
        wsAnalysis = await res.json();
        renderHeatmap(wsAnalysis.cooccurrence);
        renderFilterBar(wsAnalysis.facet_options);
        status.textContent = "";
    } catch (err) {
        status.textContent = "Error loading analysis";
        console.error(err);
    }
}

function renderHeatmap(co) {
    const container = $("#ws-heatmap-container");
    const { genres, matrix } = co;
    if (!genres || genres.length === 0) {
        container.innerHTML = '<p class="ws-placeholder">No genre data found.</p>';
        return;
    }

    // Find max off-diagonal value for color scaling
    let maxVal = 1;
    for (let i = 0; i < genres.length; i++) {
        for (let j = 0; j < genres.length; j++) {
            if (i !== j && matrix[i][j] > maxVal) maxVal = matrix[i][j];
        }
    }

    let html = '<div class="ws-heatmap-scroll"><table class="heatmap-table"><thead><tr><th></th>';
    genres.forEach(g => {
        html += `<th class="heatmap-col-header" title="${escapeHtml(g)}">${escapeHtml(abbreviate(g, 12))}</th>`;
    });
    html += "</tr></thead><tbody>";

    genres.forEach((rowGenre, i) => {
        html += `<tr><th class="heatmap-row-header" title="${escapeHtml(rowGenre)}">${escapeHtml(abbreviate(rowGenre, 14))}</th>`;
        genres.forEach((colGenre, j) => {
            const val = matrix[i][j];
            let bg, cls;
            if (i === j) {
                // Diagonal: total count — use a different color
                const intensity = Math.min(val / 600, 1);
                bg = `rgba(78, 204, 163, ${0.08 + intensity * 0.5})`;
                cls = "heatmap-cell heatmap-diag";
            } else if (val === 0) {
                bg = "transparent";
                cls = "heatmap-cell";
            } else {
                const intensity = val / maxVal;
                bg = `rgba(233, 69, 96, ${0.1 + intensity * 0.75})`;
                cls = "heatmap-cell heatmap-clickable";
            }
            const tooltip = i === j
                ? `${rowGenre}: ${val} total tracks`
                : `${rowGenre} + ${colGenre}: ${val} tracks`;
            html += `<td class="${cls}" style="background:${bg}" title="${escapeHtml(tooltip)}"`;
            if (i !== j && val > 0) {
                html += ` data-g1="${escapeHtml(rowGenre)}" data-g2="${escapeHtml(colGenre)}"`;
            }
            html += `>${val || ""}</td>`;
        });
        html += "</tr>";
    });
    html += "</tbody></table></div>";

    container.innerHTML = html;

    // Click handler for heatmap cells
    container.querySelectorAll(".heatmap-clickable").forEach(cell => {
        cell.addEventListener("click", () => {
            const g1 = cell.dataset.g1;
            const g2 = cell.dataset.g2;
            if (g1 && g2) {
                applyFilters({ genres: [g1, g2] });
            }
        });
    });
}

// ── LLM Suggestions ─────────────────────────────────────────

const btnSuggest = $("#ws-btn-suggest");
btnSuggest.addEventListener("click", generateSuggestions);

async function generateSuggestions() {
    const list = $("#ws-suggestions-list");
    list.innerHTML = '<p class="ws-placeholder ws-loading">Generating playlist ideas... (this may take a moment)</p>';
    btnSuggest.disabled = true;

    try {
        const res = await fetch("/api/workshop/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ num_suggestions: 6 }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Suggestion failed");
        }
        const data = await res.json();
        renderSuggestions(data.suggestions);
    } catch (err) {
        list.innerHTML = `<p class="ws-placeholder ws-error">Error: ${escapeHtml(err.message)}</p>`;
    } finally {
        btnSuggest.disabled = false;
    }
}

function renderSuggestions(suggestions) {
    const list = $("#ws-suggestions-list");
    if (!suggestions || suggestions.length === 0) {
        list.innerHTML = '<p class="ws-placeholder">No suggestions generated.</p>';
        return;
    }

    list.innerHTML = suggestions.map((s, idx) => `
        <div class="ws-suggestion-card">
            <h3>${escapeHtml(s.name)}</h3>
            <p class="ws-suggestion-desc">${escapeHtml(s.description)}</p>
            <p class="ws-suggestion-meta">
                <span class="ws-suggestion-count">${s.track_count || 0} tracks</span>
                <span class="ws-suggestion-rationale" title="${escapeHtml(s.rationale)}">Why?</span>
            </p>
            ${s.sample_tracks && s.sample_tracks.length > 0 ? `
                <div class="ws-suggestion-samples">
                    ${s.sample_tracks.map(t => `<span class="ws-sample-track">${escapeHtml(t.artist)} &mdash; ${escapeHtml(t.title)}</span>`).join("")}
                </div>
            ` : ""}
            <div class="ws-suggestion-actions">
                <button class="btn btn-primary btn-sm" data-action="create" data-idx="${idx}">Create Playlist</button>
                <button class="btn btn-secondary btn-sm" data-action="search" data-idx="${idx}">Search</button>
            </div>
        </div>
    `).join("");

    // Wire up buttons
    list.querySelectorAll("[data-action=create]").forEach(btn => {
        btn.addEventListener("click", () => {
            const s = suggestions[parseInt(btn.dataset.idx)];
            createPlaylistFromSuggestion(s);
        });
    });
    list.querySelectorAll("[data-action=search]").forEach(btn => {
        btn.addEventListener("click", () => {
            const s = suggestions[parseInt(btn.dataset.idx)];
            applyFilters(s.filters);
        });
    });
}

async function createPlaylistFromSuggestion(suggestion) {
    try {
        const res = await fetch("/api/workshop/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: suggestion.name,
                description: suggestion.description,
                filters: suggestion.filters,
                source: "llm",
            }),
        });
        const data = await res.json();
        await loadPlaylists();
        selectPlaylist(data.playlist.id);
    } catch (err) {
        alert("Failed to create playlist: " + err.message);
    }
}

// ── Faceted Search ──────────────────────────────────────────

function renderFilterBar(facetOptions) {
    const container = $("#ws-filters");

    const genreOpts = (facetOptions.genres || [])
        .map(g => `<option value="${escapeHtml(g.value)}">${escapeHtml(g.value)} (${g.count})</option>`)
        .join("");
    const locOpts = (facetOptions.locations || [])
        .map(l => `<option value="${escapeHtml(l.value)}">${escapeHtml(l.value)} (${l.count})</option>`)
        .join("");
    const eraOpts = (facetOptions.eras || [])
        .map(e => `<option value="${escapeHtml(e.value)}">${escapeHtml(e.value)} (${e.count})</option>`)
        .join("");

    container.innerHTML = `
        <div class="ws-filter-row">
            <div class="ws-filter-group ws-filter-wide">
                <label>Genre</label>
                <select id="ws-f-genre" multiple size="4">${genreOpts}</select>
            </div>
            <div class="ws-filter-group">
                <label>BPM</label>
                <div class="ws-range-inputs">
                    <input type="number" id="ws-f-bpm-min" placeholder="Min" min="0" max="300" step="1">
                    <span class="ws-range-sep">&ndash;</span>
                    <input type="number" id="ws-f-bpm-max" placeholder="Max" min="0" max="300" step="1">
                </div>
            </div>
            <div class="ws-filter-group">
                <label>Year</label>
                <div class="ws-range-inputs">
                    <input type="number" id="ws-f-year-min" placeholder="Min" min="1900" max="2030">
                    <span class="ws-range-sep">&ndash;</span>
                    <input type="number" id="ws-f-year-max" placeholder="Max" min="1900" max="2030">
                </div>
            </div>
            <div class="ws-filter-group">
                <label>Location</label>
                <select id="ws-f-location" multiple size="4">${locOpts}</select>
            </div>
            <div class="ws-filter-group">
                <label>Era</label>
                <select id="ws-f-era" multiple size="3">${eraOpts}</select>
            </div>
            <div class="ws-filter-group">
                <label>Mood Keywords</label>
                <input type="text" id="ws-f-mood" placeholder="e.g. warehouse, late-night" class="ws-text-input">
            </div>
            <div class="ws-filter-group">
                <label>Text Search</label>
                <input type="text" id="ws-f-text" placeholder="Search title, artist, comment..." class="ws-text-input">
            </div>
        </div>
        <div class="ws-filter-actions">
            <button id="ws-btn-search" class="btn btn-primary btn-sm">Search</button>
            <button id="ws-btn-clear-filters" class="btn btn-secondary btn-sm">Clear</button>
            <span id="ws-search-count" class="ws-search-count"></span>
        </div>
    `;

    $("#ws-btn-search").addEventListener("click", runSearch);
    $("#ws-btn-clear-filters").addEventListener("click", clearFilters);
}

function getFilters() {
    const getSelected = (id) => {
        const el = document.getElementById(id);
        if (!el) return [];
        return Array.from(el.selectedOptions).map(o => o.value);
    };
    const getNum = (id) => {
        const el = document.getElementById(id);
        if (!el || el.value === "") return undefined;
        return parseFloat(el.value);
    };
    const getText = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : "";
    };

    const filters = {};
    const genres = getSelected("ws-f-genre");
    if (genres.length) filters.genres = genres;
    const locations = getSelected("ws-f-location");
    if (locations.length) filters.location = locations;
    const eras = getSelected("ws-f-era");
    if (eras.length) filters.era = eras;

    const bpmMin = getNum("ws-f-bpm-min");
    const bpmMax = getNum("ws-f-bpm-max");
    if (bpmMin !== undefined) filters.bpm_min = bpmMin;
    if (bpmMax !== undefined) filters.bpm_max = bpmMax;

    const yearMin = getNum("ws-f-year-min");
    const yearMax = getNum("ws-f-year-max");
    if (yearMin !== undefined) filters.year_min = yearMin;
    if (yearMax !== undefined) filters.year_max = yearMax;

    const mood = getText("ws-f-mood");
    if (mood) filters.mood = mood;

    const text = getText("ws-f-text");
    if (text) filters.text_search = text;

    return filters;
}

function applyFilters(filters) {
    // Set genre selections
    const genreSelect = document.getElementById("ws-f-genre");
    if (genreSelect && filters.genres) {
        Array.from(genreSelect.options).forEach(opt => {
            opt.selected = filters.genres.some(g => g.toLowerCase() === opt.value.toLowerCase());
        });
    }
    // Set location
    const locSelect = document.getElementById("ws-f-location");
    if (locSelect && filters.location) {
        Array.from(locSelect.options).forEach(opt => {
            opt.selected = filters.location.some(l => l.toLowerCase() === opt.value.toLowerCase());
        });
    }
    // Set era
    const eraSelect = document.getElementById("ws-f-era");
    if (eraSelect && filters.era) {
        Array.from(eraSelect.options).forEach(opt => {
            opt.selected = filters.era.some(e => opt.value.toLowerCase().includes(e.toLowerCase()));
        });
    }
    // Set mood
    const moodInput = document.getElementById("ws-f-mood");
    if (moodInput && filters.mood) {
        moodInput.value = Array.isArray(filters.mood) ? filters.mood.join(", ") : filters.mood;
    }
    // Set BPM
    if (filters.bpm_min !== undefined) {
        const el = document.getElementById("ws-f-bpm-min");
        if (el) el.value = filters.bpm_min;
    }
    if (filters.bpm_max !== undefined) {
        const el = document.getElementById("ws-f-bpm-max");
        if (el) el.value = filters.bpm_max;
    }
    // Set year
    if (filters.year_min !== undefined) {
        const el = document.getElementById("ws-f-year-min");
        if (el) el.value = filters.year_min;
    }
    if (filters.year_max !== undefined) {
        const el = document.getElementById("ws-f-year-max");
        if (el) el.value = filters.year_max;
    }
    // Set text
    if (filters.text_search) {
        const el = document.getElementById("ws-f-text");
        if (el) el.value = filters.text_search;
    }

    // Scroll to search section
    document.getElementById("ws-filters").scrollIntoView({ behavior: "smooth" });

    runSearch();
}

function clearFilters() {
    const selects = ["ws-f-genre", "ws-f-location", "ws-f-era"];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) Array.from(el.options).forEach(o => o.selected = false);
    });
    const inputs = ["ws-f-bpm-min", "ws-f-bpm-max", "ws-f-year-min", "ws-f-year-max", "ws-f-mood", "ws-f-text"];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    $("#ws-search-count").textContent = "";
    $("#ws-search-results").innerHTML = "";
    wsSearchResults = [];
    wsSearchTrackIds = [];
}

async function runSearch() {
    const filters = getFilters();
    if (Object.keys(filters).length === 0) {
        $("#ws-search-count").textContent = "Select at least one filter";
        return;
    }

    $("#ws-search-count").textContent = "Searching...";

    try {
        const res = await fetch("/api/workshop/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filters }),
        });
        const data = await res.json();
        wsSearchResults = data.tracks || [];
        wsSearchTrackIds = data.track_ids || [];
        $("#ws-search-count").textContent = `${data.count} tracks found`;
        renderSearchResults(wsSearchResults);
    } catch (err) {
        $("#ws-search-count").textContent = "Search failed";
        console.error(err);
    }
}

function renderSearchResults(resultTracks, isSorted) {
    const container = $("#ws-search-results");
    if (resultTracks.length === 0) {
        container.innerHTML = '<p class="ws-placeholder">No matching tracks.</p>';
        return;
    }

    // Keep master list in sync when not a sort-only re-render
    if (!isSorted) {
        wsSearchResults = resultTracks;
    }

    const max = 200;
    const showing = resultTracks.slice(0, max);

    const th = (label, col) =>
        `<th class="ws-sortable" data-sort-col="${col}" data-sort-table="search">${label}${sortArrow("search", col)}</th>`;

    container.innerHTML = `
        <div class="ws-results-toolbar">
            <button class="btn btn-primary btn-sm" id="ws-btn-add-all">Add All (${resultTracks.length}) to Playlist</button>
        </div>
        <table class="ws-results-table">
            <thead>
                <tr>
                    <th>#</th>${th("Title","title")}${th("Artist","artist")}${th("BPM","bpm")}${th("Key","key")}${th("Year","year")}${th("Comment","comment")}<th></th>
                </tr>
            </thead>
            <tbody>
                ${showing.map((t, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</td>
                        <td title="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</td>
                        <td>${t.bpm ? Math.round(parseFloat(t.bpm)) : ""}</td>
                        <td>${escapeHtml(t.key)}</td>
                        <td>${t.year && t.year !== "0" ? Math.round(parseFloat(t.year)) : ""}</td>
                        <td class="ws-comment-cell" title="${escapeHtml(t.comment)}">${escapeHtml(t.comment)}</td>
                        <td><button class="btn btn-sm btn-secondary" data-add-id="${t.id}">+ Playlist</button></td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
        ${resultTracks.length > max ? `<p class="ws-placeholder">Showing first ${max} of ${resultTracks.length} results.</p>` : ""}
    `;

    // Wire sort headers
    container.querySelectorAll(".ws-sortable").forEach(hdr => {
        hdr.addEventListener("click", () => handleSearchSort(hdr.dataset.sortCol));
    });

    // Wire add-all button
    document.getElementById("ws-btn-add-all").addEventListener("click", () => {
        showAddToPlaylistModal(wsSearchTrackIds);
    });

    // Wire per-track add buttons
    container.querySelectorAll("[data-add-id]").forEach(btn => {
        btn.addEventListener("click", () => {
            showAddToPlaylistModal([parseInt(btn.dataset.addId)]);
        });
    });
}

// ── Add-to-Playlist Modal ───────────────────────────────────

function showAddToPlaylistModal(trackIds) {
    const modal = $("#add-to-playlist-modal");
    const list = $("#atp-playlist-list");

    if (wsPlaylists.length === 0) {
        list.innerHTML = '<p class="ws-placeholder">No playlists yet. Create one first.</p>';
    } else {
        list.innerHTML = wsPlaylists.map(p => `
            <button class="atp-item" data-pid="${p.id}">
                <strong>${escapeHtml(p.name)}</strong>
                <span>${(p.track_ids || []).length} tracks</span>
            </button>
        `).join("");

        list.querySelectorAll(".atp-item").forEach(btn => {
            btn.addEventListener("click", async () => {
                modal.classList.add("hidden");
                await addTracksToPlaylist(btn.dataset.pid, trackIds);
            });
        });
    }

    modal.classList.remove("hidden");
    $("#atp-cancel").onclick = () => modal.classList.add("hidden");
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };
}

async function addTracksToPlaylist(playlistId, trackIds) {
    try {
        await fetch(`/api/workshop/playlists/${playlistId}/tracks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_ids: trackIds }),
        });
        await loadPlaylists();
        if (wsSelectedPlaylist === playlistId) {
            selectPlaylist(playlistId);
        }
    } catch (err) {
        alert("Failed to add tracks: " + err.message);
    }
}

// ── Playlist Builder ────────────────────────────────────────

async function loadPlaylists() {
    try {
        const res = await fetch("/api/workshop/playlists");
        const data = await res.json();
        wsPlaylists = data.playlists || [];
        renderPlaylistSidebar();
    } catch (err) {
        console.error("Failed to load playlists", err);
    }
}

function renderPlaylistSidebar() {
    const sidebar = $("#ws-playlist-sidebar");
    const emptyMsg = sidebar.querySelector(".ws-playlist-empty");

    if (wsPlaylists.length === 0) {
        if (emptyMsg) emptyMsg.classList.remove("hidden");
        sidebar.querySelectorAll(".ws-playlist-item").forEach(el => el.remove());
        return;
    }

    if (emptyMsg) emptyMsg.classList.add("hidden");

    // Remove old items
    sidebar.querySelectorAll(".ws-playlist-item").forEach(el => el.remove());

    wsPlaylists.forEach(p => {
        const div = document.createElement("div");
        div.className = "ws-playlist-item" + (p.id === wsSelectedPlaylist ? " active" : "");
        div.dataset.pid = p.id;
        div.innerHTML = `
            <span class="ws-pl-name">${escapeHtml(p.name)}</span>
            <span class="ws-pl-count">${(p.track_ids || []).length}</span>
        `;
        div.addEventListener("click", () => selectPlaylist(p.id));
        sidebar.appendChild(div);
    });
}

async function selectPlaylist(playlistId) {
    wsSelectedPlaylist = playlistId;

    // Highlight in sidebar
    $$(".ws-playlist-item").forEach(el => {
        el.classList.toggle("active", el.dataset.pid === playlistId);
    });

    const detail = $("#ws-playlist-detail");
    detail.innerHTML = '<p class="ws-placeholder ws-loading">Loading...</p>';

    try {
        const res = await fetch(`/api/workshop/playlists/${playlistId}`);
        const data = await res.json();
        renderPlaylistDetail(data.playlist, data.tracks);
    } catch (err) {
        detail.innerHTML = `<p class="ws-placeholder ws-error">Failed to load playlist.</p>`;
    }
}

// Keep playlist tracks for sort re-renders
let wsPlaylistTracks = [];
let wsPlaylistObj = null;

function handlePlaylistSort(col) {
    if (wsSort.table === "playlist" && wsSort.col === col) {
        wsSort.asc = !wsSort.asc;
    } else {
        wsSort = { table: "playlist", col, asc: true };
    }
    const sorted = sortTracks(wsPlaylistTracks, col, wsSort.asc);
    renderPlaylistDetail(wsPlaylistObj, sorted, true);
}

function renderPlaylistDetail(playlist, playlistTracks, isSorted) {
    const detail = $("#ws-playlist-detail");

    if (!isSorted) {
        wsPlaylistTracks = playlistTracks;
        wsPlaylistObj = playlist;
    }

    const th = (label, col) =>
        `<th class="ws-sortable" data-sort-col="${col}" data-sort-table="playlist">${label}${sortArrow("playlist", col)}</th>`;

    detail.innerHTML = `
        <div class="ws-pl-header">
            <input type="text" class="ws-pl-name-input" value="${escapeHtml(playlist.name)}" id="ws-pl-name-edit">
            <span class="ws-pl-track-count">${playlistTracks.length} tracks</span>
        </div>
        ${playlist.description ? `<p class="ws-pl-description">${escapeHtml(playlist.description)}</p>` : ""}
        <div class="ws-pl-actions">
            <button class="btn btn-secondary btn-sm" id="ws-pl-export-m3u">Export M3U</button>
            <button class="btn btn-secondary btn-sm" id="ws-pl-export-csv">Export CSV</button>
            <button class="btn btn-danger btn-sm" id="ws-pl-delete">Delete</button>
        </div>
        ${playlistTracks.length > 0 ? `
            <table class="ws-pl-tracks">
                <thead>
                    <tr><th>#</th>${th("Title","title")}${th("Artist","artist")}${th("BPM","bpm")}${th("Key","key")}${th("Year","year")}${th("Comment","comment")}<th></th></tr>
                </thead>
                <tbody>
                    ${playlistTracks.map((t, i) => `
                        <tr data-tid="${t.id}">
                            <td>${i + 1}</td>
                            <td title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</td>
                            <td title="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</td>
                            <td>${t.bpm ? Math.round(parseFloat(t.bpm)) : ""}</td>
                            <td>${escapeHtml(t.key)}</td>
                            <td>${t.year && t.year !== "0" ? Math.round(parseFloat(t.year)) : ""}</td>
                            <td class="ws-comment-cell" title="${escapeHtml(t.comment)}">${escapeHtml(t.comment)}</td>
                            <td><button class="btn-icon ws-remove-track" data-tid="${t.id}" title="Remove">x</button></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        ` : '<p class="ws-placeholder">No tracks in this playlist yet. Use Search or Suggestions to add tracks.</p>'}
    `;

    // Wire sort headers
    detail.querySelectorAll(".ws-sortable").forEach(hdr => {
        hdr.addEventListener("click", () => handlePlaylistSort(hdr.dataset.sortCol));
    });

    // Name edit
    const nameInput = document.getElementById("ws-pl-name-edit");
    nameInput.addEventListener("change", async () => {
        await fetch(`/api/workshop/playlists/${playlist.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: nameInput.value }),
        });
        loadPlaylists();
    });

    // Export buttons
    document.getElementById("ws-pl-export-m3u").addEventListener("click", () => {
        window.location = `/api/workshop/playlists/${playlist.id}/export/m3u`;
    });
    document.getElementById("ws-pl-export-csv").addEventListener("click", () => {
        window.location = `/api/workshop/playlists/${playlist.id}/export/csv`;
    });

    // Delete
    document.getElementById("ws-pl-delete").addEventListener("click", async () => {
        if (!confirm(`Delete playlist "${playlist.name}"?`)) return;
        await fetch(`/api/workshop/playlists/${playlist.id}`, { method: "DELETE" });
        wsSelectedPlaylist = null;
        detail.innerHTML = "";
        await loadPlaylists();
    });

    // Remove individual tracks
    detail.querySelectorAll(".ws-remove-track").forEach(btn => {
        btn.addEventListener("click", async () => {
            const tid = parseInt(btn.dataset.tid);
            await fetch(`/api/workshop/playlists/${playlist.id}/tracks`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ track_ids: [tid] }),
            });
            await loadPlaylists();
            selectPlaylist(playlist.id);
        });
    });
}

// New Playlist button
$("#ws-btn-new-playlist").addEventListener("click", async () => {
    const name = prompt("Playlist name:");
    if (!name) return;
    try {
        const res = await fetch("/api/workshop/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        await loadPlaylists();
        selectPlaylist(data.playlist.id);
    } catch (err) {
        alert("Failed to create playlist: " + err.message);
    }
});
