/* ── Collection Tree — Frontend ───────────────────────────── */

// Current tree type
let currentTreeType = "collection";

// Per-type state
const treeState = {
    genre: {
        data: null,
        expandedNodes: new Set(),
        createdPlaylistNodeIds: new Set(),
        apiPrefix: "/api/tree",
    },
    scene: {
        data: null,
        expandedNodes: new Set(),
        createdPlaylistNodeIds: new Set(),
        apiPrefix: "/api/scene-tree",
    },
    collection: {
        data: null,
        expandedNodes: new Set(),
        createdPlaylistNodeIds: new Set(),
        apiPrefix: "/api/collection-tree",
        activeCategory: null,
    },
};

// Active aliases (swapped on type switch)
let treeData = null;
let expandedNodes = new Set();
let createdPlaylistNodeIds = new Set();

let treeBuilding = false;
let treeEventSource = null;

// Tree type display metadata
const TREE_TYPE_INFO = {
    genre: {
        title: "Genre Tree",
        description: "Build an interactive map of the musical lineages and evolutionary paths in your collection. Organises by genre family trees — broad traditions that branch into sub-genres and movements.",
        buildLabel: "Build Genre Tree",
    },
    scene: {
        title: "Scene Explorer",
        description: "Map your collection by musical scenes — cohesive cultural moments anchored to specific places and times. Discover the geographic and temporal movements that shaped the music you love.",
        buildLabel: "Build Scene Tree",
    },
    collection: {
        title: "Collection",
        description: "A curated map of your collection built by cross-referencing genre lineages with cultural scenes. Reveals the unique intersections and identities in your music. Requires both Genre and Scene trees to be built first.",
        buildLabel: "Build Collection",
    },
};

// DOM refs (lazy, tab may not exist yet)
function _t(sel) { return document.querySelector(sel); }

function apiUrl(path) {
    return treeState[currentTreeType].apiPrefix + (path || "");
}

function findTreeNode(nodeId) {
    if (!treeData) return null;
    // Standard hierarchical tree search
    if (treeData.lineages) {
        for (const lineage of treeData.lineages) {
            if (lineage.id === nodeId) return lineage;
            const found = _findInChildren(lineage, nodeId);
            if (found) return found;
        }
    }
    // Flat collection tree search
    if (treeData.categories) {
        for (const cat of treeData.categories) {
            if (cat.id === nodeId) return cat;
            for (const leaf of (cat.leaves || [])) {
                if (leaf.id === nodeId) return leaf;
            }
        }
    }
    return null;
}
function _findInChildren(node, nodeId) {
    for (const child of (node.children || [])) {
        if (child.id === nodeId) return child;
        const found = _findInChildren(child, nodeId);
        if (found) return found;
    }
    return null;
}

// ── Init ────────────────────────────────────────────────────

async function initTree() {
    // Wire up buttons
    _t("#tree-build-btn").addEventListener("click", () => startTreeBuild(false));
    _t("#tree-resume-btn").addEventListener("click", () => startTreeBuild(false));
    _t("#tree-test-btn").addEventListener("click", () => startTreeBuild(true));
    _t("#tree-stop-btn").addEventListener("click", stopTreeBuild);
    _t("#tree-create-all-btn").addEventListener("click", createAllPlaylists);
    _t("#tree-rebuild-btn").addEventListener("click", rebuildTree);

    // Wire tree type selector
    document.querySelectorAll(".tree-type-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            switchTreeType(btn.dataset.treeType);
        });
    });

    // Load the default (collection) tree
    try {
        const res = await fetch(apiUrl());
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            treeState.collection.data = data.tree;
            showTreeView();
        }
    } catch (e) {
        console.error("Failed to load tree:", e);
    }
}

// ── Tree Type Switching ─────────────────────────────────────

function switchTreeType(type) {
    if (type === currentTreeType) return;

    // Save current state back
    treeState[currentTreeType].data = treeData;
    treeState[currentTreeType].expandedNodes = expandedNodes;
    treeState[currentTreeType].createdPlaylistNodeIds = createdPlaylistNodeIds;

    // Switch
    currentTreeType = type;
    treeData = treeState[type].data;
    expandedNodes = treeState[type].expandedNodes;
    createdPlaylistNodeIds = treeState[type].createdPlaylistNodeIds;

    // Update selector buttons
    document.querySelectorAll(".tree-type-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.treeType === type);
    });

    // Update intro text
    const info = TREE_TYPE_INFO[type];
    const titleEl = _t("#tree-intro-title");
    const descEl = _t("#tree-intro-desc");
    if (titleEl) titleEl.textContent = info.title;
    if (descEl) descEl.textContent = info.description;
    _t("#tree-build-btn").textContent = info.buildLabel;

    // Show/hide test + resume buttons (only for collection builds)
    const testBtn = _t("#tree-test-btn");
    const resumeBtn = _t("#tree-resume-btn");
    if (type === "collection") {
        if (testBtn) testBtn.classList.remove("hidden");
    } else {
        if (testBtn) testBtn.classList.add("hidden");
        if (resumeBtn) resumeBtn.classList.add("hidden");
    }

    // Show the right view
    if (treeData) {
        showTreeView();
    } else {
        // Try loading from server
        loadTreeForType(type);
    }
}

async function loadTreeForType(type) {
    // Reset to build state while we check
    _t("#tree-view-section").classList.add("hidden");
    _t("#tree-build-section").style.display = "";
    _t("#tree-build-btn").disabled = false;
    _t("#tree-progress").classList.add("hidden");

    // Hide resume button by default
    const resumeBtn = _t("#tree-resume-btn");
    if (resumeBtn) resumeBtn.classList.add("hidden");

    try {
        const res = await fetch(treeState[type].apiPrefix);
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            treeState[type].data = data.tree;
            showTreeView();
        } else if (data.has_checkpoint && type === "collection" && resumeBtn) {
            // Show resume button with checkpoint info
            const phaseNames = ["", "Intersections", "Naming", "Reassignment",
                                "Quality", "Grouping", "Descriptions", "Enrichment"];
            const phaseName = phaseNames[data.checkpoint_phase] || "?";
            resumeBtn.textContent = `Resume (from ${phaseName})`;
            resumeBtn.classList.remove("hidden");
        }
    } catch (e) {
        console.error("Failed to load tree:", e);
    }
}

// ── Build ───────────────────────────────────────────────────

// Collection tree phase definitions for the timeline
const COLLECTION_PHASES = [
    { key: "intersection_matrix", label: "Intersections", icon: "1" },
    { key: "cluster_naming",      label: "Naming",        icon: "2" },
    { key: "reassignment",        label: "Reassigning",   icon: "3" },
    { key: "quality_scoring",     label: "Quality",       icon: "4" },
    { key: "grouping",            label: "Grouping",      icon: "5" },
    { key: "final_descriptions",  label: "Descriptions",  icon: "6" },
    { key: "enrichment",          label: "Enrichment",    icon: "7" },
];

// Narrative descriptions for each collection build phase
const PHASE_NARRATIVES = {
    intersection_matrix: {
        title: "Finding natural clusters",
        body: "Your Genre tree organises tracks by musical lineage — House, Techno, Breaks. " +
              "Your Scene tree organises by cultural moment — Berlin Minimal, Balearic Summers. " +
              "Right now, we're cross-referencing every leaf from both trees to find tracks that " +
              "live at the intersection of both a genre identity and a cultural context. These " +
              "intersections reveal natural clusters — groups of tracks that share something deeper " +
              "than just a genre label.",
    },
    cluster_naming: {
        title: "Giving each cluster its identity",
        body: "Each intersection is now a seed cluster — a group of tracks that share both a genre " +
              "lineage and a cultural scene. We're sending sample tracks from each cluster to the " +
              "LLM, asking it to listen to the pattern and give it a name that captures the vibe: " +
              "not just \"Deep House\" but something like \"Late-Night Tokyo Micro-House\" or " +
              "\"Berlin Dub Techno After-Hours\". The LLM also scores each cluster's coherence and " +
              "flags tracks that don't quite fit.",
    },
    reassignment: {
        title: "Making sure every track finds its home",
        body: "Some tracks appeared in multiple seed clusters (a track can sit at the intersection " +
              "of several genre/scene pairs). Others weren't in any cluster at all. This phase " +
              "resolves that: every track gets assigned to exactly one cluster. We run multiple " +
              "passes — each time, the LLM looks at orphaned or poorly-fit tracks and finds them " +
              "a better home. We stop when less than 5% of tracks are moving between passes.",
    },
    quality_scoring: {
        title: "Refining the collection",
        body: "Now we quality-check every cluster. The LLM scores each one for coherence — do these " +
              "tracks actually belong together? Clusters that are too similar get merged. Clusters " +
              "that are too diverse or too large get split into more focused sub-groups. This " +
              "iterates up to three times, converging toward ~150 tightly-curated collections " +
              "where every cluster scores 7/10 or higher.",
    },
    grouping: {
        title: "Organising into browsable categories",
        body: "With ~150 refined clusters, we now need a way to browse them. The LLM groups " +
              "related clusters into 8-12 top-level categories — like a world-class record store " +
              "organising its sections. The grouping is bottom-up: based on shared musical DNA, " +
              "cultural affinity, and dancefloor energy rather than rigid genre boundaries.",
    },
    final_descriptions: {
        title: "Writing the liner notes",
        body: "Each collection now gets the full treatment: a rich, evocative description that " +
              "captures the sound, the cultural moment, and what connects these tracks beyond " +
              "simple genre labels. The LLM also picks 7 exemplar tracks per collection — the " +
              "most representative tracks that best capture the essence of that particular corner " +
              "of your music library.",
    },
    enrichment: {
        title: "Suggesting metadata improvements",
        body: "The final phase looks at each track in the context of its collection and suggests " +
              "ways to improve your metadata: more specific sub-genres, scene tags you might be " +
              "missing, production descriptors, or more precise era information. These suggestions " +
              "are saved for your review — nothing is changed automatically. Only high-confidence " +
              "suggestions (70%+) are kept.",
    },
    complete: {
        title: "Collection built!",
        body: "Your collection tree is ready to explore. Every track has been assigned to exactly " +
              "one collection, grouped into browsable categories. You can create playlists from " +
              "any collection, push them to the Set Workshop, or review the metadata suggestions.",
    },
};

let _currentNarrativePhase = null;

let _buildStartTime = null;

function _initProgressUI() {
    const phasesEl = _t("#tree-progress-phases");
    const logEl = _t("#tree-progress-log");
    const errorEl = _t("#tree-progress-error");
    const logEntries = _t("#tree-progress-log-entries");

    const narrativeEl = _t("#tree-progress-narrative");

    if (currentTreeType === "collection") {
        // Show phase timeline + narrative for collection builds
        phasesEl.classList.remove("hidden");
        logEl.classList.remove("hidden");
        narrativeEl.classList.remove("hidden");
        phasesEl.innerHTML = COLLECTION_PHASES.map(p =>
            `<div class="progress-phase-step" data-phase="${p.key}">` +
            `<span class="progress-phase-icon">${p.icon}</span>` +
            `<span class="progress-phase-label">${p.label}</span>` +
            `</div>`
        ).join("");
        _currentNarrativePhase = null;
    } else {
        phasesEl.classList.add("hidden");
        logEl.classList.add("hidden");
        narrativeEl.classList.add("hidden");
    }
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    if (logEntries) logEntries.innerHTML = "";
    _buildStartTime = Date.now();
}

function _addLogEntry(detail, isError = false) {
    const logEntries = _t("#tree-progress-log-entries");
    if (!logEntries) return;
    const elapsed = _buildStartTime ? Math.round((Date.now() - _buildStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timestamp = `${mins}:${String(secs).padStart(2, "0")}`;
    const entry = document.createElement("div");
    entry.className = "progress-log-entry" + (isError ? " log-error" : "");
    entry.innerHTML = `<span class="log-time">${timestamp}</span> ${detail}`;
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;

    // Keep only last 50 entries
    while (logEntries.children.length > 50) {
        logEntries.removeChild(logEntries.firstChild);
    }
}

function _updateNarrative(phase) {
    if (phase === _currentNarrativePhase) return;
    _currentNarrativePhase = phase;
    const narrative = PHASE_NARRATIVES[phase];
    const titleEl = _t("#tree-progress-narrative-title");
    const bodyEl = _t("#tree-progress-narrative-body");
    if (!narrative || !titleEl || !bodyEl) return;

    // Fade transition
    const container = _t("#tree-progress-narrative");
    container.classList.add("narrative-fading");
    setTimeout(() => {
        titleEl.textContent = narrative.title;
        bodyEl.textContent = narrative.body;
        container.classList.remove("narrative-fading");
    }, 200);
}

function _updatePhaseTimeline(currentPhase) {
    const steps = document.querySelectorAll("#tree-progress-phases .progress-phase-step");
    let foundCurrent = false;
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        const key = step.dataset.phase;
        if (key === currentPhase) {
            step.classList.add("active");
            step.classList.remove("done");
            foundCurrent = true;
        } else if (foundCurrent) {
            // Phases before current are done
            step.classList.add("done");
            step.classList.remove("active");
        } else {
            // Phases after current are pending
            step.classList.remove("active", "done");
        }
    }
}

async function startTreeBuild(testMode = false) {
    const buildBtn = _t("#tree-build-btn");
    const resumeBtn = _t("#tree-resume-btn");
    const testBtn = _t("#tree-test-btn");
    const progress = _t("#tree-progress");

    buildBtn.disabled = true;
    if (resumeBtn) resumeBtn.disabled = true;
    if (testBtn) testBtn.disabled = true;
    progress.classList.remove("hidden");
    treeBuilding = true;
    _initProgressUI();

    const buildUrl = testMode ? apiUrl("/build?test=1") : apiUrl("/build");
    try {
        const res = await fetch(buildUrl, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            _showBuildError(data.error || "Failed to start build");
            buildBtn.disabled = false;
            treeBuilding = false;
            return;
        }
    } catch (e) {
        _showBuildError("Failed to start tree build: " + e.message);
        buildBtn.disabled = false;
        treeBuilding = false;
        return;
    }

    // Connect to SSE progress stream
    treeEventSource = new EventSource(apiUrl("/progress"));
    treeEventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.event === "progress") {
            updateBuildProgress(msg.phase, msg.detail, msg.percent);
        }

        if (msg.event === "done") {
            _addLogEntry("Build complete!");
            finishTreeBuild();
        }

        if (msg.event === "error") {
            _showBuildError(msg.detail || "Unknown error");
            _addLogEntry("ERROR: " + (msg.detail || "Unknown error"), true);
            finishTreeBuild();
        }

        if (msg.event === "stopped") {
            _addLogEntry("Build stopped by user");
            finishTreeBuild();
        }
    };
    treeEventSource.onerror = () => {
        finishTreeBuild();
    };
}

function _showBuildError(message) {
    const errorEl = _t("#tree-progress-error");
    errorEl.classList.remove("hidden");
    errorEl.textContent = message;
}

function updateBuildProgress(phase, detail, percent) {
    const phaseLabels = {
        "analyzing": "Analyzing Collection",
        "lineages": "Identifying Lineages",
        "assigning": "Assigning Tracks",
        "primary_branches": "Building Primary Branches",
        "secondary_branches": "Building Secondary Branches",
        "tertiary_branches": "Building Tertiary Branches",
        "finalizing_leaves": "Finalizing Leaf Nodes",
        "lineage_examples": "Selecting Exemplar Tracks",
        "branch_examples": "Selecting Branch Exemplars",
        "refreshing_examples": "Refreshing Exemplar Tracks",
        // Collection tree phases
        "intersection_matrix": "Computing Intersections",
        "cluster_naming": "Naming Clusters",
        "reassignment": "Reassigning Tracks",
        "quality_scoring": "Scoring Cluster Quality",
        "grouping": "Grouping Categories",
        "final_descriptions": "Writing Descriptions",
        "enrichment": "Enriching Metadata",
        "complete": "Complete!",
    };
    _t("#tree-progress-phase").textContent = phaseLabels[phase] || phase;
    _t("#tree-progress-detail").textContent = detail || "";
    _t("#tree-progress-bar").style.width = (percent || 0) + "%";

    // Update phase timeline, narrative + activity log for collection builds
    if (currentTreeType === "collection") {
        _updatePhaseTimeline(phase);
        _updateNarrative(phase);
        _addLogEntry(detail);
    }
}

async function finishTreeBuild() {
    if (treeEventSource) {
        treeEventSource.close();
        treeEventSource = null;
    }
    treeBuilding = false;
    _buildStartTime = null;

    // Load the tree
    try {
        const res = await fetch(apiUrl());
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            treeState[currentTreeType].data = data.tree;
            showTreeView();
        } else {
            // No tree built (error or stopped early) — check for checkpoint
            _t("#tree-build-btn").disabled = false;
            const testBtn = _t("#tree-test-btn");
            if (testBtn) testBtn.disabled = false;
            const resumeBtn = _t("#tree-resume-btn");
            if (resumeBtn) {
                resumeBtn.disabled = false;
                if (data.has_checkpoint && currentTreeType === "collection") {
                    const phaseNames = ["", "Intersections", "Naming", "Reassignment",
                                        "Quality", "Grouping", "Descriptions", "Enrichment"];
                    const phaseName = phaseNames[data.checkpoint_phase] || "?";
                    resumeBtn.textContent = `Resume (from ${phaseName})`;
                    resumeBtn.classList.remove("hidden");
                } else {
                    resumeBtn.classList.add("hidden");
                }
            }
        }
    } catch (e) {
        _t("#tree-build-btn").disabled = false;
        const testBtn = _t("#tree-test-btn");
        if (testBtn) testBtn.disabled = false;
        const resumeBtn = _t("#tree-resume-btn");
        if (resumeBtn) resumeBtn.disabled = false;
    }
}

async function stopTreeBuild() {
    try {
        await fetch(apiUrl("/stop"), { method: "POST" });
    } catch (e) {
        console.error("Failed to stop build:", e);
    }
}

async function rebuildTree() {
    const typeName = TREE_TYPE_INFO[currentTreeType].title;
    if (!confirm(`Delete the current ${typeName} and rebuild from scratch?`)) return;
    try {
        await fetch(apiUrl(), { method: "DELETE" });
    } catch (e) { /* ignore */ }
    treeData = null;
    expandedNodes.clear();
    createdPlaylistNodeIds.clear();
    treeState[currentTreeType].data = null;
    _t("#tree-view-section").classList.add("hidden");
    _t("#tree-build-section").style.display = "";
    _t("#tree-build-btn").disabled = false;
    _t("#tree-progress").classList.add("hidden");
    const resumeBtn = _t("#tree-resume-btn");
    if (resumeBtn) resumeBtn.classList.add("hidden");
}

// ── Display ─────────────────────────────────────────────────

function showTreeView() {
    _t("#tree-build-section").style.display = "none";
    _t("#tree-view-section").classList.remove("hidden");

    if (currentTreeType === "collection") {
        // Hide standard tree elements, show collection view
        _t("#tree-header").classList.add("hidden");
        _t("#tree-grid").classList.add("hidden");
        _t("#tree-ungrouped").innerHTML = "";
        const cv = _t("#collection-view");
        if (cv) cv.classList.remove("hidden");
        renderCollectionTreeView();
    } else {
        // Hide collection view, show standard tree
        const cv = _t("#collection-view");
        if (cv) cv.classList.add("hidden");
        _t("#tree-header").classList.remove("hidden");
        _t("#tree-grid").classList.remove("hidden");
        renderTreeHeader();
        renderTreeGrid();
        renderUngrouped();
    }
}

function renderTreeHeader() {
    const tree = treeData;
    if (!tree) return;

    const leafCount = countLeaves(tree.lineages);
    const ungroupedCount = (tree.ungrouped_track_ids || []).length;
    const statusBadge = tree.status === "complete"
        ? ""
        : `<span class="tree-stat-badge tree-stat-warning">${tree.status}</span>`;

    const typeLabel = currentTreeType === "scene" ? "Scenes" : "Lineages";

    _t("#tree-header").innerHTML = `
        <div class="tree-stats">
            <div class="tree-stat">
                <span class="tree-stat-number">${tree.total_tracks}</span>
                <span class="tree-stat-label">Total Tracks</span>
            </div>
            <div class="tree-stat">
                <span class="tree-stat-number">${tree.lineages.length}</span>
                <span class="tree-stat-label">${typeLabel}</span>
            </div>
            <div class="tree-stat">
                <span class="tree-stat-number">${leafCount}</span>
                <span class="tree-stat-label">Leaf Playlists</span>
            </div>
            <div class="tree-stat">
                <span class="tree-stat-number">${tree.assigned_tracks}</span>
                <span class="tree-stat-label">Assigned</span>
            </div>
            <div class="tree-stat">
                <span class="tree-stat-number">${ungroupedCount}</span>
                <span class="tree-stat-label">Ungrouped</span>
            </div>
            ${statusBadge}
        </div>
    `;
}

function renderTreeGrid() {
    const grid = _t("#tree-grid");
    grid.innerHTML = "";

    for (const lineage of treeData.lineages) {
        const card = document.createElement("div");
        card.className = "tree-container";

        let examplesHtml = "";
        if (lineage.examples && lineage.examples.length > 0) {
            examplesHtml = `<div class="tree-node-examples tree-lineage-examples">
                <div class="tree-examples-title">Exemplar Tracks <button class="btn btn-sm btn-secondary tree-play-all-btn">Play All</button></div>`;
            for (const ex of lineage.examples) {
                examplesHtml += `<div class="tree-example-track">
                    <img class="track-artwork" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" alt="">
                    <button class="btn-preview" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" title="Play 30s preview">\u25B6</button>
                    <span class="tree-track-title">${esc(ex.title)}</span>
                    <span class="tree-track-artist">${esc(ex.artist)}</span>
                    ${ex.year ? `<span class="tree-track-year">${ex.year}</span>` : ""}
                </div>`;
            }
            examplesHtml += `</div>`;
        }

        card.innerHTML = `
            <div class="tree-card-header">
                <h3 class="tree-title">${esc(lineage.title)}</h3>
                <p class="tree-subtitle">${esc(lineage.subtitle || `${lineage.track_count} tracks`)}</p>
            </div>
            <div class="tree-card-desc">${esc(lineage.description)}</div>
            ${examplesHtml}
            <div class="tree-lineage-actions">
                <button class="btn btn-sm btn-secondary tree-download-m3u-btn"
                        data-node-id="${lineage.id}"
                        title="Download all tracks as M3U8 playlist">
                    Download M3U8 (${lineage.track_count} tracks)
                </button>
                <button class="btn btn-sm btn-primary tree-create-lineage-pl-btn"
                        data-node-id="${lineage.id}"
                        ${createdPlaylistNodeIds.has(lineage.id) ? "disabled" : ""}
                        title="Create a Workshop playlist from this lineage">
                    ${createdPlaylistNodeIds.has(lineage.id) ? "Playlist Created" : "Create Playlist"}
                </button>
                <button class="btn btn-sm btn-secondary tree-push-set-btn"
                        data-node-id="${lineage.id}"
                        title="Generate a DJ set from these tracks">
                    Push to Set Workshop
                </button>
            </div>
            <div class="tree-content" id="tree-lineage-${lineage.id}"></div>
        `;
        grid.appendChild(card);

        // Wire preview buttons
        card.querySelectorAll(".tree-lineage-examples .btn-preview").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                togglePreview(btn.dataset.artist, btn.dataset.title, btn);
            });
        });
        // Load artwork
        card.querySelectorAll(".tree-lineage-examples .track-artwork").forEach(img => {
            loadArtwork(img.dataset.artist, img.dataset.title, img);
        });
        // Wire play-all button
        const lineageExamples = card.querySelector(".tree-lineage-examples");
        if (lineageExamples) {
            const playAllBtn = lineageExamples.querySelector(".tree-play-all-btn");
            if (playAllBtn) playAllBtn.addEventListener("click", () => startPlayAll(lineageExamples));
        }

        // Wire download button
        const dlBtn = card.querySelector(".tree-download-m3u-btn");
        if (dlBtn) {
            dlBtn.addEventListener("click", () => {
                window.location = apiUrl(`/node/${lineage.id}/export/m3u`);
            });
        }

        // Wire create playlist button
        const plBtn = card.querySelector(".tree-create-lineage-pl-btn");
        if (plBtn && !createdPlaylistNodeIds.has(lineage.id)) {
            plBtn.addEventListener("click", () => {
                createPlaylistFromLeaf(lineage.id, plBtn);
            });
        }

        // Wire push-to-set button
        const pushBtn = card.querySelector(".tree-push-set-btn");
        if (pushBtn) {
            pushBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const node = findTreeNode(lineage.id);
                if (node && node.track_ids && node.track_ids.length > 0) {
                    pushToSetWorkshop(node.track_ids, node.title || lineage.id, "tree_node", node.id, currentTreeType);
                } else {
                    alert("No tracks found for this node.");
                }
            });
        }

        const contentEl = card.querySelector(`#tree-lineage-${lineage.id}`);
        renderChildren(lineage.children || [], contentEl, 0);
    }
}

function renderChildren(children, parentEl, depth) {
    for (const node of children) {
        const nodeEl = document.createElement("div");
        nodeEl.className = "tree-node";
        nodeEl.style.marginLeft = (depth * 16) + "px";

        const isLeaf = node.is_leaf || !node.children || node.children.length === 0;
        const isExpanded = expandedNodes.has(node.id);
        const hasChildren = !isLeaf && node.children && node.children.length > 0;

        nodeEl.innerHTML = `
            <button class="tree-node-btn ${isExpanded ? "expanded" : ""} ${isLeaf ? "leaf" : ""}"
                    data-node-id="${node.id}">
                <span class="tree-node-icon">${isLeaf ? "&#9835;" : "&#9654;"}</span>
                <span class="tree-node-title">${esc(node.title)}</span>
                <span class="tree-node-count">${node.track_count} tracks</span>
            </button>
            <div class="tree-node-body ${isExpanded ? "" : "hidden"}" id="tree-body-${node.id}"></div>
        `;

        parentEl.appendChild(nodeEl);

        const btn = nodeEl.querySelector(".tree-node-btn");
        const bodyEl = nodeEl.querySelector(`#tree-body-${node.id}`);

        btn.addEventListener("click", () => {
            const nowExpanded = expandedNodes.has(node.id);
            if (nowExpanded) {
                expandedNodes.delete(node.id);
                btn.classList.remove("expanded");
                bodyEl.classList.add("hidden");
            } else {
                expandedNodes.add(node.id);
                btn.classList.add("expanded");
                bodyEl.classList.remove("hidden");
                // Render content if first time
                if (bodyEl.childElementCount === 0) {
                    renderNodeContent(node, bodyEl, depth);
                }
            }
        });

        // If already expanded, render content
        if (isExpanded && bodyEl.childElementCount === 0) {
            renderNodeContent(node, bodyEl, depth);
        }
    }
}

function renderNodeContent(node, bodyEl, depth) {
    const isLeaf = node.is_leaf || !node.children || node.children.length === 0;

    if (isLeaf) {
        // Leaf content: description, examples, create playlist button
        const isCreated = createdPlaylistNodeIds.has(node.id);
        let html = `<div class="tree-node-detail">`;
        if (node.description) {
            html += `<p class="tree-node-description">${esc(node.description)}</p>`;
        }
        if (node.examples && node.examples.length > 0) {
            html += `<div class="tree-node-examples">
                <div class="tree-examples-title">Exemplar Tracks <button class="btn btn-sm btn-secondary tree-play-all-btn">Play All</button></div>`;
            for (const ex of node.examples) {
                html += `<div class="tree-example-track">
                    <img class="track-artwork" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" alt="">
                    <button class="btn-preview" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" title="Play 30s preview">\u25B6</button>
                    <span class="tree-track-title">${esc(ex.title)}</span>
                    <span class="tree-track-artist">${esc(ex.artist)}</span>
                    ${ex.year ? `<span class="tree-track-year">${ex.year}</span>` : ""}
                </div>`;
            }
            html += `</div>`;
        }
        html += `<div class="tree-node-actions">
            <button class="btn btn-primary btn-sm tree-create-pl-btn"
                    data-node-id="${node.id}"
                    ${isCreated ? "disabled" : ""}>
                ${isCreated ? "Playlist Created" : "Create Playlist"}
            </button>
            <button class="btn btn-sm btn-secondary tree-push-set-btn"
                    data-node-id="${node.id}"
                    title="Generate a DJ set from these tracks">
                Push to Set Workshop
            </button>
        </div>`;
        html += `</div>`;
        bodyEl.innerHTML = html;

        // Wire preview buttons
        bodyEl.querySelectorAll(".btn-preview").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                togglePreview(btn.dataset.artist, btn.dataset.title, btn);
            });
        });
        // Load artwork
        bodyEl.querySelectorAll(".track-artwork").forEach(img => {
            loadArtwork(img.dataset.artist, img.dataset.title, img);
        });
        // Wire play-all button
        const leafExamples = bodyEl.querySelector(".tree-node-examples");
        if (leafExamples) {
            const playAllBtn = leafExamples.querySelector(".tree-play-all-btn");
            if (playAllBtn) playAllBtn.addEventListener("click", () => startPlayAll(leafExamples));
        }

        // Wire up create button
        const createBtn = bodyEl.querySelector(".tree-create-pl-btn");
        if (createBtn && !isCreated) {
            createBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                createPlaylistFromLeaf(node.id, createBtn);
            });
        }

        // Wire push-to-set button
        const pushBtn = bodyEl.querySelector(".tree-push-set-btn");
        if (pushBtn) {
            pushBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const n = findTreeNode(node.id);
                if (n && n.track_ids && n.track_ids.length > 0) {
                    pushToSetWorkshop(n.track_ids, n.title || node.id, "tree_node", n.id, currentTreeType);
                } else {
                    alert("No tracks found for this node.");
                }
            });
        }
    } else {
        // Branch content: description + exemplars + actions + children
        const isCreated = createdPlaylistNodeIds.has(node.id);
        let branchHtml = '';
        if (node.description) {
            branchHtml += `<p class="tree-node-description tree-branch-desc">${esc(node.description)}</p>`;
        }
        if (node.examples && node.examples.length > 0) {
            branchHtml += `<div class="tree-node-examples">
                <div class="tree-examples-title">Exemplar Tracks <button class="btn btn-sm btn-secondary tree-play-all-btn">Play All</button></div>`;
            for (const ex of node.examples) {
                branchHtml += `<div class="tree-example-track">
                    <img class="track-artwork" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" alt="">
                    <button class="btn-preview" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" title="Play 30s preview">\u25B6</button>
                    <span class="tree-track-title">${esc(ex.title)}</span>
                    <span class="tree-track-artist">${esc(ex.artist)}</span>
                    ${ex.year ? `<span class="tree-track-year">${ex.year}</span>` : ""}
                </div>`;
            }
            branchHtml += `</div>`;
        }
        branchHtml += `<div class="tree-node-actions">
            <button class="btn btn-sm btn-secondary tree-download-m3u-btn"
                    data-node-id="${node.id}"
                    title="Download all tracks as M3U8 playlist">
                Download M3U8 (${node.track_count} tracks)
            </button>
            <button class="btn btn-sm btn-primary tree-create-pl-btn"
                    data-node-id="${node.id}"
                    ${isCreated ? "disabled" : ""}>
                ${isCreated ? "Playlist Created" : "Create Playlist"}
            </button>
            <button class="btn btn-sm btn-secondary tree-push-set-btn"
                    data-node-id="${node.id}"
                    title="Generate a DJ set from these tracks">
                Push to Set Workshop
            </button>
        </div>`;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = branchHtml;
        bodyEl.appendChild(wrapper);

        // Wire preview buttons
        wrapper.querySelectorAll(".btn-preview").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                togglePreview(btn.dataset.artist, btn.dataset.title, btn);
            });
        });
        // Load artwork
        wrapper.querySelectorAll(".track-artwork").forEach(img => {
            loadArtwork(img.dataset.artist, img.dataset.title, img);
        });
        // Wire play-all button
        const branchExamples = wrapper.querySelector(".tree-node-examples");
        if (branchExamples) {
            const playAllBtn = branchExamples.querySelector(".tree-play-all-btn");
            if (playAllBtn) playAllBtn.addEventListener("click", () => startPlayAll(branchExamples));
        }

        // Wire download button
        const dlBtn = wrapper.querySelector(".tree-download-m3u-btn");
        if (dlBtn) {
            dlBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                window.location = apiUrl(`/node/${node.id}/export/m3u`);
            });
        }

        // Wire create playlist button
        const plBtn = wrapper.querySelector(".tree-create-pl-btn");
        if (plBtn && !isCreated) {
            plBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                createPlaylistFromLeaf(node.id, plBtn);
            });
        }

        // Wire push-to-set button
        const pushBtn = wrapper.querySelector(".tree-push-set-btn");
        if (pushBtn) {
            pushBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const n = findTreeNode(node.id);
                if (n && n.track_ids && n.track_ids.length > 0) {
                    pushToSetWorkshop(n.track_ids, n.title || node.id, "tree_node", n.id, currentTreeType);
                } else {
                    alert("No tracks found for this node.");
                }
            });
        }

        const childContainer = document.createElement("div");
        childContainer.className = "tree-children";
        bodyEl.appendChild(childContainer);
        renderChildren(node.children, childContainer, depth + 1);
    }
}

// ── Ungrouped ───────────────────────────────────────────────

function renderUngrouped() {
    const section = _t("#tree-ungrouped");
    const ungroupedIds = treeData.ungrouped_track_ids || [];
    if (ungroupedIds.length === 0) {
        section.innerHTML = "";
        return;
    }

    const expandBtnHtml = ungroupedIds.length >= 20
        ? `<div class="tree-ungrouped-actions">
               <button id="tree-expand-ungrouped-btn" class="btn btn-primary btn-sm"${treeBuilding ? " disabled" : ""}>
                   Create Lineages from Ungrouped
               </button>
           </div>`
        : "";

    section.innerHTML = `
        <div class="tree-ungrouped-header">
            <button class="tree-ungrouped-toggle" id="tree-ungrouped-toggle">
                <span class="tree-node-icon">&#9654;</span>
                <span>Ungrouped Tracks</span>
                <span class="tree-node-count">${ungroupedIds.length} tracks</span>
            </button>
            <p class="tree-ungrouped-hint">Tracks that didn't fit neatly into any branch. These may represent niche areas worth exploring.</p>
            ${expandBtnHtml}
        </div>
        <div id="tree-ungrouped-body" class="hidden">
            <p class="tree-ungrouped-loading">Loading tracks...</p>
        </div>
    `;

    const expandBtn = _t("#tree-expand-ungrouped-btn");
    if (expandBtn) {
        expandBtn.addEventListener("click", startExpandUngrouped);
    }

    let ungroupedLoaded = false;
    _t("#tree-ungrouped-toggle").addEventListener("click", async () => {
        const body = _t("#tree-ungrouped-body");
        const toggle = _t("#tree-ungrouped-toggle");
        const isHidden = body.classList.contains("hidden");

        if (isHidden) {
            body.classList.remove("hidden");
            toggle.classList.add("expanded");

            if (!ungroupedLoaded) {
                ungroupedLoaded = true;
                try {
                    const res = await fetch(apiUrl("/ungrouped"));
                    const data = await res.json();
                    renderUngroupedTracks(data.tracks || []);
                } catch (e) {
                    body.innerHTML = `<p class="ws-placeholder">Failed to load ungrouped tracks.</p>`;
                }
            }
        } else {
            body.classList.add("hidden");
            toggle.classList.remove("expanded");
        }
    });
}

function renderUngroupedTracks(tracks) {
    const body = _t("#tree-ungrouped-body");
    if (!tracks.length) {
        body.innerHTML = `<p class="ws-placeholder">No ungrouped tracks.</p>`;
        return;
    }

    let html = `<table class="tree-ungrouped-table">
        <thead><tr>
            <th></th><th>Title</th><th>Artist</th><th>BPM</th><th>Year</th><th>Comment</th>
        </tr></thead><tbody>`;

    for (const t of tracks) {
        html += `<tr>
            <td class="ws-preview-cell"><img class="track-artwork" data-artist="${esc(t.artist || "")}" data-title="${esc(t.title || "")}" alt=""><button class="btn-preview" data-artist="${esc(t.artist || "")}" data-title="${esc(t.title || "")}" title="Play 30s preview">\u25B6</button></td>
            <td>${esc(t.title || "")}</td>
            <td>${esc(t.artist || "")}</td>
            <td>${t.bpm || ""}</td>
            <td>${t.year || ""}</td>
            <td class="tree-ungrouped-comment">${esc(t.comment || "")}</td>
        </tr>`;
    }
    html += `</tbody></table>`;
    body.innerHTML = html;

    // Wire preview buttons
    body.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePreview(btn.dataset.artist, btn.dataset.title, btn);
        });
    });
    // Load artwork
    body.querySelectorAll(".track-artwork").forEach(img => {
        loadArtwork(img.dataset.artist, img.dataset.title, img);
    });
}

// ── Expand Ungrouped ─────────────────────────────────────────

async function startExpandUngrouped() {
    const btn = _t("#tree-expand-ungrouped-btn");
    btn.disabled = true;
    btn.textContent = "Analyzing ungrouped tracks...";

    // Insert inline progress bar after the actions div
    const progressEl = document.createElement("div");
    progressEl.id = "tree-expand-progress";
    progressEl.className = "tree-progress";
    progressEl.innerHTML = `
        <div class="tree-progress-header">
            <h3 id="tree-expand-phase">Analyzing ungrouped tracks...</h3>
            <button class="btn btn-danger btn-sm" onclick="stopTreeBuild()">Stop</button>
        </div>
        <div class="tree-progress-bar-container">
            <div id="tree-expand-bar" class="tree-progress-bar"></div>
        </div>
        <p id="tree-expand-detail" class="tree-progress-detail"></p>
    `;
    btn.parentElement.insertAdjacentElement("afterend", progressEl);

    try {
        const res = await fetch(apiUrl("/expand-ungrouped"), { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Failed to start");
            btn.disabled = false;
            btn.textContent = "Create Lineages from Ungrouped";
            progressEl.remove();
            return;
        }
    } catch (e) {
        alert("Failed: " + e.message);
        btn.disabled = false;
        btn.textContent = "Create Lineages from Ungrouped";
        progressEl.remove();
        return;
    }

    treeBuilding = true;
    treeEventSource = new EventSource(apiUrl("/progress"));
    treeEventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === "progress") {
            updateExpandProgress(msg.phase, msg.detail, msg.percent);
        }
        if (msg.event === "done") {
            finishExpandUngrouped();
        }
        if (msg.event === "error") {
            alert("Error: " + (msg.detail || "Unknown error"));
            finishExpandUngrouped();
        }
        if (msg.event === "stopped") {
            finishExpandUngrouped();
        }
    };
    treeEventSource.onerror = () => {
        finishExpandUngrouped();
    };
}

function updateExpandProgress(phase, detail, percent) {
    const phaseLabels = {
        "analyzing": "Analyzing Ungrouped Tracks",
        "lineages": "Identifying New Lineages",
        "assigning": "Assigning Tracks",
        "primary_branches": "Building Primary Branches",
        "secondary_branches": "Building Secondary Branches",
        "tertiary_branches": "Building Tertiary Branches",
        "finalizing_leaves": "Finalizing Leaf Nodes",
        "merging": "Merging into Tree",
        "complete": "Complete!",
    };
    const phaseEl = _t("#tree-expand-phase");
    const detailEl = _t("#tree-expand-detail");
    const barEl = _t("#tree-expand-bar");
    if (phaseEl) phaseEl.textContent = phaseLabels[phase] || phase;
    if (detailEl) detailEl.textContent = detail || "";
    if (barEl) barEl.style.width = (percent || 0) + "%";
}

async function finishExpandUngrouped() {
    if (treeEventSource) {
        treeEventSource.close();
        treeEventSource = null;
    }
    treeBuilding = false;

    const progressEl = _t("#tree-expand-progress");
    if (progressEl) progressEl.remove();

    try {
        const res = await fetch(apiUrl());
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            treeState[currentTreeType].data = data.tree;
            showTreeView();
        }
    } catch (e) {
        console.error("Failed to reload tree:", e);
    }
}

// ── Playlist Creation ───────────────────────────────────────

async function createPlaylistFromLeaf(nodeId, btn) {
    btn.disabled = true;
    btn.textContent = "Curating with AI...";

    try {
        const res = await fetch(apiUrl("/create-playlist"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ node_id: nodeId }),
        });
        const data = await res.json();
        if (res.ok) {
            createdPlaylistNodeIds.add(nodeId);
            const method = data.method === "smart" ? " (AI curated)" : "";
            btn.textContent = "Playlist Created" + method;
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
        } else {
            alert(data.error || "Failed to create playlist");
            btn.disabled = false;
            btn.textContent = "Create Playlist";
        }
    } catch (e) {
        alert("Failed to create playlist: " + e.message);
        btn.disabled = false;
        btn.textContent = "Create Playlist";
    }
}

async function createAllPlaylists() {
    let leafCount;
    if (currentTreeType === "collection" && treeData.categories) {
        leafCount = treeData.categories.reduce(
            (sum, c) => sum + (c.leaves || []).length, 0);
    } else {
        leafCount = countLeaves(treeData.lineages);
    }
    if (!confirm(`Create ${leafCount} playlists from all leaf nodes?`)) return;

    const btn = _t("#tree-create-all-btn");
    btn.disabled = true;
    btn.textContent = "Creating...";

    try {
        const res = await fetch(apiUrl("/create-all-playlists"), { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            btn.textContent = `${data.count} Playlists Created`;
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
            // Mark all leaves as created
            if (currentTreeType === "collection" && treeData.categories) {
                for (const cat of treeData.categories) {
                    for (const leaf of (cat.leaves || [])) {
                        createdPlaylistNodeIds.add(leaf.id);
                    }
                }
                renderCollectionTreeView();
            } else {
                markAllLeavesCreated(treeData.lineages);
                renderTreeGrid();
            }
        } else {
            alert(data.error || "Failed to create playlists");
            btn.disabled = false;
            btn.textContent = "Create All Playlists";
        }
    } catch (e) {
        alert("Failed to create playlists: " + e.message);
        btn.disabled = false;
        btn.textContent = "Create All Playlists";
    }
}

// ── Helpers ─────────────────────────────────────────────────

function countLeaves(nodes) {
    let count = 0;
    for (const node of nodes) {
        if (node.is_leaf || !node.children || node.children.length === 0) {
            count++;
        } else {
            count += countLeaves(node.children);
        }
    }
    return count;
}

function markAllLeavesCreated(nodes) {
    for (const node of nodes) {
        if (node.is_leaf || !node.children || node.children.length === 0) {
            createdPlaylistNodeIds.add(node.id);
        } else {
            markAllLeavesCreated(node.children);
        }
    }
}

function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}


// ══════════════════════════════════════════════════════════════════════
// Collection Tree — category sidebar + flat card grid
// ══════════════════════════════════════════════════════════════════════

function renderCollectionTreeView() {
    const tree = treeData;
    if (!tree || !tree.categories) return;

    // Stats header
    const totalLeaves = tree.categories.reduce(
        (sum, c) => sum + (c.leaves || []).length, 0);
    const headerEl = _t("#collection-header");
    if (headerEl) {
        headerEl.innerHTML = `
            <div class="tree-stats">
                <div class="tree-stat">
                    <span class="tree-stat-number">${tree.total_tracks}</span>
                    <span class="tree-stat-label">Total Tracks</span>
                </div>
                <div class="tree-stat">
                    <span class="tree-stat-number">${tree.categories.length}</span>
                    <span class="tree-stat-label">Categories</span>
                </div>
                <div class="tree-stat">
                    <span class="tree-stat-number">${totalLeaves}</span>
                    <span class="tree-stat-label">Collections</span>
                </div>
                <div class="tree-stat">
                    <span class="tree-stat-number">${tree.assigned_tracks}</span>
                    <span class="tree-stat-label">Assigned</span>
                </div>
            </div>`;
    }

    // Render all categories inline
    const container = _t("#collection-leaves");
    if (!container) return;
    container.innerHTML = "";

    for (const cat of tree.categories) {
        renderCollectionLeaves(cat, container);
    }
}


function renderCollectionLeaves(category, parentContainer) {
    const container = parentContainer || _t("#collection-leaves");
    if (!container) return;

    const section = document.createElement("div");
    section.className = "collection-category-section";
    section.innerHTML = `
        <div class="collection-category-header">
            <h2>${esc(category.title)}</h2>
            <p>${esc(category.description)}</p>
            <div class="collection-category-actions">
                <span class="cc-track-count">${category.track_count} tracks</span>
            </div>
        </div>
        <div class="collection-cards-grid"></div>`;
    container.appendChild(section);

    const grid = section.querySelector(".collection-cards-grid");

    for (const leaf of (category.leaves || [])) {
        const card = document.createElement("div");
        card.className = "collection-card";

        // Exemplar tracks
        let examplesHtml = "";
        if (leaf.examples && leaf.examples.length > 0) {
            examplesHtml = `<div class="collection-card-examples">
                <div class="tree-examples-title">Exemplar Tracks
                    <button class="btn btn-sm btn-secondary tree-play-all-btn">Play All</button>
                </div>`;
            for (const ex of leaf.examples.slice(0, 5)) {
                examplesHtml += `<div class="tree-example-track">
                    <img class="track-artwork" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" alt="">
                    <button class="btn-preview" data-artist="${esc(ex.artist)}" data-title="${esc(ex.title)}" title="Play 30s preview">\u25B6</button>
                    <span class="tree-track-title">${esc(ex.title)}</span>
                    <span class="tree-track-artist">${esc(ex.artist)}</span>
                    ${ex.year ? `<span class="tree-track-year">${ex.year}</span>` : ""}
                </div>`;
            }
            examplesHtml += `</div>`;
        }

        // Context tags
        const contextTags = [];
        if (leaf.genre_context) {
            contextTags.push(`<span class="cc-tag cc-genre">${esc(leaf.genre_context)}</span>`);
        }
        if (leaf.scene_context) {
            contextTags.push(`<span class="cc-tag cc-scene">${esc(leaf.scene_context)}</span>`);
        }
        const tagsHtml = contextTags.length
            ? `<div class="collection-card-tags">${contextTags.join("")}</div>` : "";

        // Metadata badge
        const enrichCount = (leaf.metadata_suggestions || []).length;
        const enrichBadge = enrichCount > 0
            ? `<span class="cc-enrich-badge" title="${enrichCount} metadata suggestions">${enrichCount} suggestions</span>`
            : "";

        const isCreated = createdPlaylistNodeIds.has(leaf.id);
        card.innerHTML = `
            <div class="collection-card-header">
                <h3>${esc(leaf.title)}</h3>
                <span class="tree-node-count">${leaf.track_count} tracks</span>
            </div>
            ${tagsHtml}
            <p class="collection-card-desc">${esc(leaf.description)}</p>
            ${examplesHtml}
            <div class="collection-card-actions">
                <button class="btn btn-primary btn-sm tree-create-pl-btn"
                    data-node-id="${leaf.id}"
                    ${isCreated ? 'disabled style="opacity:0.5"' : ""}>
                    ${isCreated ? "Playlist Created" : "Create Playlist"}
                </button>
                <button class="btn btn-sm btn-secondary tree-push-set-btn"
                    data-node-id="${leaf.id}">Push to Set</button>
                ${enrichBadge}
            </div>`;

        grid.appendChild(card);

        // Wire artwork loading
        card.querySelectorAll(".track-artwork").forEach(img => {
            loadArtwork(img.dataset.artist, img.dataset.title, img);
        });

        // Wire preview buttons
        card.querySelectorAll(".btn-preview").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                togglePreview(btn.dataset.artist, btn.dataset.title, btn);
            });
        });

        // Wire play-all
        const playAllBtn = card.querySelector(".tree-play-all-btn");
        if (playAllBtn) {
            playAllBtn.addEventListener("click", () => {
                const exContainer = card.querySelector(".collection-card-examples");
                if (exContainer) startPlayAll(exContainer);
            });
        }

        // Wire create playlist
        const createBtn = card.querySelector(".tree-create-pl-btn");
        if (createBtn && !isCreated) {
            createBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                createPlaylistFromLeaf(leaf.id, createBtn);
            });
        }

        // Wire push to set
        const pushBtn = card.querySelector(".tree-push-set-btn");
        if (pushBtn) {
            pushBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const n = findTreeNode(leaf.id);
                if (n && n.track_ids && n.track_ids.length > 0) {
                    pushToSetWorkshop(n.track_ids, n.title || leaf.id,
                        "tree_node", n.id, "collection");
                } else {
                    alert("No tracks found for this collection.");
                }
            });
        }
    }
}
