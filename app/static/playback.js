/* ── Set Workshop — Playback Engine ─────────────────────────────────────── */

// ── Playback State ──
let setWorkshopMode = "playset";  // "workshop" (Short Preview) | "playset" (Full Track)
let setPlaySetIndex = 0;
let setPlayGen = 0;    // generation counter to detect stale error events on skip
let setAudio = null;   // single Audio element for ALL set playback (full + preview)
let setResumeSlotIdx = -1;  // slot index to resume from after user-stop, -1 = none
let setAutoplayBlocked = false;  // true when browser blocked autoplay (NotAllowedError)
let setAudioFlagsReady = null;   // promise resolved when refreshHasAudioFlags completes
let _previewStartTime = 0;  // start time for 30s Short Preview window
let _isAdvancing = false;    // guard: true while a track-advance is in progress
const PREVIEW_DURATION = 30; // seconds for Short Preview mode
let _bpmSwapContext = null;  // {direction: "up"|"down", origIndex: N, slotIdx: N} when BPM arrow triggered playback

function isPlaySetMode() { return setWorkshopMode === "playset"; }

// ── Energy Line Animation State ──
let _energyAnimFrame = null;
let _energyAnimStart = null;
let _energyLastKeyColor = null;  // persists color across keyless tracks

// ── EQ Overlay Constants ──
const EQ_BAR_COUNT = 7;
const EQ_SPEEDS  = [1.2, 0.8, 1.5, 0.9, 1.35, 1.05, 1.4];   // seconds
const EQ_DELAYS  = [0, 0.12, 0.05, 0.18, 0.08, 0.22, 0.03];  // seconds
const EQ_IDLES   = [75, 60, 82, 55, 78, 65, 80];              // idle clip % (higher = shorter bar)


// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

function initPlayback() {
    // Single Audio element for all set playback (Full Track + Short Preview)
    setAudio = new Audio();
    setAudio.volume = 0.7;
    setAudio.addEventListener("timeupdate", updatePlaySetProgress);
    setAudio.addEventListener("ended", onPlaySetTrackEnded);
    setAudio.addEventListener("error", onPlaySetTrackError);
    // Broadcast playing event so dance tab can react (setAudio doesn't exist at dance init time)
    setAudio.addEventListener("playing", () => {
        _clearAutoplayBlockedHint();
        _bpmSwapContext = null;  // playback succeeded — clear BPM swap state
        _isAdvancing = false;    // new track is playing — allow future advances
        startEnergyLineAnim();
        document.querySelectorAll(".set-eq-overlay").forEach(el => el.classList.add("eq-playing"));
        _clearPlayOverlayLoading();
        _updatePlayOverlayIcon();
        window.dispatchEvent(new CustomEvent("playset-playing"));
    });
    setAudio.addEventListener("pause", () => {
        stopEnergyLineAnim();
        document.querySelectorAll(".set-eq-overlay").forEach(el => el.classList.remove("eq-playing"));
        _updatePlayOverlayIcon();
    });

    // Now Playing controls
    document.getElementById("now-playing-play-pause").addEventListener("click", togglePlaySetPause);
    document.getElementById("now-playing-prev").addEventListener("click", playSetPrev);
    document.getElementById("now-playing-next").addEventListener("click", playSetNext);
    document.getElementById("now-playing-progress-bar").addEventListener("click", (e) => {
        if (!setAudio || !setAudio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setAudio.currentTime = pct * setAudio.duration;
    });

    // Base drawer controls
    document.getElementById("base-np-play-pause").addEventListener("click", togglePlaySetPause);
    document.getElementById("base-np-prev").addEventListener("click", playSetPrev);
    document.getElementById("base-np-next").addEventListener("click", playSetNext);
    document.getElementById("base-np-bpm-up").addEventListener("click", bpmSwapUp);
    document.getElementById("base-np-bpm-down").addEventListener("click", bpmSwapDown);
    document.getElementById("base-np-progress-bar").addEventListener("click", (e) => {
        if (!setAudio || !setAudio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setAudio.currentTime = pct * setAudio.duration;
    });
}


// ═══════════════════════════════════════════════════════════════════════════
// Mode Switching
// ═══════════════════════════════════════════════════════════════════════════

function switchMode(mode) {
    if (mode === setWorkshopMode) return; // already in target mode

    const currentIdx = setPlaySetIndex;
    setWorkshopMode = mode;
    updateModeToggleUI();
    updateToolbarState();

    // Continue playback from current position in the new mode
    const idx = findNextPlaySetSlot(currentIdx >= 0 ? currentIdx : 0);
    if (idx >= 0) {
        playSlot(idx);
    }
}

function updateModeToggleUI() {
    const isWorkshop = setWorkshopMode === "workshop";
    // Side drawer toggle
    const workshopBtn = document.getElementById("set-mode-workshop");
    const playsetBtn  = document.getElementById("set-mode-playset");
    workshopBtn.classList.toggle("active", isWorkshop);
    playsetBtn.classList.toggle("active", !isWorkshop);
    // Base drawer toggle (mirror)
    const baseWs = document.querySelector(".base-mode-workshop");
    const basePl = document.querySelector(".base-mode-playset");
    if (baseWs) baseWs.classList.toggle("active", isWorkshop);
    if (basePl) basePl.classList.toggle("active", !isWorkshop);
}

// Start playing from slot 0 in Full Track mode (used by startup/dance boot)
function enterPlaySetMode() {
    setAudio.pause();
    _previewStartTime = 0;
    setWorkshopMode = "playset";
    updateModeToggleUI();
    updateToolbarState();

    // Start from slot 0 (playSlot handles drawer opening)
    const first = findNextPlaySetSlot(0);
    if (first >= 0) {
        playSlot(first);
    }
}

// Stop all playback and clean up visual state
function stopPlayback() {
    setAutoplayBlocked = false;
    setPlayGen++;
    if (setAudio) {
        setAudio.pause();
        setAudio.currentTime = 0;
        setAudio.src = "";
    }
    _previewStartTime = 0;
    stopEnergyLineAnim();
    removeAllEqOverlays();
    removePlayOverlay();
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );

    // Reset progress display
    document.getElementById("now-playing-progress-fill").style.width = "0%";
    document.getElementById("now-playing-current-time").textContent = "0:00";
    document.getElementById("now-playing-duration").textContent = "0:00";
    document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
    document.getElementById("base-np-progress-fill").style.width = "0%";
    document.getElementById("base-np-current-time").textContent = "0:00";
    document.getElementById("base-np-duration").textContent = "0:00";
    document.getElementById("base-np-play-pause").innerHTML = "&#9654;";

    // Notify Dance tab
    window.dispatchEvent(new CustomEvent("playset-stopped"));
}

// Legacy alias — still called from some places
function exitPlaySetMode(opts) {
    stopPlayback();
    setWorkshopMode = "workshop";
    updateModeToggleUI();
    updateToolbarState();
}


// ═══════════════════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════════════════

function syncPlaySetIndex(slotId) {
    const idx = setSlots.findIndex(s => s.id === slotId);
    if (idx >= 0) setPlaySetIndex = idx;
}

function findNextPlaySetSlot(fromIdx, wrap = true) {
    // Search forward from fromIdx
    for (let i = fromIdx; i < setSlots.length; i++) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null) {
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track && track.has_audio) return i;
        }
    }
    // Wrap around to beginning if enabled
    if (wrap && fromIdx > 0) {
        for (let i = 0; i < fromIdx; i++) {
            const slot = setSlots[i];
            if (slot.selectedTrackIndex != null) {
                const track = slot.tracks[slot.selectedTrackIndex];
                if (track && track.has_audio) return i;
            }
        }
    }
    return -1;
}

function findPrevPlaySetSlot(fromIdx) {
    for (let i = fromIdx; i >= 0; i--) {
        const slot = setSlots[i];
        if (slot.selectedTrackIndex != null) {
            const track = slot.tracks[slot.selectedTrackIndex];
            if (track && track.has_audio) return i;
        }
    }
    return -1;
}


// ═══════════════════════════════════════════════════════════════════════════
// EQ Overlays
// ═══════════════════════════════════════════════════════════════════════════

function createEqOverlay(col, bpm) {
    removeEqOverlay(col);

    // Position overlays relative to the selected track
    const selectedSlot = col.querySelector(".set-track-slot.selected");
    if (!selectedSlot) return;

    const trackTop = selectedSlot.offsetTop;
    const trackBottom = trackTop + selectedSlot.offsetHeight;

    // BPM-synced pulse: one full opacity cycle per two beats
    const pulseSpeed = bpm ? (120 / bpm) : 1.0;

    function makeBars(overlay) {
        for (let i = 0; i < EQ_BAR_COUNT; i++) {
            const bar = document.createElement("div");
            bar.className = "set-eq-bar";
            bar.style.setProperty("--eq-speed", EQ_SPEEDS[i] + "s");
            bar.style.setProperty("--eq-delay", EQ_DELAYS[i] + "s");
            bar.style.setProperty("--eq-idle", EQ_IDLES[i] + "%");
            overlay.appendChild(bar);
        }
    }

    // If audio is actively playing, animate immediately
    const eqPlaying = setAudio && !setAudio.paused ? " eq-playing" : "";

    // Top overlay: column top → track top edge, bars project upward
    const upOverlay = document.createElement("div");
    upOverlay.className = "set-eq-overlay set-eq-overlay-up" + eqPlaying;
    upOverlay.style.top = "0";
    upOverlay.style.bottom = (col.offsetHeight - trackTop) + "px";
    upOverlay.style.setProperty("--eq-pulse-speed", pulseSpeed + "s");
    makeBars(upOverlay);
    col.appendChild(upOverlay);

    // Bottom overlay: track bottom edge → column bottom, bars project downward
    const downOverlay = document.createElement("div");
    downOverlay.className = "set-eq-overlay set-eq-overlay-down" + eqPlaying;
    downOverlay.style.top = trackBottom + "px";
    downOverlay.style.bottom = "0";
    downOverlay.style.setProperty("--eq-pulse-speed", pulseSpeed + "s");
    makeBars(downOverlay);
    col.appendChild(downOverlay);
}

function removeEqOverlay(col) {
    col.querySelectorAll(".set-eq-overlay").forEach(el => el.remove());
}

function removeAllEqOverlays() {
    document.querySelectorAll(".set-eq-overlay").forEach(el => el.remove());
}


// ═══════════════════════════════════════════════════════════════════════════
// Play Controls Overlay (crosshair on playing track)
// ═══════════════════════════════════════════════════════════════════════════

function createPlayOverlay(col, slotIdx) {
    removePlayOverlay();

    const slot = setSlots[slotIdx];
    if (!slot) return;
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    const selectedEl = col.querySelector(".set-track-slot.selected");
    if (!selectedEl) return;

    const keyColor = camelotColor(track.key) || "#1db954";

    // BPM-synced pulse: one full cycle per 2 beats (matches EQ overlay)
    const bpm = track.bpm || 120;
    const pulseSpeed = 120 / bpm;

    // Container positioned relative to the column
    const overlay = document.createElement("div");
    overlay.className = "set-play-overlay";
    overlay.style.setProperty("--play-key-color", keyColor);
    overlay.style.setProperty("--play-pulse-speed", pulseSpeed + "s");
    if (setAudio && !setAudio.paused) overlay.classList.add("playing");

    // Use target dimensions — CSS transitions may not have completed yet.
    // On mobile, play-set-active enlarges track to 96×96 at left:8px in 112px col.
    // On desktop, track stays 48×48 at left:4px in 56px col.
    const isMobile = _isMobileView();
    const trackW = isMobile ? 96 : 48;
    const trackH = isMobile ? 96 : 48;
    const trackLeft = isMobile ? 8 : 4;
    const trackTop = selectedEl.offsetTop;  // Y position doesn't change
    const trackCX = trackLeft + trackW / 2;
    const trackCY = trackTop + trackH / 2;

    // Arm lengths
    const armLen = 36;

    // ── Scrim (dark backdrop behind the cross) ──
    const scrim = document.createElement("div");
    scrim.className = "set-play-scrim" + (setAudio && !setAudio.paused ? " playing" : "");
    scrim.style.left = (trackLeft - 2) + "px";
    scrim.style.top = (trackTop - 2) + "px";
    scrim.style.width = (trackW + 4) + "px";
    scrim.style.height = (trackH + 4) + "px";
    overlay.appendChild(scrim);

    // ── Center play/pause icon (visual only — scrim handles tap) ──
    const center = document.createElement("div");
    center.className = "set-play-center";
    center.style.left = (trackCX - 18) + "px";
    center.style.top = (trackCY - 18) + "px";
    center.innerHTML = (setAudio && !setAudio.paused) ? "&#9646;&#9646;" : "&#9654;";
    overlay.appendChild(center);

    // Scrim is the full-image play/pause tap target
    scrim.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlaySetPause();
        const isPlaying = setAudio && !setAudio.paused;
        center.innerHTML = isPlaying ? "&#9646;&#9646;" : "&#9654;";
        scrim.classList.toggle("playing", isPlaying);
        overlay.classList.toggle("playing", isPlaying);
    });

    // ── Left arm (previous track in set) ──
    const hasPrev = findPrevPlaySetSlot(slotIdx - 1) >= 0;
    const armLeft = document.createElement("div");
    armLeft.className = "set-play-arm arm-left";
    armLeft.style.left = (trackLeft - armLen) + "px";
    armLeft.style.top = trackCY + "px";
    armLeft.style.width = armLen + "px";
    const lineL = document.createElement("div");
    lineL.className = "set-play-arm-line";
    armLeft.appendChild(lineL);
    const btnL = document.createElement("div");
    btnL.className = "set-play-arm-btn" + (hasPrev ? "" : " disabled");
    btnL.innerHTML = "&#9664;&#9664;";
    btnL.addEventListener("click", (e) => { e.stopPropagation(); playSetPrev(); });
    armLeft.appendChild(btnL);
    overlay.appendChild(armLeft);

    // ── Right arm (next track in set) ──
    const hasNext = findNextPlaySetSlot(slotIdx + 1) >= 0;
    const armRight = document.createElement("div");
    armRight.className = "set-play-arm arm-right";
    armRight.style.left = (trackLeft + trackW) + "px";
    armRight.style.top = trackCY + "px";
    armRight.style.width = armLen + "px";
    const lineR = document.createElement("div");
    lineR.className = "set-play-arm-line";
    armRight.appendChild(lineR);
    const btnR = document.createElement("div");
    btnR.className = "set-play-arm-btn" + (hasNext ? "" : " disabled");
    btnR.innerHTML = "&#9654;&#9654;";
    btnR.addEventListener("click", (e) => { e.stopPropagation(); playSetNext(); });
    armRight.appendChild(btnR);
    overlay.appendChild(armRight);

    // ── Up arm (higher BPM track in slot) ──
    const cur = slot.selectedTrackIndex;
    let hasHigher = false;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) { hasHigher = true; break; }
    }
    const armUp = document.createElement("div");
    armUp.className = "set-play-arm arm-up";
    armUp.style.left = trackCX + "px";
    armUp.style.top = (trackTop - armLen) + "px";
    armUp.style.height = armLen + "px";
    const lineU = document.createElement("div");
    lineU.className = "set-play-arm-line";
    armUp.appendChild(lineU);
    const btnU = document.createElement("div");
    btnU.className = "set-play-arm-btn" + (hasHigher ? "" : " disabled");
    btnU.innerHTML = "&#9650;";
    btnU.addEventListener("click", (e) => { e.stopPropagation(); bpmSwapUp(); });
    armUp.appendChild(btnU);
    overlay.appendChild(armUp);

    // ── Down arm (lower BPM track in slot) ──
    let hasLower = false;
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) { hasLower = true; break; }
    }
    const armDown = document.createElement("div");
    armDown.className = "set-play-arm arm-down";
    armDown.style.left = trackCX + "px";
    armDown.style.top = (trackTop + trackH) + "px";
    armDown.style.height = armLen + "px";
    const lineD = document.createElement("div");
    lineD.className = "set-play-arm-line";
    armDown.appendChild(lineD);
    const btnD = document.createElement("div");
    btnD.className = "set-play-arm-btn" + (hasLower ? "" : " disabled");
    btnD.innerHTML = "&#9660;";
    btnD.addEventListener("click", (e) => { e.stopPropagation(); bpmSwapDown(); });
    armDown.appendChild(btnD);
    overlay.appendChild(armDown);

    col.appendChild(overlay);
}

function removePlayOverlay() {
    document.querySelectorAll(".set-play-overlay").forEach(el => el.remove());
}

// Update play overlay icon state (called from audio events)
function _updatePlayOverlayIcon() {
    const isPlaying = setAudio && !setAudio.paused;
    const overlay = document.querySelector(".set-play-overlay");
    if (overlay) overlay.classList.toggle("playing", isPlaying);
    const center = document.querySelector(".set-play-center");
    if (center) center.innerHTML = isPlaying ? "&#9646;&#9646;" : "&#9654;";
    const scrim = document.querySelector(".set-play-scrim");
    if (scrim) scrim.classList.toggle("playing", isPlaying);
}

// Show loading spinner on the play overlay center icon
function _setPlayOverlayLoading() {
    const center = document.querySelector(".set-play-center");
    if (center) center.classList.add("loading");
}

// Clear loading spinner (called when audio "playing" event fires)
function _clearPlayOverlayLoading() {
    const center = document.querySelector(".set-play-center");
    if (center) center.classList.remove("loading");
}


// ═══════════════════════════════════════════════════════════════════════════
// Core Playback
// ═══════════════════════════════════════════════════════════════════════════

// Central dispatch: play slot respecting current mode
function playSlot(idx) {
    _isAdvancing = false;  // user-initiated play — reset auto-advance guard
    // Choose drawer: mobile always uses base drawer, desktop uses tab-based logic
    const isDanceTab = !document.getElementById("tab-dance")?.classList.contains("hidden");
    const useBaseDrawer = isDanceTab || _isMobileView();
    if (useBaseDrawer) {
        if (!baseDrawerOpen) {
            baseDrawerOpen = true;
            const drawer = document.getElementById("base-drawer");
            document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-open"));
            drawer.classList.add("open");
            // Default to expanded detail view on mobile
            if (_isMobileView()) {
                drawer.classList.add("expanded");
                document.querySelectorAll(".tab-content").forEach(t => t.classList.add("base-drawer-expanded"));
            }
        }
    } else {
        // Desktop DJ mode: use side drawer
        if (!setDrawerOpen || setDrawerMode !== "now-playing") {
            openDrawer("now-playing", null);
        }
    }
    if (isPlaySetMode()) {
        playFullTrack(idx);
    } else {
        playSlotPreview(idx);
    }
}

async function playFullTrack(idx) {
    const gen = ++setPlayGen;

    if (idx < 0 || idx >= setSlots.length) return;

    // Pause current playback before switching source
    setAudio.pause();

    setPlaySetIndex = idx;
    const slot = setSlots[idx];
    const track = slot.tracks[slot.selectedTrackIndex];

    // Highlight column + EQ overlay + key cell
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, idx);
        // Delay scroll to let the wide-column CSS transition settle
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update play/pause button
    document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";

    // Set audio source to the backend streaming endpoint
    setAudio.src = `/api/audio/${track.id}`;
    setAudio.load();
    _previewStartTime = 0; // Full track mode — no preview window
    _setPlayOverlayLoading();
    setAudio.play().catch(err => {
        if (gen !== setPlayGen) return; // stale — another track was requested
        if (err.name === 'AbortError') return; // source changed, not a real error
        _clearPlayOverlayLoading();
        console.error("Playback failed:", err);

        // Autoplay blocked by browser — flag it so togglePlaySetPause resumes on click
        if (err.name === 'NotAllowedError') {
            console.warn("Autoplay blocked, waiting for user interaction");
            setAutoplayBlocked = true;
            _showAutoplayBlockedHint();
            return;
        }

        // BPM swap: try next track in same direction, or revert to original
        if (_bpmSwapContext) {
            _handleBpmSwapError();
            return;
        }

        // Other errors (404, format, network) — skip to next slot
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) {
            playFullTrack(next);
        }
    });

    // Update Now Playing drawer
    updateNowPlayingDrawer(track, idx);

    // Notify Dance tab of track change
    window.dispatchEvent(new CustomEvent("playset-track", { detail: { track, idx } }));
}

// Play a 30-second preview from the middle of the track using backend streaming
async function playSlotPreview(idx) {
    const gen = ++setPlayGen;

    if (idx < 0 || idx >= setSlots.length) return;

    setAudio.pause();

    setPlaySetIndex = idx;
    const slot = setSlots[idx];
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    // Highlight column + EQ overlay
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, idx);
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update play/pause button
    document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";

    // Load track and seek to middle once metadata is available
    _previewStartTime = 0;
    setAudio.src = `/api/audio/${track.id}`;
    setAudio.load();

    // Wait for duration to be known, then seek to middle
    const onLoaded = () => {
        setAudio.removeEventListener("loadedmetadata", onLoaded);
        if (gen !== setPlayGen) return; // stale
        const dur = setAudio.duration || 0;
        _previewStartTime = Math.max(0, dur / 2 - PREVIEW_DURATION / 2);
        setAudio.currentTime = _previewStartTime;
    };
    setAudio.addEventListener("loadedmetadata", onLoaded);

    _setPlayOverlayLoading();
    setAudio.play().catch(err => {
        if (gen !== setPlayGen) return;
        if (err.name === 'AbortError') return;
        _clearPlayOverlayLoading();
        console.error("Short Preview audio failed:", err);

        if (err.name === 'NotAllowedError') {
            setAutoplayBlocked = true;
            _showAutoplayBlockedHint();
            return;
        }

        // BPM swap: try next track in same direction, or revert to original
        if (_bpmSwapContext) {
            _handleBpmSwapError();
            return;
        }

        // Skip to next slot on error
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) playSlotPreview(next);
    });

    // Update Now Playing drawer
    updateNowPlayingDrawer(track, idx);

    // Notify Dance tab
    window.dispatchEvent(new CustomEvent("playset-track", { detail: { track, idx } }));
}


// ═══════════════════════════════════════════════════════════════════════════
// Visual Activation (paused state — highlight slot without playing)
// ═══════════════════════════════════════════════════════════════════════════

function _activateSlotVisual(slotIdx) {
    if (slotIdx < 0 || slotIdx >= setSlots.length) return;
    const slot = setSlots[slotIdx];
    const track = slot.tracks[slot.selectedTrackIndex];
    if (!track) return;

    setPlaySetIndex = slotIdx;

    // Clear any previous active column
    document.querySelectorAll(".set-column.play-set-active").forEach(el => {
        _downgradePlayingArtwork(el);
        removeEqOverlay(el);
        el.classList.remove("play-set-active");
    });
    document.querySelectorAll(".set-key-cell.play-set-active").forEach(
        el => el.classList.remove("play-set-active")
    );
    removePlayOverlay();

    // Activate column
    const col = document.querySelector(`.set-column[data-slot-id="${slot.id}"]`);
    if (col) {
        col.classList.add("play-set-active");
        _upgradePlayingArtwork(col, track);
        createEqOverlay(col, track.bpm);
        createPlayOverlay(col, slotIdx);
        setTimeout(() => _scrollToActiveTrack(col), 320);
    }

    // Activate key cell
    const keyCell = document.querySelector(`.set-key-cell[data-slot-id="${slot.id}"]`);
    if (keyCell) keyCell.classList.add("play-set-active");

    // Update drawer info
    updateNowPlayingDrawer(track, slotIdx);

    // Show paused icon
    document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
    document.getElementById("base-np-play-pause").innerHTML = "&#9654;";
}


// ═══════════════════════════════════════════════════════════════════════════
// Now Playing Drawer
// ═══════════════════════════════════════════════════════════════════════════

async function updateNowPlayingDrawer(track, slotIdx) {
    // Track info
    document.getElementById("now-playing-title").textContent = track.title || "";
    document.getElementById("now-playing-artist").textContent = track.artist || "";
    document.getElementById("now-playing-bpm").textContent = track.bpm ? Math.round(track.bpm) + " BPM" : "";
    document.getElementById("now-playing-key").textContent = track.key || "";
    document.getElementById("now-playing-year").textContent = track.year || "";

    // Counter
    const playable = setSlots.filter(s => {
        if (s.selectedTrackIndex == null) return false;
        const t = s.tracks[s.selectedTrackIndex];
        return t && t.has_audio;
    });
    const currentNum = playable.findIndex(s => setSlots.indexOf(s) === slotIdx) + 1;
    const counterText = `Track ${currentNum} of ${playable.length}`;
    document.getElementById("now-playing-counter").textContent = counterText;

    // Large artwork
    const artImg = document.getElementById("now-playing-artwork");
    artImg.src = "";
    loadNowPlayingArtwork(track.artist, track.title, artImg);

    // Also load artwork for base drawer
    const baseArtImg = document.getElementById("base-np-artwork");
    baseArtImg.src = "";
    loadNowPlayingArtwork(track.artist, track.title, baseArtImg);

    // Comment
    const commentEl = document.getElementById("now-playing-comment");
    commentEl.textContent = "";

    // Sync base drawer basic info
    document.getElementById("base-np-title").textContent = track.title || "";
    const bpmText = track.bpm ? Math.round(track.bpm) + " BPM" : "";
    const artistLine = [track.artist || "", bpmText, track.key || "", track.year || ""]
        .filter(Boolean).join(", ");
    document.getElementById("base-np-artist-line").textContent = artistLine;
    document.getElementById("base-np-counter").textContent = counterText;
    document.getElementById("base-np-comment").textContent = "";
    document.getElementById("base-np-collection").textContent = "";
    document.getElementById("base-np-collection-desc").textContent = "";
    document.getElementById("base-np-also-in").textContent = "";

    // Fetch collection tree context
    const collDiv = document.getElementById("now-playing-collection-leaf");
    const alsoInDiv = document.getElementById("now-playing-also-in");
    collDiv.innerHTML = "";
    alsoInDiv.innerHTML = "";
    try {
        const res = await fetch(`/api/set-workshop/track-context/${track.id}`);
        if (res.ok) {
            const data = await res.json();
            if (data.comment) {
                commentEl.textContent = data.comment;
                document.getElementById("base-np-comment").textContent = data.comment;
            }
            renderSearchCard("now-playing-collection-leaf", data.collection_leaf, "Collection", "tree_node", "collection");
            renderAlsoAppearsIn(alsoInDiv, data.also_in || []);
            // Base drawer: collection name + description
            if (data.collection_leaf && data.collection_leaf.name) {
                document.getElementById("base-np-collection").textContent = data.collection_leaf.name;
                document.getElementById("base-np-collection-desc").textContent =
                    data.collection_leaf.description || "";
            }
            if (data.also_in && data.also_in.length) {
                document.getElementById("base-np-also-in").textContent = "Also in " + data.also_in.length + " more";
            }
        }
    } catch (e) {
        console.error("Failed to load track context:", e);
    }

    // If the expanded base drawer is open (mobile detail view), sync it
    const baseDrawer = document.getElementById("base-drawer");
    if (baseDrawer && baseDrawer.classList.contains("expanded")) {
        syncBaseDrawerDetail();
    }

    // Update BPM arrow button states for current slot
    updateBpmArrowButtons();
}

function renderAlsoAppearsIn(container, leaves) {
    container.innerHTML = "";
    if (!leaves || leaves.length === 0) return;

    const header = document.createElement("div");
    header.className = "also-in-header";
    header.textContent = "Also appears in\u2026";
    container.appendChild(header);

    for (const leaf of leaves) {
        const link = document.createElement("a");
        link.className = "also-in-link";
        link.href = "#";
        link.textContent = `${leaf.title} (${leaf.track_count})`;
        link.addEventListener("click", (e) => {
            e.preventDefault();
            assignSource("tree_node", leaf.id, "collection", leaf.title);
        });
        container.appendChild(link);
    }
}

function loadNowPlayingArtwork(artist, title, imgEl) {
    fetch(`/api/artwork?artist=${encodeURIComponent(artist || "")}&title=${encodeURIComponent(title || "")}`)
        .then(r => r.json())
        .then(data => {
            const url = data.cover_big || data.cover_url || "";
            if (url) imgEl.src = url;
        })
        .catch(() => {});
}


// ═══════════════════════════════════════════════════════════════════════════
// Autoplay Hints
// ═══════════════════════════════════════════════════════════════════════════

function _showAutoplayBlockedHint() {
    const npBtn = document.getElementById("now-playing-play-pause");
    const baseBtn = document.getElementById("base-np-play-pause");
    npBtn.innerHTML = "&#9654;";
    baseBtn.innerHTML = "&#9654;";
    npBtn.classList.add("autoplay-blocked");
    baseBtn.classList.add("autoplay-blocked");
}

function _clearAutoplayBlockedHint() {
    // Removing the class lets the CSS transition on .now-playing-btn-main
    // smoothly animate width/height back to their default values
    document.getElementById("now-playing-play-pause").classList.remove("autoplay-blocked");
    document.getElementById("base-np-play-pause").classList.remove("autoplay-blocked");
}


// ═══════════════════════════════════════════════════════════════════════════
// Controls
// ═══════════════════════════════════════════════════════════════════════════

function togglePlaySetPause() {
    if (!setAudio) return;

    // Autoplay was blocked — user click resumes playback
    if (setAutoplayBlocked) {
        setAutoplayBlocked = false;
        _clearAutoplayBlockedHint();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";
        setAudio.play().catch(() => {});
        return;
    }

    if (!setAudio.paused) {
        // Pause
        setAudio.pause();
        document.getElementById("now-playing-play-pause").innerHTML = "&#9654;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9654;";
    } else if (setAudio.src && setAudio.currentTime > 0) {
        // Resume from current position
        setAudio.play().catch(() => {});
        document.getElementById("now-playing-play-pause").innerHTML = "&#9646;&#9646;";
        document.getElementById("base-np-play-pause").innerHTML = "&#9646;&#9646;";
    } else {
        // Nothing playing yet — start from current slot or slot 0
        const idx = findNextPlaySetSlot(setPlaySetIndex >= 0 ? setPlaySetIndex : 0);
        if (idx >= 0) playSlot(idx);
    }
}

function playSetPrev() {
    const prev = findPrevPlaySetSlot(setPlaySetIndex - 1);
    if (prev >= 0) playSlot(prev);
}

function playSetNext() {
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlot(next);
}

// ── BPM Up/Down: switch to higher/lower BPM track in current slot ──

function bpmSwapUp() {
    const slotIdx = setPlaySetIndex;
    const slot = setSlots[slotIdx];
    if (!slot) return;
    const cur = slot.selectedTrackIndex;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) {
            _bpmSwapContext = { direction: "up", origIndex: cur, slotIdx };
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(slotIdx);
            return;
        }
    }
}

function bpmSwapDown() {
    const slotIdx = setPlaySetIndex;
    const slot = setSlots[slotIdx];
    if (!slot) return;
    const cur = slot.selectedTrackIndex;
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) {
            _bpmSwapContext = { direction: "down", origIndex: cur, slotIdx };
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(slotIdx);
            return;
        }
    }
}

function _handleBpmSwapError() {
    const ctx = _bpmSwapContext;
    if (!ctx) return;

    const slot = setSlots[ctx.slotIdx];
    if (!slot) { _bpmSwapContext = null; return; }

    const cur = slot.selectedTrackIndex;
    const isUp = ctx.direction === "up";

    // Try next track in the same direction
    const start = isUp ? cur + 1 : cur - 1;
    const end = isUp ? slot.tracks.length : -1;
    const step = isUp ? 1 : -1;
    for (let i = start; i !== end; i += step) {
        if (slot.tracks[i]) {
            slot.selectedTrackIndex = i;
            renderSet();
            scheduleAutoSave();
            playSlot(ctx.slotIdx);
            return;  // keep _bpmSwapContext alive for the next attempt
        }
    }

    // No more tracks in that direction — revert to the original track
    slot.selectedTrackIndex = ctx.origIndex;
    _bpmSwapContext = null;
    renderSet();
    scheduleAutoSave();
    playSlot(ctx.slotIdx);
}

function updateBpmArrowButtons() {
    const upBtn = document.getElementById("base-np-bpm-up");
    const downBtn = document.getElementById("base-np-bpm-down");
    if (!upBtn || !downBtn) return;

    const slot = setSlots[setPlaySetIndex];
    if (!slot || slot.selectedTrackIndex == null) {
        upBtn.disabled = true;
        downBtn.disabled = true;
        return;
    }

    const cur = slot.selectedTrackIndex;
    let hasHigher = false, hasLower = false;
    for (let i = cur + 1; i < slot.tracks.length; i++) {
        if (slot.tracks[i]) { hasHigher = true; break; }
    }
    for (let i = cur - 1; i >= 0; i--) {
        if (slot.tracks[i]) { hasLower = true; break; }
    }
    upBtn.disabled = !hasHigher;
    downBtn.disabled = !hasLower;
}


// ═══════════════════════════════════════════════════════════════════════════
// Progress & Events
// ═══════════════════════════════════════════════════════════════════════════

function updatePlaySetProgress() {
    if (!setAudio || !setAudio.duration) return;

    // Short Preview mode: enforce 30s limit, then advance to next slot
    if (!isPlaySetMode() && _previewStartTime > 0) {
        const elapsed = setAudio.currentTime - _previewStartTime;
        if (elapsed >= PREVIEW_DURATION) {
            onPreviewEnded();
            return;
        }
        // Show progress relative to the 30s preview window
        const pct = (elapsed / PREVIEW_DURATION) * 100;
        document.getElementById("now-playing-progress-fill").style.width = pct + "%";
        document.getElementById("now-playing-current-time").textContent = formatPlaySetTime(elapsed);
        document.getElementById("now-playing-duration").textContent = formatPlaySetTime(PREVIEW_DURATION);
        document.getElementById("base-np-progress-fill").style.width = pct + "%";
        document.getElementById("base-np-current-time").textContent = formatPlaySetTime(elapsed);
        document.getElementById("base-np-duration").textContent = formatPlaySetTime(PREVIEW_DURATION);
        return;
    }

    const pct = (setAudio.currentTime / setAudio.duration) * 100;
    document.getElementById("now-playing-progress-fill").style.width = pct + "%";
    document.getElementById("now-playing-current-time").textContent = formatPlaySetTime(setAudio.currentTime);
    document.getElementById("now-playing-duration").textContent = formatPlaySetTime(setAudio.duration);
    // Sync base drawer progress
    document.getElementById("base-np-progress-fill").style.width = pct + "%";
    document.getElementById("base-np-current-time").textContent = formatPlaySetTime(setAudio.currentTime);
    document.getElementById("base-np-duration").textContent = formatPlaySetTime(setAudio.duration);
}

// Called when a Short Preview 30s window ends — advance to next slot (with wrap)
function onPreviewEnded() {
    if (_isAdvancing) return;  // already advancing — prevent cascade from repeated timeupdate
    _isAdvancing = true;
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlotPreview(next);
    else _isAdvancing = false;  // no next track — reset
}

function formatPlaySetTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// Called when setAudio "ended" fires (full track finished naturally)
function onPlaySetTrackEnded() {
    // In Full Track mode: advance to next slot (with wrap-around)
    if (isPlaySetMode()) {
        if (_isAdvancing) return;
        _isAdvancing = true;
        const next = findNextPlaySetSlot(setPlaySetIndex + 1);
        if (next >= 0) {
            playFullTrack(next);
        } else {
            _isAdvancing = false;
        }
        return;
    }
    // In Short Preview mode: the timeupdate handler (onPreviewEnded) handles advance,
    // but if the track is shorter than the preview window, ended fires naturally
    onPreviewEnded();
}

function onPlaySetTrackError() {
    // If currentTime is 0, this is likely a stale error from an aborted load
    // (changing src aborts the previous fetch and fires an error event).
    // Genuine initial load failures are handled by play().catch() above.
    // Only auto-advance on mid-stream errors where audio was already playing.
    if (setAudio.currentTime === 0) return;
    console.warn("Playback: mid-stream audio error, skipping to next track");
    _isAdvancing = false;  // reset so the next advance can proceed
    const next = findNextPlaySetSlot(setPlaySetIndex + 1);
    if (next >= 0) playSlot(next);
}


// ═══════════════════════════════════════════════════════════════════════════
// Energy Line Animation
// ═══════════════════════════════════════════════════════════════════════════

function startEnergyLineAnim() {
    if (_energyAnimFrame) return;  // already running
    _energyAnimStart = performance.now();
    _energyAnimTick();
}

function stopEnergyLineAnim() {
    if (_energyAnimFrame) {
        cancelAnimationFrame(_energyAnimFrame);
        _energyAnimFrame = null;
        _energyAnimStart = null;
    }
    _energyLastKeyColor = null;
    renderEnergyWave();  // snap back to static
}

function _energyAnimTick() {
    if (!setAudio || setAudio.paused) { stopEnergyLineAnim(); return; }

    const svg = document.getElementById("set-energy-svg");
    if (!svg) { _energyAnimFrame = null; return; }

    const slotW = SET_COL_W + SET_GAP;
    const totalW = setSlots.length * slotW;
    svg.setAttribute("viewBox", `0 0 ${totalW} ${SET_AREA_H}`);

    // Collect base points (same as renderEnergyWave)
    const points = [];
    setSlots.forEach((slot, i) => {
        if (slot.selectedTrackIndex != null && slot.tracks[slot.selectedTrackIndex]) {
            const track = slot.tracks[slot.selectedTrackIndex];
            const bpm = track.bpm || track.bpm_level || 100;
            const x = i * slotW + SET_COL_W / 2;
            const y = bpmToY(bpm);
            points.push({ x, y, idx: i });
        }
    });

    if (points.length < 2) {
        svg.innerHTML = "";
        _energyAnimFrame = requestAnimationFrame(_energyAnimTick);
        return;
    }

    const elapsed = (performance.now() - _energyAnimStart) / 1000;

    // Use the currently-playing track's key color; carry forward if no key
    if (setPlaySetIndex >= 0 && setPlaySetIndex < setSlots.length) {
        const ps = setSlots[setPlaySetIndex];
        if (ps.selectedTrackIndex != null && ps.tracks[ps.selectedTrackIndex]) {
            const kc = camelotColor(ps.tracks[ps.selectedTrackIndex].key);
            if (kc) _energyLastKeyColor = kc;
        }
    }
    const stroke = _energyLastKeyColor || "var(--accent)";

    // 6 layered lines — each with a different seed offset so they diverge
    const layerSeeds  = [0, 137, 293, 419, 557, 683];      // phase offsets per layer
    const layerClasses = [
        "set-energy-line set-energy-line--alive",
        "set-energy-line set-energy-line--alive set-energy-line--ghost",
        "set-energy-line set-energy-line--alive set-energy-line--ghost",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
        "set-energy-line set-energy-line--alive set-energy-line--ghost set-energy-line--ghost-far",
    ];

    let html = "";
    layerSeeds.forEach((lseed, li) => {
        // EXTREME organic motion — 6 layered sine waves per axis at
        // irrational frequency ratios, plus X wobble and wild tension swings
        const animated = points.map((p, i) => {
            const s = i * 7.31 + lseed;  // per-point seed + layer offset
            const dy = Math.sin(elapsed * 1.17 + s) * 5.0
                     + Math.sin(elapsed * 0.53 + s * 1.3) * 4.0
                     + Math.sin(elapsed * 2.71 + s * 0.7) * 3.0
                     + Math.sin(elapsed * 0.19 + s * 2.1) * 3.5
                     + Math.sin(elapsed * 3.41 + s * 0.4) * 2.0
                     + Math.sin(elapsed * 0.07 + s * 3.1) * 5.0;
            const dx = Math.sin(elapsed * 0.89 + s * 1.7) * 3.0
                     + Math.sin(elapsed * 1.61 + s * 0.9) * 2.0
                     + Math.sin(elapsed * 0.31 + s * 2.3) * 2.5;
            return { x: p.x + dx, y: p.y + dy };
        });

        // Tension swings — layer offset makes each curve bend differently
        const tension = 0.3
            + Math.sin(elapsed * 0.37 + lseed) * 0.10
            + Math.sin(elapsed * 0.83 + lseed * 0.7) * 0.08
            + Math.sin(elapsed * 0.13 + lseed * 1.3) * 0.06
            + Math.sin(elapsed * 1.53 + lseed * 0.4) * 0.05;

        const pathD = catmullRomPath(animated, tension);

        // Only the primary layer gets the fill
        if (li === 0) {
            const fillD = pathD
                + ` L ${animated[animated.length - 1].x} ${SET_AREA_H}`
                + ` L ${animated[0].x} ${SET_AREA_H} Z`;
            html += `<path class="set-energy-fill" d="${fillD}" style="fill:${stroke}" />`;
        }

        const glow = li === 0 ? 6 : li <= 2 ? 3 : 2;
        html += `<path class="${layerClasses[li]}" d="${pathD}"
              style="stroke:${stroke}; filter:drop-shadow(0 0 ${glow}px ${stroke})" />`;
    });

    svg.innerHTML = html;

    _energyAnimFrame = requestAnimationFrame(_energyAnimTick);
}
