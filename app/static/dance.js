/* ── Dance Tab ─────────────────────────────────────────────
   Init sequence shows real loading steps before Play button.
   Click → dancers fade in, Full Track playback starts from slot 0.
   BPM sync: robot tempo matches currently playing track.
   Settings view: gear button → full-page settings with preview robot.
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let _inited = false;
  let _playing = false;
  let _eventsHooked = false;
  let _fadingOut = false;
  let _initRan = false;  // true once init sequence has completed (or failed)

  // Settings view
  let _settingsVisible = false;
  let _previewStageAdded = false;

  // ── DOM refs ───────────────────────────────────────────────
  let _els = {};

  // ── Dancer window sizing ─────────────────────────────────
  // Dynamically measures nav bar and bottom drawer to compute
  // the true visible area, then sizes #dancer-window to fit.
  function _updateDancerWindow() {
    const win = document.getElementById("dancer-window");
    if (!win) return;

    const nav = document.getElementById("tab-bar");
    const drawer = document.getElementById("base-drawer");

    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const drawerH = (drawer && drawer.classList.contains("open"))
      ? drawer.getBoundingClientRect().height : 0;

    const available = window.innerHeight - navH - drawerH;
    win.style.height = Math.max(available, 100) + "px";

    // Scale robot panel to fit within 80% of the dancer window
    const panel = document.getElementById("robot-panel");
    if (panel) {
      // Reset scale to measure natural height
      panel.style.transform = "";
      const naturalH = panel.scrollHeight;
      const maxH = available * 0.8;
      if (naturalH > maxH && naturalH > 0) {
        const s = maxH / naturalH;
        panel.style.transform = `scale(${s})`;
        panel.style.transformOrigin = "center center";
      }
    }
  }

  // ── BPM sync ──────────────────────────────────────────────
  function _syncBpm(track) {
    if (track?.bpm && typeof setRobotBpm === "function") {
      setRobotBpm(Math.round(track.bpm));
    }
  }

  // ── Settings view navigation ─────────────────────────────
  function _openSettings() {
    if (_settingsVisible) return;
    _settingsVisible = true;

    if (_els.performance) _els.performance.classList.add("hidden");
    if (_els.settingsView) _els.settingsView.classList.remove("hidden");

    if (!_previewStageAdded && typeof addRobotStage === "function" && _els.previewPanel) {
      addRobotStage(_els.previewPanel, 1.5);
      _previewStageAdded = true;
    }
    if (typeof startRobotDancer === "function") startRobotDancer();
  }

  function _closeSettings() {
    if (!_settingsVisible) return;
    _settingsVisible = false;

    if (_els.settingsView) _els.settingsView.classList.add("hidden");
    if (_els.performance) _els.performance.classList.remove("hidden");
    if (typeof exitRobotPosePreview === "function") exitRobotPosePreview();
  }

  // ── Workshop detection ─────────────────────────────────────
  function _hasWorkshopSet() {
    if (typeof setSlots === "undefined" || typeof setAudio === "undefined" || !setAudio) return false;
    return setSlots.some(s => {
      if (s.selectedTrackIndex == null) return false;
      const t = s.tracks?.[s.selectedTrackIndex];
      return t?.has_audio;
    });
  }

  // ── Hook into Workshop events (once) ───────────────────────
  function _hookWorkshopEvents() {
    if (_eventsHooked) return;
    _eventsHooked = true;

    // Track change — sync BPM
    window.addEventListener("playset-track", (e) => {
      _syncBpm(e.detail.track);
    });

    // Audio actually started playing — fade in dancers
    // (uses window event because setAudio may not exist yet at dance init time)
    window.addEventListener("playset-playing", () => {
      if (!_playing) {
        _playing = true;
        _fadeInDancers();
      }
    });

    // Playback stopped — fade out dancers
    window.addEventListener("playset-stopped", () => {
      _playing = false;
      _fadeOutDancers();
    });
  }

  // ── Fade dancers out / in ──────────────────────────────────

  function _fadeOutDancers() {
    const robotPanel = document.getElementById("robot-panel");
    if (!robotPanel) return;
    _fadingOut = true;

    function onEnd() {
      robotPanel.removeEventListener("transitionend", onEnd);
      if (_fadingOut) {
        if (typeof stopRobotDancer === "function") stopRobotDancer();
        if (typeof stillRobotDancer === "function") stillRobotDancer();
        _fadingOut = false;
      }
    }
    robotPanel.addEventListener("transitionend", onEnd);
    robotPanel.style.opacity = "0";
  }

  function _fadeInDancers() {
    const robotPanel = document.getElementById("robot-panel");
    if (!robotPanel) return;

    if (_fadingOut) _fadingOut = false;

    if (typeof startRobotDancer === "function") startRobotDancer();
    robotPanel.style.opacity = "1";
  }

  // ── Big Play button handler ─────────────────────────────────
  function _onPlayClick() {
    const overlay = document.getElementById("dance-play-overlay");

    // Fade out the overlay
    if (overlay) {
      overlay.classList.add("fade-out");
      setTimeout(() => { overlay.style.display = "none"; }, 700);
    }

    // Start Full Track playback from slot 0
    if (_hasWorkshopSet()) {
      if (typeof enterPlaySetMode === "function") {
        enterPlaySetMode();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INIT SEQUENCE — step-by-step loading with status messages
  // ═══════════════════════════════════════════════════════════

  function _addStep(log, label) {
    const el = document.createElement("div");
    el.className = "dance-init-step";
    el.innerHTML = `<span class="init-icon"></span><span>${label}</span>`;
    log.appendChild(el);
    return el;
  }

  function _markStep(el, state) {
    el.classList.remove("active", "done", "fail");
    el.classList.add(state);
  }

  async function _runInitSequence() {
    if (_initRan) return;
    _initRan = true;

    const log = document.getElementById("dance-init-log");
    const playBtn = document.getElementById("dance-play-btn");
    const errorEl = document.getElementById("dance-init-error");
    if (!log) return;

    log.innerHTML = "";

    // Step 1: Initialize audio engine
    const stepAudio = _addStep(log, "Initializing audio engine");
    _markStep(stepAudio, "active");

    try {
      // initSetBuilder is idempotent — safe to call if already done
      if (typeof initSetBuilder === "function") {
        await initSetBuilder();
      }
      _markStep(stepAudio, "done");
    } catch (e) {
      console.error("initSetBuilder failed:", e);
      _markStep(stepAudio, "fail");
    }

    // Step 2: Load set data
    const stepSet = _addStep(log, "Loading set data");
    _markStep(stepSet, "active");
    // initSetBuilder already called loadSavedSetState, so check if slots loaded
    const hasSlots = typeof setSlots !== "undefined" && setSlots.length > 0
      && setSlots.some(s => s.selectedTrackIndex != null);
    _markStep(stepSet, hasSlots ? "done" : "fail");

    if (!hasSlots) {
      if (errorEl) {
        errorEl.textContent = "No set loaded. Build a set in Set Workshop first.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    // Step 3: Check audio availability
    const stepFlags = _addStep(log, "Checking audio availability");
    _markStep(stepFlags, "active");

    try {
      if (typeof setAudioFlagsReady !== "undefined" && setAudioFlagsReady) {
        await setAudioFlagsReady;
      }
      _markStep(stepFlags, "done");
    } catch (e) {
      console.error("Audio flags check failed:", e);
      _markStep(stepFlags, "fail");
    }

    // Step 4: Verify playable tracks
    const stepPlayable = _addStep(log, "Finding playable tracks");
    _markStep(stepPlayable, "active");

    const ready = _hasWorkshopSet();
    _markStep(stepPlayable, ready ? "done" : "fail");

    if (!ready) {
      if (errorEl) {
        errorEl.textContent = "No playable tracks found. Check audio files are available.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    // Step 5: Prepare dancers
    const stepDancers = _addStep(log, "Preparing dancers");
    _markStep(stepDancers, "active");
    // Small delay so the step is visible before it completes
    await new Promise(r => setTimeout(r, 200));
    _markStep(stepDancers, "done");

    // All good — reveal play button
    if (playBtn) {
      playBtn.classList.remove("hidden");
      playBtn.classList.add("dance-ready");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  window.initDanceTab = function () {
    if (_inited) return;
    _inited = true;

    // Cache DOM refs
    _els = {
      settingsBtn:  document.getElementById("dance-settings-btn"),
      backBtn:      document.getElementById("dance-back-btn"),
      performance:  document.getElementById("dance-performance"),
      settingsView: document.getElementById("dance-settings-view"),
      previewPanel: document.getElementById("dance-preview-panel"),
    };

    // Init robots: 3 dance stages in #robot-panel, controls in settings panel
    if (typeof initRobotDancer === "function") {
      const ctrlsTarget = document.getElementById("dance-settings-controls");
      initRobotDancer(ctrlsTarget, { showControls: true });
    }

    // Settings navigation
    if (_els.settingsBtn) _els.settingsBtn.addEventListener("click", _openSettings);
    if (_els.backBtn) _els.backBtn.addEventListener("click", _closeSettings);

    // Robots hidden until Play is clicked
    if (typeof stillRobotDancer === "function") stillRobotDancer();
    const robotPanel = document.getElementById("robot-panel");
    if (robotPanel) robotPanel.style.opacity = "0";

    // Big Play button
    const playBtn = document.getElementById("dance-play-btn");
    if (playBtn) playBtn.addEventListener("click", _onPlayClick);

    // Hook workshop events early so dancers respond to audio state
    _hookWorkshopEvents();

    // ── Dancer window: dynamic sizing ──────────────────────
    _updateDancerWindow();
    window.addEventListener("resize", _updateDancerWindow);

    // Watch the base drawer for class changes (open/expanded)
    const drawer = document.getElementById("base-drawer");
    if (drawer) {
      const obs = new MutationObserver(_updateDancerWindow);
      obs.observe(drawer, { attributes: true, attributeFilter: ["class"] });
    }
  };

  // ── Tab Enter ──────────────────────────────────────────────
  window.startDance = function () {
    if (!_inited) initDanceTab();
    _updateDancerWindow();

    if (_settingsVisible) {
      if (typeof startRobotDancer === "function") startRobotDancer();
      return;
    }

    // If audio is already playing (user started from Workshop), show dancers
    if (typeof setAudio !== "undefined" && setAudio && !setAudio.paused) {
      _playing = true;
      _fadeInDancers();

      // Hide the play overlay since music is already going
      const overlay = document.getElementById("dance-play-overlay");
      if (overlay) {
        overlay.classList.add("fade-out");
        overlay.style.display = "none";
      }
      return;
    }

    // Run init sequence (shows loading steps, then reveals play button)
    if (!_initRan) {
      // Reset overlay visibility in case of re-entry
      const overlay = document.getElementById("dance-play-overlay");
      if (overlay) {
        overlay.classList.remove("fade-out");
        overlay.style.display = "";
      }
      _runInitSequence();
    }
  };

  // ── Tab Leave ──────────────────────────────────────────────
  window.stopDancePlayback = function () {
    _closeSettings();
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  window.stopDanceVisuals = function () {
    _closeSettings();
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  // Init handled by switchTab("dance") → startDance() → initDanceTab()
})();
