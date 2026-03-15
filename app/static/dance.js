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


  // Settings view
  let _settingsVisible = false;
  let _previewStageAdded = false;

  // ── DOM refs ───────────────────────────────────────────────
  let _els = {};

  // ── Dancer window sizing ─────────────────────────────────
  // Dynamically measures nav bar and bottom drawer to compute
  // the true visible area, then sizes #dancer-window to fit.
  // 4 track covers high when drawer is expanded (matches workshop grid)
  const DANCER_EXPANDED_H = 4 * 56;  // 4 × (48img + 8pad) = 224

  function _updateDancerWindow() {
    const win = document.getElementById("dancer-window");
    if (!win) return;

    const nav = document.getElementById("tab-bar");
    const drawer = document.getElementById("base-drawer");
    const header = document.querySelector(".unified-header");

    const navH = nav ? nav.getBoundingClientRect().height : 0;
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const isExpanded = drawer && drawer.classList.contains("expanded");
    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    let h;
    if (isExpanded && isMobile) {
      // Fixed 5-cover height; drawer fills the rest
      h = DANCER_EXPANDED_H;
      const drawerH = window.innerHeight - headerH - DANCER_EXPANDED_H;
      if (drawer) drawer.style.height = Math.max(drawerH, 120) + "px";
    } else {
      if (drawer) drawer.style.height = "";
      const drawerH = (drawer && drawer.classList.contains("open"))
        ? drawer.getBoundingClientRect().height : 0;
      h = window.innerHeight - navH - drawerH;
    }
    win.style.height = Math.max(h, 100) + "px";

    // Scale robot panel to fit within 80% of the dancer window
    const panel = document.getElementById("robot-panel");
    if (panel) {
      // Reset scale to measure natural height
      panel.style.transform = "";
      const naturalH = panel.scrollHeight;
      const maxH = h * 0.8;
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

    // Robots hidden until playback starts (base drawer handles play)
    if (typeof stillRobotDancer === "function") stillRobotDancer();
    const robotPanel = document.getElementById("robot-panel");
    if (robotPanel) robotPanel.style.opacity = "0";

    // Hide the legacy play overlay — init is now in the base drawer
    const overlay = document.getElementById("dance-play-overlay");
    if (overlay) overlay.style.display = "none";

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
