/* ── Dance Tab ─────────────────────────────────────────────
   3 robots in still pose on load, 5-second fade-in.
   After fade: enters Workshop play mode → base drawer appears.
   BPM sync: robot tempo matches currently playing track.
   Settings drawer: gear button toggles robot controls panel.
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

  // Settings drawer
  let _settingsOpen = false;

  // ── DOM refs ───────────────────────────────────────────────
  let _els = {};

  // ── BPM sync ──────────────────────────────────────────────
  function _syncBpm(track) {
    if (track?.bpm && typeof setRobotBpm === "function") {
      setRobotBpm(Math.round(track.bpm));
    }
  }

  // ── Settings drawer toggle ────────────────────────────────
  function _toggleSettings() {
    _settingsOpen = !_settingsOpen;
    if (_els.settingsDrawer) _els.settingsDrawer.classList.toggle("open", _settingsOpen);
    if (_els.settingsBtn) _els.settingsBtn.classList.toggle("active", _settingsOpen);
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

    // Track change — sync BPM to robot
    window.addEventListener("playset-track", (e) => {
      _syncBpm(e.detail.track);
    });

    // Play mode stopped
    window.addEventListener("playset-stopped", () => {
      _playing = false;
      if (typeof stopRobotDancer === "function") stopRobotDancer();
      if (typeof stillRobotDancer === "function") stillRobotDancer();
    });
  }

  // ── Enter play mode → base drawer appears ──────────────────
  function _enterPlayMode() {
    if (!_hasWorkshopSet()) return;

    // Enter play set mode (starts first track, opens right drawer)
    if (typeof switchMode === "function") switchMode("playset");

    // Verify it actually entered play mode
    if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
      _playing = true;
      if (typeof startRobotDancer === "function") startRobotDancer();

      // Transition from the (invisible) right drawer to the base drawer
      setTimeout(() => {
        if (typeof closeDrawer === "function") closeDrawer();
      }, 100);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT SEQUENCE — fade-in → enter play mode → base drawer
  // ═══════════════════════════════════════════════════════════

  function _onFadeComplete() {
    if (_fadeCompleted) return; // guard against double-fire
    _fadeCompleted = true;
    _bootPhase = "ready";

    _hookWorkshopEvents();
    _enterPlayMode();
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  window.initDanceTab = function () {
    if (_inited) return;
    _inited = true;

    // Cache DOM refs
    _els = {
      settingsBtn:    document.getElementById("dance-settings-btn"),
      settingsDrawer: document.getElementById("dance-settings-drawer"),
    };

    // Init robots with controls built into the hidden settings drawer
    if (typeof initRobotDancer === "function") {
      initRobotDancer(_els.settingsDrawer, { showControls: true });
    }

    // Settings drawer toggle
    if (_els.settingsBtn) {
      _els.settingsBtn.addEventListener("click", _toggleSettings);
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
      _enterPlayMode();
    }
    // If still fading, _enterPlayMode will run when boot reaches "ready"
  };

  // ── Tab Enter ──────────────────────────────────────────────

  window.startDance = function () {
    if (!_inited) initDanceTab();

    if (_bootPhase !== "ready") return;

    if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
      // Already in play mode — sync robots + ensure base drawer is visible
      _playing = true;
      if (typeof startRobotDancer === "function") startRobotDancer();

      // Make sure base drawer is showing (it may have been closed on another tab)
      const bd = document.getElementById("base-drawer");
      if (bd && !bd.classList.contains("open")) {
        if (typeof transitionToBaseDrawer === "function") transitionToBaseDrawer();
      }
    } else if (!_playing) {
      // Not yet in play mode — try to enter
      _enterPlayMode();
    }
  };

  // ── Tab Leave ──────────────────────────────────────────────

  // Full stop: stop robots, but leave workshop audio/base drawer untouched
  window.stopDancePlayback = function () {
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  // Visual-only stop: stop robots, leave audio playing
  // Used when switching Dance → Workshop (playback continues in Workshop UI)
  window.stopDanceVisuals = function () {
    if (typeof stopRobotDancer === "function") stopRobotDancer();
  };

  // ── Eager init ─────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDanceTab());
  } else {
    initDanceTab();
  }
})();
