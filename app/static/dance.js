/* ── Dance Tab ─────────────────────────────────────────────
   3 robots in still pose on load. Player bar at bottom.
   Music starts when user presses play → enters Workshop play mode.
   Seamless switching between Workshop and Dance while playing.
   Falls back to "I Feel Love" + leaf if no workshop set.

   Boot sequence: fade-in robots (5s) → show player bar → resolve mode.
   BPM sync: robot tempo matches currently playing track.
   Settings drawer: gear button toggles robot controls panel.
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let _mode = null;          // "workshop" | "standalone" | null
  let _playing = false;      // robots should be dancing
  let _inited = false;
  let _audioHooked = false;  // setAudio listeners attached?

  // Boot sequence
  let _bootPhase = "idle";   // "idle" | "fading_in" | "ready"
  let _fadeCompleted = false;

  // Settings drawer
  let _settingsOpen = false;

  // Standalone fallback (I Feel Love + leaf)
  let _ownAudio = null;
  let _ownQueue = [];
  let _ownQueueIdx = -1;

  // ── DOM refs ───────────────────────────────────────────────
  let _els = {};

  // ── Helpers ────────────────────────────────────────────────
  function _fmt(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function _loadArt(artist, title, imgEl) {
    if (!artist || !title || !imgEl) return;
    fetch(`/api/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then(r => r.json())
      .then(data => {
        const url = data.cover_big || data.cover_url || "";
        if (url) imgEl.src = url;
      })
      .catch(() => {});
  }

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

  // ── Active audio element (depends on mode) ─────────────────
  function _audio() {
    if (_mode === "workshop" && typeof setAudio !== "undefined") return setAudio;
    if (_mode === "standalone") return _ownAudio;
    return null;
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

  function _workshopCurrentTrack() {
    if (typeof setSlots === "undefined" || typeof setPlaySetIndex === "undefined") return null;
    const slot = setSlots[setPlaySetIndex];
    if (!slot || slot.selectedTrackIndex == null) return null;
    return slot.tracks[slot.selectedTrackIndex] || null;
  }

  function _workshopFirstTrack() {
    if (typeof setSlots === "undefined") return null;
    for (const slot of setSlots) {
      if (slot.selectedTrackIndex != null) {
        const t = slot.tracks?.[slot.selectedTrackIndex];
        if (t?.has_audio) return t;
      }
    }
    return null;
  }

  // ── Determine mode & populate player bar ───────────────────
  function _resolveMode() {
    if (_hasWorkshopSet()) {
      _mode = "workshop";
      _hookWorkshopAudio();
      // Show first track (or current if already playing)
      const track = (typeof isPlaySetMode === "function" && isPlaySetMode())
        ? _workshopCurrentTrack()
        : _workshopFirstTrack();
      if (track) _updatePlayerTrackInfo(track);
    } else {
      _mode = "standalone";
      if (_ownQueue.length === 0) _buildStandaloneQueue();
    }
  }

  // ── Hook into Workshop's setAudio events ───────────────────
  function _hookWorkshopAudio() {
    if (_audioHooked) return;
    _audioHooked = true;

    // Progress from setAudio
    if (typeof setAudio !== "undefined" && setAudio) {
      setAudio.addEventListener("timeupdate", _onProgress);
    }

    // Track change from Workshop's playFullTrack
    window.addEventListener("playset-track", (e) => {
      if (_mode === "workshop") {
        _updatePlayerTrackInfo(e.detail.track);
        _syncBpm(e.detail.track);
      }
    });

    // Play mode exited from Workshop
    window.addEventListener("playset-stopped", () => {
      _playing = false;
      _setPlayIcon();
      _resetProgress();
      if (typeof stopRobotDancer === "function") stopRobotDancer();
      if (typeof stillRobotDancer === "function") stillRobotDancer();
    });
  }

  // ── Player Bar Updates ─────────────────────────────────────

  function _updatePlayerTrackInfo(track) {
    if (!track || !_els.title) return;
    _els.title.textContent = track.title || "";
    _els.artist.textContent = track.artist || "";
    _loadArt(track.artist, track.title, _els.artwork);
  }

  function _onProgress() {
    const a = _audio();
    if (!a || !a.duration) return;
    const pct = (a.currentTime / a.duration) * 100;
    _els.progressFill.style.width = pct + "%";
    _els.current.textContent = _fmt(a.currentTime);
    _els.duration.textContent = _fmt(a.duration);
  }

  function _resetProgress() {
    if (!_els.progressFill) return;
    _els.progressFill.style.width = "0%";
    _els.current.textContent = "0:00";
    _els.duration.textContent = "0:00";
  }

  function _setPlayIcon() {
    if (_els.playBtn) { _els.playBtn.innerHTML = "&#9654;"; _els.playBtn.title = "Play"; }
  }

  function _setPauseIcon() {
    if (_els.playBtn) { _els.playBtn.innerHTML = "&#9646;&#9646;"; _els.playBtn.title = "Pause"; }
  }

  // ═══════════════════════════════════════════════════════════
  // WORKSHOP MODE — delegates to setbuilder.js play set
  // ═══════════════════════════════════════════════════════════

  function _workshopToggle() {
    if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
      // Already playing — toggle pause
      if (typeof togglePlaySetPause === "function") togglePlaySetPause();
      if (setAudio && setAudio.paused) {
        _playing = false;
        _setPlayIcon();
        if (typeof stopRobotDancer === "function") stopRobotDancer();
        if (typeof stillRobotDancer === "function") stillRobotDancer();
      } else {
        _playing = true;
        _setPauseIcon();
        if (typeof startRobotDancer === "function") startRobotDancer();
      }
    } else {
      // Enter play set mode
      if (typeof switchMode === "function") switchMode("playset");
      // Check if it actually entered (might fail if no playable slots)
      if (typeof isPlaySetMode === "function" && isPlaySetMode()) {
        _playing = true;
        _setPauseIcon();
        if (typeof startRobotDancer === "function") startRobotDancer();
        const track = _workshopCurrentTrack();
        if (track) _syncBpm(track);
      }
    }
  }

  function _workshopNext() {
    if (typeof playSetNext === "function") playSetNext();
  }

  function _workshopPrev() {
    if (typeof playSetPrev === "function") playSetPrev();
  }

  function _workshopSeek(pct) {
    if (typeof setAudio !== "undefined" && setAudio && setAudio.duration) {
      setAudio.currentTime = pct * setAudio.duration;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STANDALONE MODE — own audio, I Feel Love + leaf queue
  // ═══════════════════════════════════════════════════════════

  async function _buildStandaloneQueue() {
    try {
      const res = await fetch("/api/set-workshop/track-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "I Feel Love" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const tracks = data.tracks || [];
      const match = tracks.find(t => {
        const title = (t.title || "").toLowerCase();
        return title.includes("i feel love") && title.includes("edit");
      }) || tracks.find(t =>
        (t.title || "").toLowerCase().includes("i feel love")
      );
      if (!match) return;

      // Try to get the leaf for more tracks
      const ctxRes = await fetch(`/api/set-workshop/track-context/${match.id}`);
      if (ctxRes.ok) {
        const ctx = await ctxRes.json();
        if (ctx.collection_leaf?.available && ctx.collection_leaf?.id) {
          const leafId = ctx.collection_leaf.id;
          const detailRes = await fetch(
            `/api/set-workshop/source-detail?source_type=tree_node&source_id=${encodeURIComponent(leafId)}&tree_type=collection`
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const leafTracks = (detail.tracks || []).filter(t => t.has_audio);
            if (leafTracks.length > 0) {
              const rest = leafTracks.filter(t => t.id !== match.id);
              _ownQueue = [match, ..._shuffle(rest)];
              _ownQueueIdx = 0;
              if (_mode === "standalone") _updatePlayerTrackInfo(match);
              return;
            }
          }
        }
      }

      // Fallback: just the one track
      _ownQueue = [match];
      _ownQueueIdx = 0;
      if (_mode === "standalone") _updatePlayerTrackInfo(match);
    } catch (_) {}
  }

  function _standaloneToggle() {
    if (!_ownAudio) return;
    if (_playing) {
      _ownAudio.pause();
      _playing = false;
      _setPlayIcon();
      if (typeof stopRobotDancer === "function") stopRobotDancer();
      if (typeof stillRobotDancer === "function") stillRobotDancer();
    } else {
      if (_ownQueue.length === 0) return;
      if (!_ownAudio.src || _ownAudio.src === location.href) {
        _standalonePlay(_ownQueueIdx >= 0 ? _ownQueueIdx : 0);
      } else {
        _ownAudio.play().catch(() => {});
        _playing = true;
        _setPauseIcon();
        if (typeof startRobotDancer === "function") startRobotDancer();
      }
    }
  }

  function _standalonePlay(idx) {
    if (idx < 0 || idx >= _ownQueue.length) return;
    _ownQueueIdx = idx;
    const track = _ownQueue[idx];
    _updatePlayerTrackInfo(track);
    _syncBpm(track);
    _ownAudio.src = `/api/audio/${track.id}`;
    _ownAudio.load();
    _ownAudio.play().catch(err => {
      if (err.name === "AbortError") return;
    });
    _playing = true;
    _setPauseIcon();
    if (typeof startRobotDancer === "function") startRobotDancer();
  }

  function _standaloneNext() {
    if (_ownQueue.length === 0) return;
    const next = _ownQueueIdx + 1;
    if (next < _ownQueue.length) {
      _standalonePlay(next);
    } else {
      // Reshuffle and loop
      _ownQueue = _shuffle(_ownQueue);
      _standalonePlay(0);
    }
  }

  function _standalonePrev() {
    if (_ownQueue.length === 0) return;
    if (_ownAudio.currentTime > 3) {
      _ownAudio.currentTime = 0;
      return;
    }
    const prev = _ownQueueIdx - 1;
    if (prev >= 0) _standalonePlay(prev);
  }

  function _standaloneSeek(pct) {
    if (_ownAudio && _ownAudio.duration) {
      _ownAudio.currentTime = pct * _ownAudio.duration;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UNIFIED CONTROLS — route to workshop or standalone
  // ═══════════════════════════════════════════════════════════

  function _onToggle()  { _mode === "workshop" ? _workshopToggle()  : _standaloneToggle(); }
  function _onNext()    { _mode === "workshop" ? _workshopNext()    : _standaloneNext(); }
  function _onPrev()    { _mode === "workshop" ? _workshopPrev()    : _standalonePrev(); }
  function _onSeek(e)   {
    const a = _audio();
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    _mode === "workshop" ? _workshopSeek(pct) : _standaloneSeek(pct);
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT SEQUENCE — fade-in → player bar → resolve mode
  // ═══════════════════════════════════════════════════════════

  function _onFadeComplete() {
    if (_fadeCompleted) return; // guard against double-fire
    _fadeCompleted = true;

    // Show the player drawer (slide up)
    const danceTab = document.getElementById("tab-dance");
    if (danceTab && !danceTab.classList.contains("hidden")) {
      if (_els.player) _els.player.classList.add("visible");
    }

    // After player slide-up animation (350ms), resolve mode
    setTimeout(() => {
      _bootPhase = "ready";
      _resolveMode();
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  window.initDanceTab = function () {
    if (_inited) return;
    _inited = true;

    // Cache DOM refs
    _els = {
      player:         document.getElementById("dance-player"),
      artwork:        document.getElementById("dance-pl-artwork"),
      title:          document.getElementById("dance-pl-title"),
      artist:         document.getElementById("dance-pl-artist"),
      playBtn:        document.getElementById("dance-pl-play"),
      prevBtn:        document.getElementById("dance-pl-prev"),
      nextBtn:        document.getElementById("dance-pl-next"),
      progressBar:    document.getElementById("dance-pl-progress-bar"),
      progressFill:   document.getElementById("dance-pl-progress-fill"),
      current:        document.getElementById("dance-pl-current"),
      duration:       document.getElementById("dance-pl-duration"),
      settingsBtn:    document.getElementById("dance-settings-btn"),
      settingsDrawer: document.getElementById("dance-settings-drawer"),
    };

    // Init robots with controls in hidden settings drawer
    if (typeof initRobotDancer === "function") {
      initRobotDancer(_els.settingsDrawer, { showControls: true });
    }

    // Standalone audio (only used if no workshop set)
    _ownAudio = new Audio();
    _ownAudio.volume = 0.7;
    _ownAudio.addEventListener("timeupdate", _onProgress);
    _ownAudio.addEventListener("ended", _standaloneNext);
    _ownAudio.addEventListener("error", () => {
      if (_ownAudio.currentTime > 0) _standaloneNext();
    });

    // Player controls
    _els.playBtn.addEventListener("click", _onToggle);
    _els.prevBtn.addEventListener("click", _onPrev);
    _els.nextBtn.addEventListener("click", _onNext);
    _els.progressBar.addEventListener("click", _onSeek);

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
    if (_bootPhase === "ready") {
      _resolveMode();
    }
    // If still fading, _resolveMode will run when boot reaches "ready"
  };

  // ── Tab Enter ──────────────────────────────────────────────

  window.startDance = function () {
    if (!_inited) initDanceTab();

    // Only show player bar and resolve mode if boot is complete
    if (_bootPhase === "ready") {
      if (_els.player) _els.player.classList.add("visible");

      // Re-check mode (workshop state may have changed)
      _resolveMode();

      // Sync with current playback state
      if (_mode === "workshop" && typeof isPlaySetMode === "function" && isPlaySetMode()) {
        // Workshop is already in play mode — sync visuals
        _playing = true;
        _setPauseIcon();
        const track = _workshopCurrentTrack();
        if (track) {
          _updatePlayerTrackInfo(track);
          _syncBpm(track);
        }
        if (typeof startRobotDancer === "function") startRobotDancer();
      } else if (_mode === "standalone" && _playing) {
        // Was playing standalone when we left — resume
        _ownAudio.play().catch(() => {});
        _setPauseIcon();
        if (typeof startRobotDancer === "function") startRobotDancer();
      } else {
        // Not playing — show still robots
        _playing = false;
        _setPlayIcon();
        if (typeof stillRobotDancer === "function") stillRobotDancer();
      }
    }
  };

  // ── Tab Leave ──────────────────────────────────────────────

  // Full stop: hide player, stop robots, pause standalone audio
  window.stopDancePlayback = function () {
    if (_els.player) _els.player.classList.remove("visible");
    if (typeof stopRobotDancer === "function") stopRobotDancer();

    if (_mode === "standalone" && _playing) {
      _ownAudio.pause();
      // Keep _playing = true so we resume on re-enter
    }
    // Workshop audio: don't touch it — Workshop manages its own audio
  };

  // Visual-only stop: hide player bar, stop robots, but leave all audio untouched
  // Used when switching Dance → Workshop (playback continues in Workshop UI)
  window.stopDanceVisuals = function () {
    if (_els.player) _els.player.classList.remove("visible");
    if (typeof stopRobotDancer === "function") stopRobotDancer();
    // Don't touch _playing — Workshop is still playing
  };

  // ── Eager init ─────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDanceTab());
  } else {
    initDanceTab();
  }
})();
