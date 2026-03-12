/**
 * dancer-drawer.js — "Shatter" album art into robot dancer body parts
 * inside the now-playing side drawer.
 *
 * States: album → shattering → dancing → reassembling → album
 * Triggers: manual toggle button + random auto-timer (15-30s)
 */
(function () {
  "use strict";

  // ═══ CONSTANTS ════════════════════════════════════════════════
  const VW = 180, VH = 252;
  const CONTAINER_W = 300;
  const SCALE = CONTAINER_W / VW;               // ~1.667
  const CONTAINER_H = Math.round(VH * SCALE);   // ~420

  const PART_NAMES = [
    "head", "torso", "armLU", "armRU", "armLL", "armRL",
    "legLU", "legRU", "legLL", "legRL",
  ];

  // Where each body part's shard sits in the 300×300 album art grid
  // Arranged roughly like a human figure
  const SHARD_LAYOUT = {
    head:  { sx: 112, sy: 0,   sw: 76, sh: 76 },
    armLU: { sx: 0,   sy: 76,  sw: 90, sh: 72 },
    torso: { sx: 90,  sy: 76,  sw: 120, sh: 80 },
    armRU: { sx: 210, sy: 76,  sw: 90, sh: 72 },
    armLL: { sx: 0,   sy: 148, sw: 75, sh: 62 },
    armRL: { sx: 225, sy: 148, sw: 75, sh: 62 },
    legLU: { sx: 75,  sy: 155, sw: 75, sh: 75 },
    legRU: { sx: 150, sy: 155, sw: 75, sh: 75 },
    legLL: { sx: 75,  sy: 230, sw: 75, sh: 70 },
    legRL: { sx: 150, sy: 230, sw: 75, sh: 70 },
  };

  const SHATTER_DURATION = 700;   // ms per shard transition
  const STAGGER_MAX = 250;        // ms max random stagger
  const AUTO_MIN = 15000;         // auto-toggle min interval
  const AUTO_MAX = 30000;         // auto-toggle max interval

  // ═══ STATE ════════════════════════════════════════════════════
  let _mode = "album";            // album | shattering | dancing | reassembling
  let _robotInst = null;
  let _shards = {};               // part name → DOM element
  let _container = null;          // overlay div for shards + robot
  let _robotWrap = null;          // wrapper for the robot stage
  let _artworkSrc = "";           // current album art URL
  let _autoTimer = null;
  let _enabled = false;           // dancer mode toggle state
  let _isPlaying = false;         // is audio currently playing
  let _artworkImg = null;         // reference to #now-playing-artwork
  let _artworkContainer = null;   // reference to .now-playing-artwork-container
  let _toggleBtn = null;

  // ═══ INIT ═════════════════════════════════════════════════════
  function init() {
    _artworkImg = document.getElementById("now-playing-artwork");
    _artworkContainer = _artworkImg?.closest(".now-playing-artwork-container");
    if (!_artworkContainer) return;

    // Create the dancer overlay container (hidden by default)
    _container = document.createElement("div");
    _container.className = "dancer-drawer-container hidden";
    _container.style.cssText = `width:${CONTAINER_W}px;height:${CONTAINER_H}px;`
      + "position:relative;margin:0 auto;overflow:visible;";
    _artworkContainer.parentNode.insertBefore(_container, _artworkContainer.nextSibling);

    // Robot wrapper inside the container
    _robotWrap = document.createElement("div");
    _robotWrap.className = "dancer-drawer-robot hidden";
    _robotWrap.style.cssText = `width:${CONTAINER_W}px;height:${CONTAINER_H}px;`
      + "position:absolute;top:0;left:0;";
    _container.appendChild(_robotWrap);

    // Toggle button — inside artwork container, bottom-right overlay
    _toggleBtn = document.createElement("button");
    _toggleBtn.id = "dancer-mode-btn";
    _toggleBtn.className = "dancer-mode-btn hidden";
    _toggleBtn.title = "Dancer Mode";
    _toggleBtn.innerHTML = "&#x1f57a;";
    _toggleBtn.addEventListener("click", () => {
      setEnabled(!_enabled);
    });
    _artworkContainer.style.position = "relative";
    _artworkContainer.appendChild(_toggleBtn);

    // Listen for existing playset events
    window.addEventListener("playset-track", (e) => {
      _isPlaying = true;
      if (_toggleBtn) _toggleBtn.classList.remove("hidden");
      onTrackChange(e.detail?.track);
      // Set BPM on drawer dancer if available
      const bpm = e.detail?.track?.bpm;
      if (bpm) setBpm(Math.round(bpm));
    });

    window.addEventListener("playset-stopped", () => {
      _isPlaying = false;
      _clearAutoTimer();
      if (_mode === "dancing") {
        _reassembleToAlbum();
      }
    });
  }

  // ═══ SHARD CREATION (CSS background-image approach) ══════════
  function _createShards(imgSrc) {
    _clearShards();
    if (!imgSrc) return;

    PART_NAMES.forEach((name) => {
      const lay = SHARD_LAYOUT[name];
      const el = document.createElement("div");
      el.className = "dancer-shard";
      el.style.cssText =
        `position:absolute;overflow:hidden;will-change:transform,width,height;`
        + `width:${lay.sw}px;height:${lay.sh}px;`
        + `left:${lay.sx}px;top:${lay.sy}px;`
        + `background-image:url("${imgSrc}");`
        + `background-size:300px 300px;`
        + `background-position:-${lay.sx}px -${lay.sy}px;`
        + `border-radius:4px;`
        + `box-shadow:0 0 8px rgba(233,69,96,0.3);`
        + `opacity:1;z-index:5;`;
      _container.appendChild(el);
      _shards[name] = el;
    });
  }

  function _clearShards() {
    Object.values(_shards).forEach(el => el.remove());
    _shards = {};
  }

  // ═══ GET ROBOT TARGET POSITIONS (scaled to container) ════════
  function _getRobotPositions() {
    if (!_robotInst) _ensureRobot();
    const raw = _robotInst.getPartPositions(0); // neutral pose
    const result = {};
    for (const name of PART_NAMES) {
      const p = raw[name];
      if (!p) continue;
      result[name] = {
        x: (p.x - p.w / 2) * SCALE,
        y: (p.y - p.h / 2) * SCALE,
        w: p.w * SCALE,
        h: p.h * SCALE,
        rot: p.rot,
      };
    }
    return result;
  }

  // ═══ ENSURE ROBOT INSTANCE ══════════════════════════════════
  function _ensureRobot() {
    if (_robotInst) return;
    _robotInst = window.createRobotDancer(_robotWrap, { showControls: false });
    _robotInst.init();
    _robotInst.lockArtwork(); // prevent auto-loading random track artwork

    // Scale the primary stage
    const stg = _robotInst.stage();
    if (stg) {
      stg.style.transform = `scale(${SCALE})`;
      stg.style.transformOrigin = "top left";
    }
  }

  // ═══ APPLY ALBUM ART FRAGMENTS TO ROBOT PARTS ═══════════════
  // Instead of random track covers, each body part shows its
  // corresponding region of the currently-playing album art.
  function _applyAlbumArtToRobot(imgSrc) {
    if (!_robotInst || !imgSrc) return;
    const stage = _robotInst.stage();
    if (!stage) return;

    const parts = stage.querySelectorAll(".robot-part");
    // Parts are created in SIZES_BASE key order (same as PART_NAMES)
    parts.forEach((partEl, i) => {
      const name = PART_NAMES[i];
      if (!name) return;
      const lay = SHARD_LAYOUT[name];

      // Use background-image on the part div to show the album fragment
      const partW = partEl.offsetWidth || parseFloat(partEl.style.width);
      const partH = partEl.offsetHeight || parseFloat(partEl.style.height);
      const scaleX = partW / lay.sw;
      const scaleY = partH / lay.sh;
      const bgW = 300 * scaleX;
      const bgH = 300 * scaleY;
      const bgX = -lay.sx * scaleX;
      const bgY = -lay.sy * scaleY;

      partEl.style.backgroundImage = `url("${imgSrc}")`;
      partEl.style.backgroundSize = `${bgW}px ${bgH}px`;
      partEl.style.backgroundPosition = `${bgX}px ${bgY}px`;
      partEl.style.backgroundColor = "transparent";

      // Hide the child <img> so it doesn't overlap
      const img = partEl.querySelector("img");
      if (img) img.style.display = "none";
    });
  }

  // ═══ SHATTER: ALBUM → DANCING ═══════════════════════════════
  function _shatterToRobot() {
    if (_mode !== "album") return;
    _mode = "shattering";

    // Grab current artwork src
    _artworkSrc = _artworkImg?.src || "";
    if (!_artworkSrc) { _mode = "album"; return; }

    _ensureRobot();

    // Show container, hide artwork
    _container.classList.remove("hidden");
    _artworkImg.classList.add("hidden");

    // Create shards at album-grid positions
    _createShards(_artworkSrc);

    // Get target positions from robot
    const targets = _getRobotPositions();

    // Animate each shard to its robot body-part position
    let maxDelay = 0;
    PART_NAMES.forEach((name) => {
      const shard = _shards[name];
      const target = targets[name];
      const lay = SHARD_LAYOUT[name];
      if (!shard || !target) return;

      const delay = Math.random() * STAGGER_MAX;
      maxDelay = Math.max(maxDelay, delay);

      // Force layout before adding transition
      shard.getBoundingClientRect();

      shard.style.transition =
        `left ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
        + `top ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
        + `width ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
        + `height ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
        + `border-radius ${SHATTER_DURATION}ms ease ${delay}ms, `
        + `background-size ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
        + `background-position ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`;

      // Compute new background-position to keep the same region visible at the new size
      const scaleX = target.w / lay.sw;
      const scaleY = target.h / lay.sh;
      const newBgW = 300 * scaleX;
      const newBgH = 300 * scaleY;
      const newBgX = -lay.sx * scaleX;
      const newBgY = -lay.sy * scaleY;

      requestAnimationFrame(() => {
        shard.style.left = `${target.x}px`;
        shard.style.top = `${target.y}px`;
        shard.style.width = `${target.w}px`;
        shard.style.height = `${target.h}px`;
        shard.style.borderRadius = "15%";
        shard.style.backgroundSize = `${newBgW}px ${newBgH}px`;
        shard.style.backgroundPosition = `${newBgX}px ${newBgY}px`;
      });
    });

    // After all transitions complete, swap to real robot
    const totalTime = SHATTER_DURATION + maxDelay + 50;
    setTimeout(() => {
      _clearShards();
      _robotWrap.classList.remove("hidden");
      _robotWrap.style.opacity = "0";
      _robotWrap.style.transition = "opacity 0.4s ease";
      requestAnimationFrame(() => { _robotWrap.style.opacity = "1"; });
      _robotInst.start();
      _applyAlbumArtToRobot(_artworkSrc);
      _robotInst.lockArtwork();
      _mode = "dancing";
      _scheduleAutoToggle();
    }, totalTime);
  }

  // ═══ REASSEMBLE: DANCING → ALBUM ════════════════════════════
  function _reassembleToAlbum() {
    if (_mode !== "dancing") return;
    _mode = "reassembling";

    // Stop robot
    _robotInst.stop();

    // Get current robot positions for shard starting points
    const positions = _getRobotPositions();

    // Recreate shards at robot positions
    _artworkSrc = _artworkImg?.src || _artworkSrc;
    if (!_artworkSrc) { _finishReassemble(); return; }

    PART_NAMES.forEach((name) => {
      const pos = positions[name];
      const lay = SHARD_LAYOUT[name];
      if (!pos) return;

      const scaleX = pos.w / lay.sw;
      const scaleY = pos.h / lay.sh;
      const bgW = 300 * scaleX;
      const bgH = 300 * scaleY;
      const bgX = -lay.sx * scaleX;
      const bgY = -lay.sy * scaleY;

      const el = document.createElement("div");
      el.className = "dancer-shard";
      el.style.cssText =
        `position:absolute;overflow:hidden;will-change:transform,width,height;`
        + `width:${pos.w}px;height:${pos.h}px;`
        + `left:${pos.x}px;top:${pos.y}px;`
        + `background-image:url("${_artworkSrc}");`
        + `background-size:${bgW}px ${bgH}px;`
        + `background-position:${bgX}px ${bgY}px;`
        + `border-radius:15%;`
        + `box-shadow:0 0 8px rgba(233,69,96,0.3);`
        + `opacity:1;z-index:5;`;
      _container.appendChild(el);
      _shards[name] = el;
    });

    // Hide robot, show shards
    _robotWrap.classList.add("hidden");
    _robotWrap.style.transition = "";
    _robotWrap.style.opacity = "";

    // Animate shards back to album grid positions
    let maxDelay = 0;
    requestAnimationFrame(() => {
      PART_NAMES.forEach((name) => {
        const shard = _shards[name];
        const lay = SHARD_LAYOUT[name];
        if (!shard) return;

        const delay = Math.random() * STAGGER_MAX;
        maxDelay = Math.max(maxDelay, delay);

        shard.style.transition =
          `left ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
          + `top ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
          + `width ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
          + `height ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
          + `border-radius ${SHATTER_DURATION}ms ease ${delay}ms, `
          + `background-size ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, `
          + `background-position ${SHATTER_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`;

        requestAnimationFrame(() => {
          shard.style.left = `${lay.sx}px`;
          shard.style.top = `${lay.sy}px`;
          shard.style.width = `${lay.sw}px`;
          shard.style.height = `${lay.sh}px`;
          shard.style.borderRadius = "4px";
          shard.style.backgroundSize = "300px 300px";
          shard.style.backgroundPosition = `-${lay.sx}px -${lay.sy}px`;
        });
      });

      setTimeout(() => _finishReassemble(), SHATTER_DURATION + maxDelay + 50);
    });
  }

  function _finishReassemble() {
    _clearShards();
    _container.classList.add("hidden");
    _artworkImg.classList.remove("hidden");
    _mode = "album";
    if (_enabled && _isPlaying) _scheduleAutoToggle();
  }

  // ═══ TOGGLE ═════════════════════════════════════════════════
  function toggle() {
    if (_mode === "album") {
      _shatterToRobot();
    } else if (_mode === "dancing") {
      _reassembleToAlbum();
    }
    // ignore if mid-transition
  }

  // ═══ AUTO-TIMER ═════════════════════════════════════════════
  function _scheduleAutoToggle() {
    _clearAutoTimer();
    if (!_enabled || !_isPlaying) return;
    const delay = AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN);
    _autoTimer = setTimeout(() => {
      if (!_enabled || !_isPlaying) return;
      toggle();
    }, delay);
  }

  function _clearAutoTimer() {
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
  }

  // ═══ EXTERNAL HOOKS ═════════════════════════════════════════

  // Called when now-playing track changes
  function onTrackChange(track) {
    // Wait briefly for the artwork img to load the new cover, then re-apply
    if (_mode === "dancing" && _robotInst) {
      const checkSrc = () => {
        const src = _artworkImg?.src || "";
        if (src && src !== _artworkSrc) {
          _artworkSrc = src;
          _applyAlbumArtToRobot(src);
          _robotInst.lockArtwork();
        }
      };
      // Artwork loads async; poll briefly
      setTimeout(checkSrc, 500);
      setTimeout(checkSrc, 1500);
    }
    // Reset auto timer on track change
    if (_enabled && _isPlaying) _scheduleAutoToggle();
  }

  // Called when play state changes
  function onPlayStateChange(playing) {
    _isPlaying = playing;
    if (playing) {
      // Show toggle button
      if (_toggleBtn) _toggleBtn.classList.remove("hidden");
      if (_enabled) _scheduleAutoToggle();
      if (_mode === "dancing" && _robotInst) _robotInst.start();
    } else {
      _clearAutoTimer();
      if (_mode === "dancing" && _robotInst) _robotInst.stop();
    }
  }

  // Toggle dancer mode on/off (the button)
  function setEnabled(on) {
    _enabled = on;
    if (_toggleBtn) {
      _toggleBtn.classList.toggle("active", on);
    }
    if (on && _isPlaying && _mode === "album") {
      _shatterToRobot();
    } else if (!on && _mode === "dancing") {
      _reassembleToAlbum();
    }
    _clearAutoTimer();
    if (on && _isPlaying) _scheduleAutoToggle();
  }

  // Set BPM on the drawer dancer
  function setBpm(bpm) {
    if (_robotInst && _robotInst.setBpm) _robotInst.setBpm(bpm);
  }

  // ═══ PUBLIC API ═════════════════════════════════════════════
  window.drawerDancer = {
    init,
    toggle,
    onTrackChange,
    onPlayStateChange,
    setEnabled,
    setBpm,
    isEnabled: () => _enabled,
    mode: () => _mode,
  };

  // Auto-init when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
