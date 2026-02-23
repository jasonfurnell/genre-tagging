/* ── Dance Tab ─────────────────────────────────────────────
   3 robots in still pose on load, 5-second fade-in.
   After fade: enters Workshop play mode → base drawer appears.
   BPM sync: robot tempo matches currently playing track.
   Settings view: gear button navigates to full-page settings with preview robot.
   Uses the Workshop's base drawer (same bottom drawer across all tabs).
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let _inited = false;
  let _playing = false;
  let _eventsHooked = false;

  // Boot sequence
  let _bootPhase = "idle";   // "idle" | "fading_in" | "ready"
  let _fadeCompleted = false;
  let _fadingOut = false;     // true while fade-out transition is running

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

    // Lazy: add preview stage the first time settings opens
    if (!_previewStageAdded && typeof addRobotStage === "function" && _els.previewPanel) {
      addRobotStage(_els.previewPanel, 1.5);
      _previewStageAdded = true;
    }

    // Ensure animation running for preview
    if (typeof startRobotDancer === "function") startRobotDancer();
  }

  function _closeSettings() {
    if (!_settingsVisible) return;
    _settingsVisible = false;

    if (_els.settingsView) _els.settingsView.classList.add("hidden");
    if (_els.performance) _els.performance.classList.remove("hidden");

    // Exit pose preview so performance robots return to dancing
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

    // Track change — sync BPM + auto-resume dancers if stopped
    window.addEventListener("playset-track", (e) => {
      _syncBpm(e.detail.track);
      // Auto-fade-in dancers when a track starts (ties visibility to actual playback)
      if (!_playing && _bootPhase === "ready") {
        _playing = true;
        _fadeInDancers();
      }
    });

    // Play mode stopped — fade out dancers, then freeze
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
      // Only freeze if we haven't started playing again mid-fade
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

    // Cancel any in-progress fade-out
    if (_fadingOut) _fadingOut = false;

    // Start dancers before fading in so they're already moving as they appear
    if (typeof startRobotDancer === "function") startRobotDancer();
    robotPanel.style.opacity = "1";
  }

  // ── Enter play mode → base drawer appears ──────────────────
  // dancerDelay: ms to wait after song starts before robots begin dancing
  function _enterPlayMode(dancerDelay) {
    if (!_hasWorkshopSet()) return;

    // Hide the right-hand drawer so it doesn't flash during the transition
    const setDrawer = document.getElementById("set-drawer");
    if (setDrawer) setDrawer.style.visibility = "hidden";

    // Enter play set mode (starts first track, opens right drawer)
    if (typeof switchMode === "function") switchMode("playset");

    // Verify it actually entered play mode
    if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
      _playing = true;

      // Start robots immediately or after a delay (lets the song get going first)
      if (dancerDelay > 0) {
        setTimeout(() => {
          if (_playing) _fadeInDancers();
        }, dancerDelay);
      } else {
        _fadeInDancers();
      }

      // Transition from the (hidden) right drawer to the base drawer
      setTimeout(() => {
        if (typeof closeDrawer === "function") closeDrawer();
        // Restore visibility after closeDrawer removes .open synchronously
        if (setDrawer) setDrawer.style.visibility = "";
      }, 100);
    } else {
      // Restore if play mode wasn't entered
      if (setDrawer) setDrawer.style.visibility = "";
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT SEQUENCE — fade-in → enter play mode → base drawer
  // ═══════════════════════════════════════════════════════════

  function _onFadeComplete() {
    if (_fadeCompleted) return; // guard against double-fire
    _fadeCompleted = true;
    _bootPhase = "ready";

    // Switch from boot animation to CSS transition for future play/stop fades
    const robotPanel = document.getElementById("robot-panel");
    if (robotPanel) {
      robotPanel.classList.remove("dance-fade-in");
      robotPanel.style.opacity = "1";
      robotPanel.classList.add("dance-live");
    }

    _hookWorkshopEvents();
    _enterPlayMode(3000);  // let the song play for 3s before robots start
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
    if (_els.settingsBtn) {
      _els.settingsBtn.addEventListener("click", _openSettings);
    }
    if (_els.backBtn) {
      _els.backBtn.addEventListener("click", _closeSettings);
    }

    // Show still pose
    if (typeof stillRobotDancer === "function") stillRobotDancer();

    // Start 5-second fade-in
    const robotPanel = document.getElementById("robot-panel");
    if (robotPanel) {
      robotPanel.classList.add("dance-fade-in");
      robotPanel.addEventListener("animationend", _onFadeComplete, { once: true });
    }
    _bootPhase = "fading_in";

    // Fallback in case animationend doesn't fire
    setTimeout(_onFadeComplete, 5200);
  };

  // ── Called after CSV upload/restore to refresh state ────────
  window.refreshDance = function () {
    if (!_inited) return;
    if (_bootPhase === "ready" && !_playing) {
      _enterPlayMode(0);
    }
    // If still fading, _enterPlayMode will run when boot reaches "ready"
  };

  // ── Tab Enter ──────────────────────────────────────────────

  window.startDance = function () {
    if (!_inited) initDanceTab();

    if (_bootPhase !== "ready") return;

    // If in settings view, just ensure preview robot is running
    if (_settingsVisible) {
      if (typeof startRobotDancer === "function") startRobotDancer();
      return;
    }

    if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
      // Already in play mode — sync robots + ensure base drawer is visible
      _playing = true;
      _fadeInDancers();

      // Make sure base drawer is showing (it may have been closed on another tab)
      const bd = document.getElementById("base-drawer");
      if (bd && !bd.classList.contains("open")) {
        if (typeof transitionToBaseDrawer === "function") transitionToBaseDrawer();
      }
    } else if (!_playing) {
      // Not yet in play mode — try to enter
      _enterPlayMode(0);
    }
  };

  // ── Tab Leave ──────────────────────────────────────────────

  // Full stop: stop robots, but leave workshop audio/base drawer untouched
  window.stopDancePlayback = function () {
    _closeSettings();
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  // Visual-only stop: stop robots, leave audio playing
  // Used when switching Dance → Workshop (playback continues in Workshop UI)
  window.stopDanceVisuals = function () {
    _closeSettings();
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  // ── Eager init ─────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDanceTab());
  } else {
    initDanceTab();
  }
})();
