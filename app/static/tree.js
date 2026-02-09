/* ── Collection Tree — Frontend ───────────────────────────── */

let treeData = null;
let expandedNodes = new Set();
let treeBuilding = false;
let treeEventSource = null;
let createdPlaylistNodeIds = new Set(); // track which leaves have been saved

// DOM refs (lazy, tab may not exist yet)
function _t(sel) { return document.querySelector(sel); }

// ── Init ────────────────────────────────────────────────────

async function initTree() {
    // Wire up buttons
    _t("#tree-build-btn").addEventListener("click", startTreeBuild);
    _t("#tree-stop-btn").addEventListener("click", stopTreeBuild);
    _t("#tree-create-all-btn").addEventListener("click", createAllPlaylists);
    _t("#tree-rebuild-btn").addEventListener("click", rebuildTree);

    // Check for existing tree
    try {
        const res = await fetch("/api/tree");
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            showTreeView();
        }
    } catch (e) {
        console.error("Failed to load tree:", e);
    }
}

// ── Build ───────────────────────────────────────────────────

async function startTreeBuild() {
    const buildBtn = _t("#tree-build-btn");
    const progress = _t("#tree-progress");

    buildBtn.disabled = true;
    progress.classList.remove("hidden");
    treeBuilding = true;

    try {
        const res = await fetch("/api/tree/build", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || "Failed to start build");
            buildBtn.disabled = false;
            progress.classList.add("hidden");
            treeBuilding = false;
            return;
        }
    } catch (e) {
        alert("Failed to start tree build: " + e.message);
        buildBtn.disabled = false;
        progress.classList.add("hidden");
        treeBuilding = false;
        return;
    }

    // Connect to SSE progress stream
    treeEventSource = new EventSource("/api/tree/progress");
    treeEventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.event === "progress") {
            updateBuildProgress(msg.phase, msg.detail, msg.percent);
        }

        if (msg.event === "done") {
            finishTreeBuild();
        }

        if (msg.event === "error") {
            alert("Tree build error: " + (msg.detail || "Unknown error"));
            finishTreeBuild();
        }

        if (msg.event === "stopped") {
            finishTreeBuild();
        }
    };
    treeEventSource.onerror = () => {
        finishTreeBuild();
    };
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
        "complete": "Complete!",
    };
    _t("#tree-progress-phase").textContent = phaseLabels[phase] || phase;
    _t("#tree-progress-detail").textContent = detail || "";
    _t("#tree-progress-bar").style.width = (percent || 0) + "%";
}

async function finishTreeBuild() {
    if (treeEventSource) {
        treeEventSource.close();
        treeEventSource = null;
    }
    treeBuilding = false;

    // Load the tree
    try {
        const res = await fetch("/api/tree");
        const data = await res.json();
        if (data.tree) {
            treeData = data.tree;
            showTreeView();
        } else {
            // No tree built (error or stopped early)
            _t("#tree-build-btn").disabled = false;
            _t("#tree-progress").classList.add("hidden");
        }
    } catch (e) {
        _t("#tree-build-btn").disabled = false;
        _t("#tree-progress").classList.add("hidden");
    }
}

async function stopTreeBuild() {
    try {
        await fetch("/api/tree/stop", { method: "POST" });
    } catch (e) {
        console.error("Failed to stop build:", e);
    }
}

async function rebuildTree() {
    if (!confirm("Delete the current tree and rebuild from scratch?")) return;
    try {
        await fetch("/api/tree", { method: "DELETE" });
    } catch (e) { /* ignore */ }
    treeData = null;
    expandedNodes.clear();
    createdPlaylistNodeIds.clear();
    _t("#tree-view-section").classList.add("hidden");
    _t("#tree-build-section").style.display = "";
    _t("#tree-build-btn").disabled = false;
    _t("#tree-progress").classList.add("hidden");
}

// ── Display ─────────────────────────────────────────────────

function showTreeView() {
    _t("#tree-build-section").style.display = "none";
    _t("#tree-view-section").classList.remove("hidden");
    renderTreeHeader();
    renderTreeGrid();
    renderUngrouped();
}

function renderTreeHeader() {
    const tree = treeData;
    if (!tree) return;

    const leafCount = countLeaves(tree.lineages);
    const ungroupedCount = (tree.ungrouped_track_ids || []).length;
    const statusBadge = tree.status === "complete"
        ? ""
        : `<span class="tree-stat-badge tree-stat-warning">${tree.status}</span>`;

    _t("#tree-header").innerHTML = `
        <div class="tree-stats">
            <div class="tree-stat">
                <span class="tree-stat-number">${tree.total_tracks}</span>
                <span class="tree-stat-label">Total Tracks</span>
            </div>
            <div class="tree-stat">
                <span class="tree-stat-number">${tree.lineages.length}</span>
                <span class="tree-stat-label">Lineages</span>
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
        card.innerHTML = `
            <div class="tree-card-header">
                <h3 class="tree-title">${esc(lineage.title)}</h3>
                <p class="tree-subtitle">${esc(lineage.subtitle || `${lineage.track_count} tracks`)}</p>
            </div>
            <div class="tree-card-desc">${esc(lineage.description)}</div>
            <div class="tree-content" id="tree-lineage-${lineage.id}"></div>
        `;
        grid.appendChild(card);

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
                <div class="tree-examples-title">Example Tracks</div>`;
            for (const ex of node.examples) {
                html += `<div class="tree-example-track">
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

        // Wire up create button
        const createBtn = bodyEl.querySelector(".tree-create-pl-btn");
        if (createBtn && !isCreated) {
            createBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                createPlaylistFromLeaf(node.id, createBtn);
            });
        }
    } else {
        // Branch content: description + children
        if (node.description) {
            const descEl = document.createElement("p");
            descEl.className = "tree-node-description tree-branch-desc";
            descEl.textContent = node.description;
            bodyEl.appendChild(descEl);
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

    section.innerHTML = `
        <div class="tree-ungrouped-header">
            <button class="tree-ungrouped-toggle" id="tree-ungrouped-toggle">
                <span class="tree-node-icon">&#9654;</span>
                <span>Ungrouped Tracks</span>
                <span class="tree-node-count">${ungroupedIds.length} tracks</span>
            </button>
            <p class="tree-ungrouped-hint">Tracks that didn't fit neatly into any branch. These may represent niche areas worth exploring.</p>
        </div>
        <div id="tree-ungrouped-body" class="hidden">
            <p class="tree-ungrouped-loading">Loading tracks...</p>
        </div>
    `;

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
                    const res = await fetch("/api/tree/ungrouped");
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
            <td><button class="btn-preview" data-artist="${esc(t.artist || "")}" data-title="${esc(t.title || "")}" title="Play 30s preview">\u25B6</button></td>
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
}

// ── Playlist Creation ───────────────────────────────────────

async function createPlaylistFromLeaf(nodeId, btn) {
    btn.disabled = true;
    btn.textContent = "Curating with AI...";

    try {
        const res = await fetch("/api/tree/create-playlist", {
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
    const leafCount = countLeaves(treeData.lineages);
    if (!confirm(`Create ${leafCount} playlists from all leaf nodes?`)) return;

    const btn = _t("#tree-create-all-btn");
    btn.disabled = true;
    btn.textContent = "Creating...";

    try {
        const res = await fetch("/api/tree/create-all-playlists", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            btn.textContent = `${data.count} Playlists Created`;
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-secondary");
            // Mark all leaves as created
            markAllLeavesCreated(treeData.lineages);
            // Re-render to update buttons
            renderTreeGrid();
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
