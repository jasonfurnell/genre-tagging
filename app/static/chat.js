/**
 * Chat tab — conversational AI for querying the music collection.
 */

/* global $$ */

let _chatEventSource = null;
let _chatStreaming = false;
let _chatCurrentAssistantEl = null;
let _chatDrawerOpen = false;
let _chatDrawerPlaylistId = null;

const _ch = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initChatTab() {
    _ch("chat-send-btn").addEventListener("click", _chatSend);
    _ch("chat-stop-btn").addEventListener("click", _chatStop);
    _ch("chat-clear-btn").addEventListener("click", _chatClear);

    const input = _ch("chat-input");
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            _chatSend();
        }
    });
    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
        _ch("chat-send-btn").disabled = !input.value.trim();
    });

    // Suggestion chip buttons
    document.querySelectorAll(".chat-suggestion").forEach(btn => {
        btn.addEventListener("click", () => {
            input.value = btn.dataset.msg;
            input.dispatchEvent(new Event("input"));
            _chatSend();
        });
    });

    // Drawer buttons
    _ch("chat-drawer-close").addEventListener("click", _chatCloseDrawer);
    _ch("chat-drawer-push-workshop").addEventListener("click", _chatPushToWorkshop);
    _ch("chat-drawer-push-autoset").addEventListener("click", _chatPushToAutoSet);

    _chatLoadHistory();
}

// ---------------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------------

async function _chatSend() {
    const input = _ch("chat-input");
    const text = input.value.trim();
    if (!text || _chatStreaming) return;

    // Clear welcome on first send and switch to bottom-pinned input
    const welcome = _ch("chat-messages").querySelector(".chat-welcome");
    if (welcome) {
        welcome.remove();
        _ch("chat-messages").closest(".chat-layout").classList.remove("chat-centered");
    }

    _chatAddMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    _ch("chat-send-btn").disabled = true;

    // Switch to streaming mode
    _chatStreaming = true;
    _ch("chat-send-btn").classList.add("hidden");
    _ch("chat-stop-btn").classList.remove("hidden");

    // Create assistant bubble for streaming tokens
    _chatCurrentAssistantEl = _chatAddMessage("assistant", "", true);

    // Connect SSE first, then POST
    _chatConnectSSE();

    try {
        const res = await fetch("/api/chat/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            _chatFinish();
            _chatAddMessage("system", data.error || "Failed to send message");
        }
    } catch (e) {
        _chatFinish();
        _chatAddMessage("system", "Network error: " + e.message);
    }
}

// ---------------------------------------------------------------------------
// SSE Connection
// ---------------------------------------------------------------------------

function _chatConnectSSE() {
    if (_chatEventSource) _chatEventSource.close();

    _chatEventSource = new EventSource("/api/chat/progress");
    _chatEventSource.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        switch (msg.event) {
            case "token":
                _chatAppendToken(msg.text);
                break;
            case "tool_call":
                _chatShowToolCall(msg.tool, msg.arguments);
                break;
            case "tool_result":
                _chatShowToolResult(msg.tool, msg.result_summary, msg.result);
                break;
            case "done":
                _chatFinish();
                break;
            case "error":
                _chatFinish();
                _chatAddMessage("system", "Error: " + (msg.detail || "Unknown error"));
                break;
            case "stopped":
                _chatFinish();
                _chatAddMessage("system", "Response stopped.");
                break;
        }
    };

    _chatEventSource.onerror = () => {
        // EventSource auto-reconnects; we ignore transient errors.
        // Final cleanup happens via done/error/stopped events.
    };
}

function _chatFinish() {
    if (_chatEventSource) {
        _chatEventSource.close();
        _chatEventSource = null;
    }
    _chatStreaming = false;

    // Remove trailing cursor from assistant bubble
    if (_chatCurrentAssistantEl) {
        const cursor = _chatCurrentAssistantEl.querySelector(".chat-cursor");
        if (cursor) cursor.remove();
    }
    _chatCurrentAssistantEl = null;

    _ch("chat-send-btn").classList.remove("hidden");
    _ch("chat-stop-btn").classList.add("hidden");
    _ch("chat-send-btn").disabled = !_ch("chat-input").value.trim();
}

function _chatStop() {
    fetch("/api/chat/stop", { method: "POST" });
}

async function _chatClear() {
    if (_chatDrawerOpen) _chatCloseDrawer();
    await fetch("/api/chat/clear", { method: "POST" });
    const messages = _ch("chat-messages");
    messages.innerHTML = "";
    messages.closest(".chat-layout").classList.add("chat-centered");
    // Re-add welcome
    messages.innerHTML = `
        <div class="chat-welcome">
            <h3>Music Collection Chat</h3>
            <p>Ask questions about your collection, search for tracks, or create playlists using natural language.</p>
            <div class="chat-suggestions">
                <button class="chat-suggestion" data-msg="What genres are in my collection?">What genres are in my collection?</button>
                <button class="chat-suggestion" data-msg="Find me some uplifting house tracks">Find me some uplifting house tracks</button>
                <button class="chat-suggestion" data-msg="Create a playlist of 90s hip-hop">Create a playlist of 90s hip-hop</button>
            </div>
        </div>`;
    // Re-bind suggestion chips
    messages.querySelectorAll(".chat-suggestion").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = _ch("chat-input");
            input.value = btn.dataset.msg;
            input.dispatchEvent(new Event("input"));
            _chatSend();
        });
    });
}

// ---------------------------------------------------------------------------
// Message Rendering
// ---------------------------------------------------------------------------

function _chatAddMessage(role, text, streaming = false) {
    const messages = _ch("chat-messages");
    const div = document.createElement("div");
    div.className = `chat-msg chat-msg-${role}`;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    if (streaming) {
        bubble.innerHTML = '<span class="chat-cursor"></span>';
    } else {
        bubble.textContent = text;
    }

    div.appendChild(bubble);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function _chatAppendToken(text) {
    if (!_chatCurrentAssistantEl) return;
    const bubble = _chatCurrentAssistantEl.querySelector(".chat-bubble");

    // Remove cursor, insert text before it
    const cursor = bubble.querySelector(".chat-cursor");
    const textNode = document.createTextNode(text);
    if (cursor) {
        bubble.insertBefore(textNode, cursor);
    } else {
        bubble.appendChild(textNode);
        const newCursor = document.createElement("span");
        newCursor.className = "chat-cursor";
        bubble.appendChild(newCursor);
    }

    _ch("chat-messages").scrollTop = _ch("chat-messages").scrollHeight;
}

function _chatShowToolCall(toolName) {
    if (!_chatCurrentAssistantEl) return;
    const bubble = _chatCurrentAssistantEl.querySelector(".chat-bubble");

    const indicator = document.createElement("div");
    indicator.className = "chat-tool-indicator";
    indicator.dataset.tool = toolName;
    const label = _chatToolLabel(toolName);
    indicator.innerHTML = `<span class="chat-tool-icon">&#x2699;</span> <span class="chat-tool-name">${label}</span> <span class="chat-tool-status">running\u2026</span>`;

    // Insert before cursor
    const cursor = bubble.querySelector(".chat-cursor");
    if (cursor) {
        bubble.insertBefore(indicator, cursor);
    } else {
        bubble.appendChild(indicator);
    }
}

function _chatShowToolResult(toolName, summary, result) {
    if (!_chatCurrentAssistantEl) return;
    const bubble = _chatCurrentAssistantEl.querySelector(".chat-bubble");

    // Find the latest matching indicator
    const indicators = bubble.querySelectorAll(`.chat-tool-indicator[data-tool="${toolName}"]`);
    const indicator = indicators[indicators.length - 1];
    if (indicator) {
        const status = indicator.querySelector(".chat-tool-status");
        status.textContent = summary || "done";
        indicator.classList.add("chat-tool-done");
    }

    // Render track list if the result has tracks
    if (result && result.tracks && result.tracks.length > 0) {
        _chatRenderTrackList(result.tracks, bubble);
    }

    // Auto-open drawer for playlist mutations
    if (toolName === "create_playlist" && result && result.playlist) {
        _chatOpenDrawer(result.playlist.id, result.playlist.name);
    }
    if (toolName === "add_tracks_to_playlist" && result && result.playlist) {
        _chatOpenDrawer(result.playlist.id, result.playlist.name);
    }
}

function _chatRenderTrackList(tracks, bubble) {
    const list = document.createElement("div");
    list.className = "chat-track-list";
    const limit = Math.min(tracks.length, 10);
    for (let i = 0; i < limit; i++) {
        const t = tracks[i];
        const row = document.createElement("div");
        row.className = "chat-track-row";
        row.innerHTML = `
            <span class="chat-track-num">${i + 1}.</span>
            <span class="chat-track-info"><strong>${_chatEsc(t.artist)}</strong> \u2014 ${_chatEsc(t.title)}</span>
            <span class="chat-track-meta">${t.bpm ? t.bpm + " BPM" : ""}${t.key ? " / " + t.key : ""}</span>
        `;
        list.appendChild(row);
    }
    if (tracks.length > limit) {
        const more = document.createElement("div");
        more.className = "chat-track-more";
        more.textContent = `\u2026and ${tracks.length - limit} more`;
        list.appendChild(more);
    }

    // Insert before cursor
    const cursor = bubble.querySelector(".chat-cursor");
    if (cursor) {
        bubble.insertBefore(list, cursor);
    } else {
        bubble.appendChild(list);
    }
}

function _chatToolLabel(name) {
    const labels = {
        collection_stats: "Analyzing collection",
        search_tracks: "Searching tracks",
        get_track_details: "Loading track details",
        browse_tree: "Browsing tree",
        list_playlists: "Listing playlists",
        get_playlist_tracks: "Loading playlist",
        list_sets: "Listing sets",
        create_playlist: "Creating playlist",
        add_tracks_to_playlist: "Adding to playlist",
    };
    return labels[name] || name;
}

function _chatEsc(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Chat Playlist Drawer
// ---------------------------------------------------------------------------

async function _chatOpenDrawer(playlistId, playlistName) {
    _chatDrawerPlaylistId = playlistId;
    _chatDrawerOpen = true;

    const drawer = document.getElementById("chat-drawer");
    drawer.classList.add("open");
    document.getElementById("tab-chat").classList.add("chat-drawer-open");

    // Show loading state
    document.getElementById("chat-drawer-title").textContent = playlistName || "Playlist";
    document.getElementById("chat-drawer-badge").className = "source-badge";
    document.getElementById("chat-drawer-badge").textContent = "";
    document.getElementById("chat-drawer-desc").style.display = "none";
    document.getElementById("chat-drawer-count").textContent = "Loading\u2026";
    document.getElementById("chat-drawer-tracks").innerHTML = "";

    try {
        const res = await fetch(`/api/workshop/playlists/${playlistId}`);
        if (!res.ok) throw new Error("Playlist not found");
        const data = await res.json();
        _chatRenderDrawer(data.playlist, data.tracks);
    } catch (e) {
        document.getElementById("chat-drawer-count").textContent = "Failed to load playlist";
    }
}

function _chatCloseDrawer() {
    _chatDrawerOpen = false;
    _chatDrawerPlaylistId = null;
    document.getElementById("chat-drawer").classList.remove("open");
    document.getElementById("tab-chat").classList.remove("chat-drawer-open");
}

function _chatRenderDrawer(playlist, tracks) {
    document.getElementById("chat-drawer-title").textContent = playlist.name;

    // Source badge
    const badge = document.getElementById("chat-drawer-badge");
    const source = playlist.source || "manual";
    badge.textContent = _chatSourceLabel(source);
    badge.className = "source-badge source-badge-" + _chatSourceBadgeClass(source);

    // Description
    const descEl = document.getElementById("chat-drawer-desc");
    if (playlist.description) {
        descEl.textContent = playlist.description;
        descEl.style.display = "block";
    } else {
        descEl.style.display = "none";
    }

    // Count
    document.getElementById("chat-drawer-count").textContent = tracks.length + " tracks";

    // Tracks
    const container = document.getElementById("chat-drawer-tracks");
    container.innerHTML = "";

    for (const track of tracks) {
        const row = document.createElement("div");
        row.className = "chat-drawer-track-row";

        const safeArtist = _chatEsc(track.artist || "");
        const safeTitle = _chatEsc(track.title || "");

        row.innerHTML =
            '<img class="chat-drawer-track-art" alt="">' +
            '<button class="btn-preview" title="Preview">&#x25B6;</button>' +
            '<div class="chat-drawer-track-info">' +
                '<span class="chat-drawer-track-title">' + safeTitle + '</span>' +
                '<span class="chat-drawer-track-artist">' + safeArtist + '</span>' +
            '</div>' +
            '<div class="chat-drawer-track-meta">' +
                (track.bpm ? Math.round(track.bpm) + " BPM" : "") +
                (track.key ? "<br>" + _chatEsc(track.key) : "") +
            '</div>';

        // Load artwork
        const img = row.querySelector("img");
        if (typeof loadArtwork === "function") {
            loadArtwork(track.artist, track.title, img);
        }

        // Preview button
        row.querySelector(".btn-preview").addEventListener("click", (e) => {
            e.stopPropagation();
            if (typeof togglePreview === "function") {
                togglePreview(track.artist, track.title, e.currentTarget);
            }
        });

        container.appendChild(row);
    }
}

function _chatSourceLabel(source) {
    const labels = {
        manual: "Manual", llm: "AI Curated", import: "Imported",
        chat: "Chat", tree: "Genre Tree",
        "scene-tree": "Scene Tree", "collection-tree": "Collection",
    };
    return labels[source] || source;
}

function _chatSourceBadgeClass(source) {
    if (source === "chat") return "chat";
    if (source === "llm") return "llm";
    if (source === "import") return "import";
    if (source && source.includes("tree")) return "tree";
    return "manual";
}

function _chatPushToWorkshop() {
    if (!_chatDrawerPlaylistId) return;
    const playlistId = _chatDrawerPlaylistId;
    const name = document.getElementById("chat-drawer-title").textContent;
    _chatCloseDrawer();

    fetch("/api/workshop/playlists/" + playlistId)
        .then(r => r.json())
        .then(data => {
            if (typeof pushToSetWorkshop === "function") {
                pushToSetWorkshop(
                    data.playlist.track_ids || [],
                    name,
                    "playlist",
                    playlistId,
                    null
                );
            }
        });
}

function _chatPushToAutoSet() {
    if (!_chatDrawerPlaylistId) return;
    const playlistId = _chatDrawerPlaylistId;
    _chatCloseDrawer();

    if (typeof switchToTab === "function") {
        switchToTab("autoset");
    }

    // Allow tab to initialize before preselecting
    setTimeout(() => {
        if (typeof preselectAutoSetPlaylist === "function") {
            preselectAutoSetPlaylist(playlistId);
        }
    }, 200);
}

// ---------------------------------------------------------------------------
// History Restoration
// ---------------------------------------------------------------------------

async function _chatLoadHistory() {
    try {
        const res = await fetch("/api/chat/history");
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
            const welcome = _ch("chat-messages").querySelector(".chat-welcome");
            if (welcome) welcome.remove();
            _ch("chat-messages").closest(".chat-layout").classList.remove("chat-centered");

            for (const msg of data.messages) {
                _chatAddMessage(msg.role, msg.text || "");
            }
        }
    } catch (e) {
        // No history available, that's fine
    }
}
