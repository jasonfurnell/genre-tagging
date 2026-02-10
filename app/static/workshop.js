/* ── Playlist Workshop — Frontend ─────────────────────────── */

// Cached analysis data
let wsAnalysis = null;
let wsPlaylists = [];
let wsSelectedPlaylist = null;
let wsSearchResults = [];
let wsSearchTrackIds = [];

// Sort state: { table: "search"|"playlist", col: string, asc: boolean }
let wsSort = { table: null, col: null, asc: true };

// Track whether search results are in scored mode (for sort re-render)
let wsScoredMode = false;

// Chord diagram state
let chordTreeType = "genre";
let chordData = null;
let chordThreshold = 0.08;
let chordMaxLineages = 12;

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
        if (col === "bpm" || col === "year" || col === "score") {
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
    if (wsScoredMode) {
        renderScoredSearchResults(sorted, true);
    } else {
        renderSearchResults(sorted, true);
    }
}

// ── Cross-tab navigation helper ─────────────────────────────

function switchToTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
}

// ── Init ─────────────────────────────────────────────────────

async function initIntersections() {
    loadAnalysis();   // still needed for facet_options
    initChordControls();
    loadChordData();
}

async function initWorkshop() {
    renderFilterBar([]);
    loadPlaylists();
}

// ── Analysis (facet data for Workshop filters) ───────────────

async function loadAnalysis() {
    try {
        const res = await fetch("/api/workshop/analysis");
        if (!res.ok) throw new Error("Analysis failed");
        wsAnalysis = await res.json();
        renderFilterBar(wsAnalysis.facet_options);
    } catch (err) {
        console.error(err);
    }
}

// ── Chord Diagram ────────────────────────────────────────────

const CHORD_COLORS = [
    "#4ecca3", "#e94560", "#6c5ce7", "#fdcb6e", "#00b894",
    "#e17055", "#0984e3", "#fab1a0", "#74b9ff", "#a29bfe",
    "#55efc4", "#fd79a8", "#00cec9", "#ffeaa7", "#dfe6e9",
    "#b2bec3", "#636e72", "#81ecec", "#ff7675", "#fd79a8",
];

function initChordControls() {
    // Tree type toggle
    document.querySelectorAll(".chord-type-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".chord-type-btn").forEach(b =>
                b.classList.toggle("active", b === btn));
            chordTreeType = btn.dataset.treeType;
            loadChordData();
        });
    });

    // Threshold slider
    const thresholdSlider = document.getElementById("chord-threshold");
    const thresholdLabel = document.getElementById("chord-threshold-val");
    if (thresholdSlider) {
        thresholdSlider.addEventListener("input", () => {
            chordThreshold = parseFloat(thresholdSlider.value);
            thresholdLabel.textContent = Math.round(chordThreshold * 100) + "%";
        });
        thresholdSlider.addEventListener("change", () => loadChordData());
    }

    // Max lineages slider
    const lineagesSlider = document.getElementById("chord-max-lineages");
    const lineagesLabel = document.getElementById("chord-max-lineages-val");
    if (lineagesSlider) {
        lineagesSlider.addEventListener("input", () => {
            chordMaxLineages = parseInt(lineagesSlider.value);
            lineagesLabel.textContent = chordMaxLineages;
        });
        lineagesSlider.addEventListener("change", () => loadChordData());
    }
}

async function loadChordData() {
    const container = document.getElementById("chord-container");
    const status = document.getElementById("chord-status");
    if (status) status.textContent = "Loading lineage data...";
    container.innerHTML = "";

    try {
        const params = new URLSearchParams({
            tree_type: chordTreeType,
            threshold: chordThreshold,
            max_lineages: chordMaxLineages,
        });
        const res = await fetch(`/api/workshop/chord-data?${params}`);
        if (!res.ok) {
            const err = await res.json();
            if (res.status === 404) {
                container.innerHTML = `<p class="ws-placeholder">${escapeHtml(err.error || "No tree built yet.")}</p>`;
                if (status) status.textContent = "";
                return;
            }
            throw new Error(err.error || "Failed to load chord data");
        }
        chordData = await res.json();
        if (status) status.textContent = "";
        renderChordDiagram(chordData);
    } catch (err) {
        if (status) status.textContent = "Error: " + err.message;
        console.error(err);
    }
}

function renderChordDiagram(data) {
    const container = document.getElementById("chord-container");
    container.innerHTML = "";

    const { lineages, matrix } = data;
    if (!lineages || lineages.length === 0 || !matrix) {
        container.innerHTML = '<p class="ws-placeholder">No lineage data available.</p>';
        return;
    }

    // Check if any chords exist (off-diagonal > 0)
    let hasChords = false;
    for (let i = 0; i < matrix.length && !hasChords; i++)
        for (let j = 0; j < matrix.length && !hasChords; j++)
            if (i !== j && matrix[i][j] > 0) hasChords = true;

    if (!hasChords) {
        container.innerHTML = '<p class="ws-placeholder">No cross-lineage connections found at this threshold. Try lowering the DNA Threshold slider.</p>';
        return;
    }

    const width = Math.min(container.clientWidth || 800, 850);
    const height = width;
    const outerRadius = width / 2 - 100;
    const innerRadius = outerRadius - 20;

    const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);

    const chord = d3.chord()
        .padAngle(0.04)
        .sortSubgroups(d3.descending);

    const chords = chord(matrix);

    const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);

    const ribbon = d3.ribbon()
        .radius(innerRadius);

    // Ensure tooltip exists
    let tooltip = document.getElementById("chord-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "chord-tooltip";
        tooltip.className = "chord-tooltip";
        document.body.appendChild(tooltip);
    }

    // ── Selection state ──────────────────────────────────────
    let selectedIndex = null;  // index of selected lineage, or null

    function isRibbonConnected(r, idx) {
        return r.source.index === idx || r.target.index === idx;
    }

    function applySelectionVisuals() {
        if (selectedIndex !== null) {
            // Highlight connected ribbons, dim everything else
            ribbons
                .style("fill-opacity", r =>
                    isRibbonConnected(r, selectedIndex) ? 0.75 : 0.04)
                .style("pointer-events", r =>
                    isRibbonConnected(r, selectedIndex) ? "auto" : "none");
            arcPaths
                .style("stroke", (d) =>
                    d.index === selectedIndex ? "#fff" : "#1a1a2e")
                .style("stroke-width", (d) =>
                    d.index === selectedIndex ? 2.5 : 1.5);
            labels.style("fill-opacity", d =>
                d.index === selectedIndex ? 1 : 0.3);
        } else {
            // Reset everything
            ribbons
                .style("fill-opacity", 0.45)
                .style("pointer-events", "auto");
            arcPaths
                .style("stroke", "#1a1a2e")
                .style("stroke-width", 1.5);
            labels.style("fill-opacity", 1);
        }
    }

    // ── Draw ribbons (chords) ────────────────────────────────
    const ribbons = svg.append("g")
        .selectAll("path")
        .data(chords)
        .join("path")
        .attr("d", ribbon)
        .attr("class", "chord-ribbon")
        .style("fill", d => CHORD_COLORS[d.source.index % CHORD_COLORS.length])
        .style("fill-opacity", 0.45)
        .style("stroke", "none")
        .on("mouseover", function (event, d) {
            if (selectedIndex !== null && !isRibbonConnected(d, selectedIndex)) return;
            d3.select(this).style("fill-opacity", 0.9);
            const l1 = lineages[d.source.index];
            const l2 = lineages[d.target.index];
            const shared = matrix[d.source.index][d.target.index];
            tooltip.innerHTML = `<strong>${escapeHtml(l1.title)}</strong><br>+&nbsp;<strong>${escapeHtml(l2.title)}</strong><br>${shared} shared tracks`;
            tooltip.style.display = "block";
            tooltip.style.left = (event.pageX + 14) + "px";
            tooltip.style.top = (event.pageY - 12) + "px";
        })
        .on("mousemove", function (event) {
            tooltip.style.left = (event.pageX + 14) + "px";
            tooltip.style.top = (event.pageY - 12) + "px";
        })
        .on("mouseout", function (event, d) {
            // Restore to selection-appropriate opacity
            const base = selectedIndex !== null
                ? (isRibbonConnected(d, selectedIndex) ? 0.75 : 0.04)
                : 0.45;
            d3.select(this).style("fill-opacity", base);
            tooltip.style.display = "none";
        })
        .on("click", function (event, d) {
            if (selectedIndex !== null && !isRibbonConnected(d, selectedIndex)) return;
            tooltip.style.display = "none";
            const l1 = lineages[d.source.index];
            const l2 = lineages[d.target.index];
            showChordPopover(event, l1, l2, matrix[d.source.index][d.target.index]);
        });

    // ── Draw arcs (groups) ───────────────────────────────────
    const groups = svg.append("g")
        .selectAll("g")
        .data(chords.groups)
        .join("g");

    const arcPaths = groups.append("path")
        .attr("d", arc)
        .attr("class", "chord-arc")
        .style("fill", d => CHORD_COLORS[d.index % CHORD_COLORS.length])
        .style("stroke", "#1a1a2e")
        .style("stroke-width", 1.5)
        .on("mouseover", function (event, d) {
            if (selectedIndex !== null) {
                // Only show tooltip, don't change ribbon fade
                const lin = lineages[d.index];
                tooltip.innerHTML = `<strong>${escapeHtml(lin.title)}</strong><br>${lin.track_count} tracks in tree`;
                tooltip.style.display = "block";
                tooltip.style.left = (event.pageX + 14) + "px";
                tooltip.style.top = (event.pageY - 12) + "px";
                return;
            }
            ribbons.style("fill-opacity", r =>
                isRibbonConnected(r, d.index) ? 0.85 : 0.06
            );
            const lin = lineages[d.index];
            tooltip.innerHTML = `<strong>${escapeHtml(lin.title)}</strong><br>${lin.track_count} tracks in tree`;
            tooltip.style.display = "block";
            tooltip.style.left = (event.pageX + 14) + "px";
            tooltip.style.top = (event.pageY - 12) + "px";
        })
        .on("mousemove", function (event) {
            tooltip.style.left = (event.pageX + 14) + "px";
            tooltip.style.top = (event.pageY - 12) + "px";
        })
        .on("mouseout", function () {
            tooltip.style.display = "none";
            if (selectedIndex !== null) return;  // keep selection visuals
            ribbons.style("fill-opacity", 0.45);
        })
        .on("click", function (event, d) {
            // Toggle selection
            if (selectedIndex === d.index) {
                selectedIndex = null;
            } else {
                selectedIndex = d.index;
            }
            applySelectionVisuals();
        });

    // ── Draw labels around the perimeter ─────────────────────
    const labels = groups.append("text")
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr("dy", ".35em")
        .attr("transform", d => `
            rotate(${(d.angle * 180 / Math.PI - 90)})
            translate(${outerRadius + 10})
            ${d.angle > Math.PI ? "rotate(180)" : ""}
        `)
        .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
        .attr("class", "chord-label")
        .text(d => abbreviate(lineages[d.index].title, 30));
}

// ── Chord Popover & Actions ──────────────────────────────────

function showChordPopover(event, lineage1, lineage2, sharedCount) {
    const existing = document.querySelector(".chord-popover");
    if (existing) existing.remove();

    const popover = document.createElement("div");
    popover.className = "chord-popover";
    popover.innerHTML = `
        <p><strong>${escapeHtml(lineage1.title)}</strong><br>+ <strong>${escapeHtml(lineage2.title)}</strong></p>
        <p class="chord-popover-count">${sharedCount} shared tracks</p>
        <button class="btn btn-primary btn-sm" data-pop-action="browse">Browse Shared Tracks</button>
        <button class="btn btn-secondary btn-sm" data-pop-action="generate">Generate Playlists</button>
    `;
    popover.style.left = (event.pageX + 10) + "px";
    popover.style.top = (event.pageY - 10) + "px";
    document.body.appendChild(popover);

    popover.querySelector("[data-pop-action=browse]").addEventListener("click", () => {
        popover.remove();
        switchToTab("workshop");
        // Merge filters from both lineages for a broad scored search
        const merged = mergeLineageFilters(lineage1.filters, lineage2.filters);
        applyFilters(merged);
    });

    popover.querySelector("[data-pop-action=generate]").addEventListener("click", () => {
        popover.remove();
        generateChordIntersectionCards(lineage1, lineage2);
    });

    const closeHandler = (ev) => {
        if (!popover.contains(ev.target)) {
            popover.remove();
            document.removeEventListener("click", closeHandler);
        }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
}

function mergeLineageFilters(f1, f2) {
    const merged = {};
    for (const key of ["genres", "mood", "descriptors", "location", "era"]) {
        const a = f1[key] || [];
        const b = f2[key] || [];
        const combined = [...new Set([...a, ...b])];
        if (combined.length) merged[key] = combined;
    }
    return merged;
}

async function generateChordIntersectionCards(lineage1, lineage2) {
    const grid = document.getElementById("ix-cards-grid");
    grid.classList.remove("hidden");
    grid.innerHTML = '<p class="ws-placeholder ws-loading">Exploring ' +
        escapeHtml(lineage1.title) + ' + ' + escapeHtml(lineage2.title) +
        '... (this may take a moment)</p>';
    grid.scrollIntoView({ behavior: "smooth" });

    try {
        const res = await fetch("/api/workshop/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "chord-intersection",
                lineage1_title: lineage1.title,
                lineage2_title: lineage2.title,
                lineage1_filters: lineage1.filters,
                lineage2_filters: lineage2.filters,
                num_suggestions: 3,
            }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Suggestion failed");
        }
        const data = await res.json();
        renderIntersectionCards(data.suggestions || [], lineage1.title, lineage2.title);
    } catch (err) {
        grid.innerHTML = '<p class="ws-placeholder ws-error">Error: ' + escapeHtml(err.message) + '</p>';
    }
}

// ── Intersection Playlist Cards (tree-style) ────────────────

async function generateIntersectionCards(genre1, genre2) {
    const grid = document.getElementById("ix-cards-grid");
    grid.classList.remove("hidden");
    grid.innerHTML = '<p class="ws-placeholder ws-loading">Exploring ' + escapeHtml(genre1) + ' + ' + escapeHtml(genre2) + '... (this may take a moment)</p>';
    grid.scrollIntoView({ behavior: "smooth" });

    try {
        const res = await fetch("/api/workshop/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "intersection",
                genre1,
                genre2,
                num_suggestions: 3,
            }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Suggestion failed");
        }
        const data = await res.json();
        renderIntersectionCards(data.suggestions || [], genre1, genre2);
    } catch (err) {
        grid.innerHTML = '<p class="ws-placeholder ws-error">Error: ' + escapeHtml(err.message) + '</p>';
    }
}

function renderIntersectionCards(suggestions, genre1, genre2) {
    const grid = document.getElementById("ix-cards-grid");
    if (!suggestions || suggestions.length === 0) {
        grid.innerHTML = '<p class="ws-placeholder">No playlists generated.</p>';
        return;
    }

    grid.innerHTML = "";

    for (const s of suggestions) {
        const card = document.createElement("div");
        card.className = "tree-container";

        let examplesHtml = "";
        if (s.sample_tracks && s.sample_tracks.length > 0) {
            examplesHtml = '<div class="tree-node-examples tree-lineage-examples">'
                + '<div class="tree-examples-title">Exemplar Tracks <button class="btn btn-sm btn-secondary tree-play-all-btn">Play All</button></div>';
            for (const t of s.sample_tracks) {
                const yr = t.year && t.year !== "0" ? `<span class="tree-track-year">${Math.round(parseFloat(t.year))}</span>` : "";
                examplesHtml += `<div class="tree-example-track">
                    <img class="track-artwork" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" alt="">
                    <button class="btn-preview" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" title="Play 30s preview">\u25B6</button>
                    <span class="tree-track-title">${escapeHtml(t.title)}</span>
                    <span class="tree-track-artist">${escapeHtml(t.artist)}</span>
                    ${yr}
                </div>`;
            }
            examplesHtml += "</div>";
        }

        card.innerHTML = `
            <div class="tree-card-header">
                <h3 class="tree-title">${escapeHtml(s.name)}</h3>
                <p class="tree-subtitle">~${s.track_count || 0} matching tracks</p>
            </div>
            <div class="tree-card-desc">${escapeHtml(s.description)}</div>
            ${examplesHtml}
            <div class="tree-lineage-actions">
                <button class="btn btn-sm btn-secondary ix-search-btn">Search Tracks</button>
                <button class="btn btn-sm btn-primary ix-create-pl-btn">Create Playlist</button>
            </div>
        `;
        grid.appendChild(card);

        // Wire preview buttons
        card.querySelectorAll(".btn-preview").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                togglePreview(btn.dataset.artist, btn.dataset.title, btn);
            });
        });
        // Load artwork
        card.querySelectorAll(".track-artwork").forEach(img => {
            loadArtwork(img.dataset.artist, img.dataset.title, img);
        });
        // Wire play-all
        const examplesEl = card.querySelector(".tree-lineage-examples");
        if (examplesEl) {
            const playAllBtn = examplesEl.querySelector(".tree-play-all-btn");
            if (playAllBtn) playAllBtn.addEventListener("click", () => startPlayAll(examplesEl));
        }

        // Wire search button → go to workshop with filters
        card.querySelector(".ix-search-btn").addEventListener("click", () => {
            switchToTab("workshop");
            applyFilters(s.filters || { genres: [genre1, genre2] });
        });

        // Wire create playlist button
        const plBtn = card.querySelector(".ix-create-pl-btn");
        plBtn.addEventListener("click", async () => {
            plBtn.disabled = true;
            plBtn.textContent = "Creating...";
            try {
                await fetch("/api/workshop/playlists/smart-create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: s.name,
                        description: s.description,
                        filters: s.filters,
                        target_count: 25,
                    }),
                });
                plBtn.textContent = "Playlist Created";
            } catch (err) {
                plBtn.textContent = "Failed";
                plBtn.disabled = false;
            }
        });
    }
}

// ── LLM Suggestions ─────────────────────────────────────────

let wsSuggestions = [];  // keep reference for "Save All"
let wsSelectedSeeds = new Set();  // track IDs selected as seeds

const btnSuggest = $("#ws-btn-suggest");
btnSuggest.addEventListener("click", () => generateSuggestions("explore"));

// Vibe text input
const btnVibeSuggest = $("#ws-btn-vibe-suggest");
const vibeInput = $("#ws-vibe-text");
btnVibeSuggest.addEventListener("click", () => {
    const text = vibeInput.value.trim();
    if (!text) { vibeInput.focus(); return; }
    generateSuggestions("vibe", { vibe_text: text });
});
vibeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        btnVibeSuggest.click();
    }
});

async function generateSuggestions(mode, extra) {
    const list = $("#ws-suggestions-list");
    const modeLabels = {
        explore: "Generating playlist ideas",
        vibe: "Creating playlists from your vibe",
        seed: "Analyzing seed tracks",
        intersection: "Exploring genre intersection",
    };
    list.innerHTML = `<p class="ws-placeholder ws-loading">${modeLabels[mode] || "Generating"}... (this may take a moment)</p>`;
    btnSuggest.disabled = true;
    const vibeBtn = document.getElementById("ws-btn-vibe-suggest");
    if (vibeBtn) vibeBtn.disabled = true;

    const payload = { mode };
    if (mode === "explore") {
        payload.num_suggestions = 6;
    } else if (mode === "vibe") {
        payload.vibe_text = extra.vibe_text;
        payload.num_suggestions = 3;
    } else if (mode === "seed") {
        payload.seed_track_ids = extra.seed_track_ids;
        payload.num_suggestions = 3;
    } else if (mode === "intersection") {
        payload.genre1 = extra.genre1;
        payload.genre2 = extra.genre2;
        payload.num_suggestions = 3;
    }

    try {
        const res = await fetch("/api/workshop/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Suggestion failed");
        }
        const data = await res.json();
        wsSuggestions = data.suggestions || [];
        renderSuggestions(wsSuggestions);
    } catch (err) {
        list.innerHTML = `<p class="ws-placeholder ws-error">Error: ${escapeHtml(err.message)}</p>`;
    } finally {
        btnSuggest.disabled = false;
        if (vibeBtn) vibeBtn.disabled = false;
    }
}

function renderSuggestions(suggestions) {
    const list = $("#ws-suggestions-list");
    if (!suggestions || suggestions.length === 0) {
        list.innerHTML = '<p class="ws-placeholder">No suggestions generated.</p>';
        return;
    }

    list.innerHTML = `
        <div class="ws-suggestions-toolbar">
            <button class="btn btn-secondary btn-sm" id="ws-btn-save-all">Save All as Playlists</button>
        </div>
    ` + suggestions.map((s, idx) => `
        <div class="ws-suggestion-card">
            <h3>${escapeHtml(s.name)}</h3>
            <p class="ws-suggestion-desc">${escapeHtml(s.description)}</p>
            <p class="ws-suggestion-meta">
                <span class="ws-suggestion-count">${s.track_count || 0} matching tracks</span>
                <span class="ws-suggestion-rationale" title="${escapeHtml(s.rationale)}">Why?</span>
            </p>
            ${s.sample_tracks && s.sample_tracks.length > 0 ? `
                <div class="ws-suggestion-samples">
                    ${s.sample_tracks.map(t => `<span class="ws-sample-track">${escapeHtml(t.artist)} &mdash; ${escapeHtml(t.title)}${t.score ? ` (${Math.round(t.score * 100)}%)` : ''}</span>`).join("")}
                </div>
            ` : ""}
            <div class="ws-suggestion-actions">
                <button class="btn btn-primary btn-sm" data-action="create" data-idx="${idx}">Create Playlist</button>
                <button class="btn btn-secondary btn-sm" data-action="search" data-idx="${idx}">Search</button>
            </div>
        </div>
    `).join("");

    // Wire Save All button (uses smart-create for each playlist)
    document.getElementById("ws-btn-save-all").addEventListener("click", async () => {
        const btn = document.getElementById("ws-btn-save-all");
        btn.disabled = true;
        let created = 0;
        for (let i = 0; i < suggestions.length; i++) {
            const s = suggestions[i];
            btn.textContent = `Creating ${i + 1}/${suggestions.length}...`;
            try {
                await fetch("/api/workshop/playlists/smart-create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: s.name,
                        description: s.description,
                        filters: s.filters,
                        target_count: 25,
                    }),
                });
                created++;
            } catch (err) {
                console.error("Failed to save playlist:", s.name, err);
            }
        }
        btn.textContent = `Saved ${created} playlists`;
        await loadPlaylists();
    });

    // Wire up per-card buttons
    list.querySelectorAll("[data-action=create]").forEach(btn => {
        btn.addEventListener("click", () => {
            const s = suggestions[parseInt(btn.dataset.idx)];
            btn.disabled = true;
            btn.textContent = "Creating...";
            createPlaylistFromSuggestion(s).finally(() => {
                btn.disabled = false;
                btn.textContent = "Create Playlist";
            });
        });
    });
    list.querySelectorAll("[data-action=search]").forEach(btn => {
        btn.addEventListener("click", () => {
            const s = suggestions[parseInt(btn.dataset.idx)];
            runScoredSearch(s.filters, s.name, s.description);
        });
    });
}

async function createPlaylistFromSuggestion(suggestion) {
    try {
        const res = await fetch("/api/workshop/playlists/smart-create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: suggestion.name,
                description: suggestion.description,
                filters: suggestion.filters,
                target_count: 25,
            }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to create playlist");
        }
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
    wsScoredMode = false;
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

// ── Scored Search (from suggestion cards) ───────────────────

// Store current scored search context for LLM reranking
let wsScoredContext = { filters: null, playlistName: "", description: "" };

async function runScoredSearch(filters, playlistName, description) {
    wsScoredMode = true;
    const countEl = $("#ws-search-count");
    countEl.textContent = "Searching (scored)...";

    // Scroll to search results
    document.getElementById("ws-search-results").scrollIntoView({ behavior: "smooth" });

    wsScoredContext = { filters, playlistName: playlistName || "", description: description || "" };

    try {
        const res = await fetch("/api/workshop/scored-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filters, min_score: 0.15, max_results: 200 }),
        });
        const data = await res.json();
        wsSearchResults = data.tracks || [];
        wsSearchTrackIds = data.track_ids || [];
        countEl.textContent = `${data.count} tracks found (scored)`;
        renderScoredSearchResults(wsSearchResults);
    } catch (err) {
        countEl.textContent = "Scored search failed";
        console.error(err);
    }
}

function renderScoreBadge(score) {
    const pct = Math.round(score * 100);
    if (score >= 0.8) return `<span class="ws-score ws-score-high">${pct}%</span>`;
    if (score >= 0.5) return `<span class="ws-score ws-score-mid">${pct}%</span>`;
    return `<span class="ws-score ws-score-low">${pct}%</span>`;
}

function renderScoredSearchResults(resultTracks, isSorted) {
    const container = $("#ws-search-results");
    if (resultTracks.length === 0) {
        container.innerHTML = '<p class="ws-placeholder">No matching tracks.</p>';
        return;
    }

    if (!isSorted) {
        wsSearchResults = resultTracks;
        wsSelectedSeeds.clear();
    }

    const max = 200;
    const showing = resultTracks.slice(0, max);

    const th = (label, col) =>
        `<th class="ws-sortable" data-sort-col="${col}" data-sort-table="search">${label}${sortArrow("search", col)}</th>`;

    container.innerHTML = `
        <div class="ws-results-toolbar">
            <button class="btn btn-primary btn-sm" id="ws-btn-add-all">Add All (${resultTracks.length}) to Playlist</button>
            <button class="btn btn-secondary btn-sm" id="ws-btn-llm-refine" title="Ask the AI to pick the best tracks for this vibe">
                Refine with AI
            </button>
            <span id="ws-refine-status" class="ws-search-count"></span>
        </div>
        <table class="ws-results-table">
            <thead>
                <tr>
                    <th class="ws-seed-col"><input type="checkbox" id="ws-seed-toggle-all" title="Toggle all as seeds"></th>
                    <th></th><th>#</th>${th("Score","score")}${th("Title","title")}${th("Artist","artist")}${th("BPM","bpm")}${th("Key","key")}${th("Year","year")}${th("Comment","comment")}<th></th>
                </tr>
            </thead>
            <tbody>
                ${showing.map((t, i) => `
                    <tr class="${wsSelectedSeeds.has(t.id) ? "ws-seed-selected" : ""}">
                        <td class="ws-seed-col"><input type="checkbox" class="ws-seed-cb" data-seed-id="${t.id}" ${wsSelectedSeeds.has(t.id) ? "checked" : ""}></td>
                        <td class="ws-preview-cell"><img class="track-artwork" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" alt=""><button class="btn-preview" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" title="Play 30s preview">\u25B6</button></td>
                        <td>${i + 1}</td>
                        <td class="ws-score-cell">${renderScoreBadge(t.score || 0)}</td>
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

    // Wire preview buttons
    container.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(btn.dataset.artist, btn.dataset.title, btn);
        });
    });
    // Load artwork
    container.querySelectorAll(".track-artwork").forEach(img => {
        loadArtwork(img.dataset.artist, img.dataset.title, img);
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

    // Wire seed checkboxes
    function updateSeedCount() {
        const countEl = document.getElementById("ws-seed-count");
        const genBtn = document.getElementById("ws-btn-seed-generate");
        if (countEl) countEl.textContent = wsSelectedSeeds.size;
        if (genBtn) genBtn.disabled = wsSelectedSeeds.size === 0;
    }

    container.querySelectorAll(".ws-seed-cb").forEach(cb => {
        cb.addEventListener("change", () => {
            const tid = parseInt(cb.dataset.seedId);
            if (cb.checked) {
                wsSelectedSeeds.add(tid);
                cb.closest("tr").classList.add("ws-seed-selected");
            } else {
                wsSelectedSeeds.delete(tid);
                cb.closest("tr").classList.remove("ws-seed-selected");
            }
            updateSeedCount();
        });
    });

    // Toggle all seeds
    const toggleAll = document.getElementById("ws-seed-toggle-all");
    if (toggleAll) {
        toggleAll.addEventListener("change", () => {
            const checked = toggleAll.checked;
            container.querySelectorAll(".ws-seed-cb").forEach(cb => {
                const tid = parseInt(cb.dataset.seedId);
                cb.checked = checked;
                if (checked) {
                    wsSelectedSeeds.add(tid);
                    cb.closest("tr").classList.add("ws-seed-selected");
                } else {
                    wsSelectedSeeds.delete(tid);
                    cb.closest("tr").classList.remove("ws-seed-selected");
                }
            });
            updateSeedCount();
        });
    }

    // Wire LLM Refine button
    document.getElementById("ws-btn-llm-refine").addEventListener("click", () => {
        runLLMRerank(resultTracks.slice(0, 80), wsScoredContext.playlistName, wsScoredContext.description);
    });
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
        wsSelectedSeeds.clear();
    }

    const max = 200;
    const showing = resultTracks.slice(0, max);

    const th = (label, col) =>
        `<th class="ws-sortable" data-sort-col="${col}" data-sort-table="search">${label}${sortArrow("search", col)}</th>`;

    container.innerHTML = `
        <div class="ws-results-toolbar">
            <button class="btn btn-primary btn-sm" id="ws-btn-add-all">Add All (${resultTracks.length}) to Playlist</button>
            <button class="btn btn-secondary btn-sm" id="ws-btn-seed-generate" disabled title="Select tracks as seeds, then generate playlists">Generate from Selection (<span id="ws-seed-count">0</span>)</button>
        </div>
        <table class="ws-results-table">
            <thead>
                <tr>
                    <th class="ws-seed-col"><input type="checkbox" id="ws-seed-toggle-all" title="Toggle all as seeds"></th>
                    <th></th><th>#</th>${th("Title","title")}${th("Artist","artist")}${th("BPM","bpm")}${th("Key","key")}${th("Year","year")}${th("Comment","comment")}<th></th>
                </tr>
            </thead>
            <tbody>
                ${showing.map((t, i) => `
                    <tr class="${wsSelectedSeeds.has(t.id) ? "ws-seed-selected" : ""}">
                        <td class="ws-seed-col"><input type="checkbox" class="ws-seed-cb" data-seed-id="${t.id}" ${wsSelectedSeeds.has(t.id) ? "checked" : ""}></td>
                        <td class="ws-preview-cell"><img class="track-artwork" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" alt=""><button class="btn-preview" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" title="Play 30s preview">\u25B6</button></td>
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

    // Wire preview buttons
    container.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(btn.dataset.artist, btn.dataset.title, btn);
        });
    });
    // Load artwork
    container.querySelectorAll(".track-artwork").forEach(img => {
        loadArtwork(img.dataset.artist, img.dataset.title, img);
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

    // Wire seed checkboxes
    function updateSeedCount() {
        const countEl = document.getElementById("ws-seed-count");
        const genBtn = document.getElementById("ws-btn-seed-generate");
        if (countEl) countEl.textContent = wsSelectedSeeds.size;
        if (genBtn) genBtn.disabled = wsSelectedSeeds.size === 0;
    }

    container.querySelectorAll(".ws-seed-cb").forEach(cb => {
        cb.addEventListener("change", () => {
            const tid = parseInt(cb.dataset.seedId);
            if (cb.checked) {
                wsSelectedSeeds.add(tid);
                cb.closest("tr").classList.add("ws-seed-selected");
            } else {
                wsSelectedSeeds.delete(tid);
                cb.closest("tr").classList.remove("ws-seed-selected");
            }
            updateSeedCount();
        });
    });

    // Toggle all seeds
    const toggleAll = document.getElementById("ws-seed-toggle-all");
    if (toggleAll) {
        toggleAll.addEventListener("change", () => {
            const checked = toggleAll.checked;
            container.querySelectorAll(".ws-seed-cb").forEach(cb => {
                const tid = parseInt(cb.dataset.seedId);
                cb.checked = checked;
                if (checked) {
                    wsSelectedSeeds.add(tid);
                    cb.closest("tr").classList.add("ws-seed-selected");
                } else {
                    wsSelectedSeeds.delete(tid);
                    cb.closest("tr").classList.remove("ws-seed-selected");
                }
            });
            updateSeedCount();
        });
    }

    // Wire generate from selection button
    document.getElementById("ws-btn-seed-generate").addEventListener("click", () => {
        if (wsSelectedSeeds.size === 0) return;
        generateSuggestions("seed", { seed_track_ids: Array.from(wsSelectedSeeds) });
        document.getElementById("ws-suggestions-list").scrollIntoView({ behavior: "smooth" });
    });
}

// ── LLM Reranking ───────────────────────────────────────────

async function runLLMRerank(candidateTracks, playlistName, description) {
    const statusEl = document.getElementById("ws-refine-status");
    const btn = document.getElementById("ws-btn-llm-refine");
    if (statusEl) statusEl.textContent = "AI is selecting the best tracks...";
    if (btn) btn.disabled = true;

    const tracks = candidateTracks.map(t => ({
        id: t.id,
        artist: t.artist || "",
        title: t.title || "",
        bpm: t.bpm || "",
        key: t.key || "",
        comment: t.comment || "",
    }));

    try {
        const res = await fetch("/api/workshop/rerank", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tracks,
                playlist_name: playlistName || "Playlist",
                description: description || "",
                target_count: 25,
            }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Reranking failed");
        }
        const data = await res.json();

        wsSearchResults = data.tracks || [];
        wsSearchTrackIds = data.track_ids || [];

        if (statusEl) statusEl.textContent = `AI selected ${data.count} tracks`;
        renderRerankedResults(wsSearchResults, data.flow_notes);
    } catch (err) {
        if (statusEl) statusEl.textContent = `Refinement failed: ${err.message}`;
        console.error(err);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function renderRerankedResults(tracks, flowNotes) {
    const container = $("#ws-search-results");
    if (tracks.length === 0) {
        container.innerHTML = '<p class="ws-placeholder">No tracks selected by AI.</p>';
        return;
    }

    container.innerHTML = `
        <div class="ws-results-toolbar">
            <button class="btn btn-primary btn-sm" id="ws-btn-add-all">Add All (${tracks.length}) to Playlist</button>
            ${flowNotes ? `<span class="ws-flow-notes" title="${escapeHtml(flowNotes)}">AI flow notes</span>` : ""}
        </div>
        ${flowNotes ? `<p class="ws-rerank-notes">${escapeHtml(flowNotes)}</p>` : ""}
        <table class="ws-results-table">
            <thead>
                <tr>
                    <th></th><th>#</th><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th><th>Year</th><th>AI Reason</th><th></th>
                </tr>
            </thead>
            <tbody>
                ${tracks.map((t, i) => `
                    <tr>
                        <td class="ws-preview-cell"><img class="track-artwork" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" alt=""><button class="btn-preview" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" title="Play 30s preview">\u25B6</button></td>
                        <td>${i + 1}</td>
                        <td title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</td>
                        <td title="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</td>
                        <td>${t.bpm ? Math.round(parseFloat(t.bpm)) : ""}</td>
                        <td>${escapeHtml(t.key)}</td>
                        <td>${t.year && t.year !== "0" ? Math.round(parseFloat(t.year)) : ""}</td>
                        <td class="ws-reason-cell" title="${escapeHtml(t.reason || '')}">${escapeHtml(t.reason || "")}</td>
                        <td><button class="btn btn-sm btn-secondary" data-add-id="${t.id}">+ Playlist</button></td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;

    // Wire preview buttons
    container.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(btn.dataset.artist, btn.dataset.title, btn);
        });
    });
    // Load artwork
    container.querySelectorAll(".track-artwork").forEach(img => {
        loadArtwork(img.dataset.artist, img.dataset.title, img);
    });

    // Wire add-all and per-track add buttons
    document.getElementById("ws-btn-add-all").addEventListener("click", () => {
        showAddToPlaylistModal(wsSearchTrackIds);
    });
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
            <button class="btn btn-secondary btn-sm" id="ws-pl-export-m3u">Export M3U8 (Lexicon)</button>
            <button class="btn btn-secondary btn-sm" id="ws-pl-export-csv">Export CSV</button>
            <button class="btn btn-danger btn-sm" id="ws-pl-delete">Delete</button>
        </div>
        ${playlistTracks.length > 0 ? `
            <table class="ws-pl-tracks">
                <thead>
                    <tr><th></th><th>#</th>${th("Title","title")}${th("Artist","artist")}${th("BPM","bpm")}${th("Key","key")}${th("Year","year")}${th("Comment","comment")}<th></th></tr>
                </thead>
                <tbody>
                    ${playlistTracks.map((t, i) => `
                        <tr data-tid="${t.id}">
                            <td class="ws-preview-cell"><img class="track-artwork" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" alt=""><button class="btn-preview" data-artist="${escapeHtml(t.artist)}" data-title="${escapeHtml(t.title)}" title="Play 30s preview">\u25B6</button></td>
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

    // Wire preview buttons
    detail.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(btn.dataset.artist, btn.dataset.title, btn);
        });
    });
    // Load artwork
    detail.querySelectorAll(".track-artwork").forEach(img => {
        loadArtwork(img.dataset.artist, img.dataset.title, img);
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
