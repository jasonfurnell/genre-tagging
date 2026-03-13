/* ── Dance Tab ─────────────────────────────────────────────
   Big Play button on every load. Click → dancers fade in,
   Full Track playback starts from slot 0.
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

  // Settings view
  let _settingsVisible = false;
  let _previewStageAdded = false;

  // ── DOM refs ───────────────────────────────────────────────
  let _els = {};

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
  };

  // ── Tab Enter ──────────────────────────────────────────────
  window.startDance = function () {
    if (!_inited) initDanceTab();

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
