/**
 * Chat tab — conversational AI for querying the music collection.
 */

/* global $$ */

let _chatEventSource = null;
let _chatStreaming = false;
let _chatCurrentAssistantEl = null;

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

    _chatLoadHistory();
}

// ---------------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------------

async function _chatSend() {
    const input = _ch("chat-input");
    const text = input.value.trim();
    if (!text || _chatStreaming) return;

    // Clear welcome on first send
    const welcome = _ch("chat-messages").querySelector(".chat-welcome");
    if (welcome) welcome.remove();

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
    await fetch("/api/chat/clear", { method: "POST" });
    const messages = _ch("chat-messages");
    messages.innerHTML = "";
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

            for (const msg of data.messages) {
                _chatAddMessage(msg.role, msg.text || "");
            }
        }
    } catch (e) {
        // No history available, that's fine
    }
}
