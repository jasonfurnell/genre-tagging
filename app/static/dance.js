/* ── Dance Tab ─────────────────────────────────────────────
   Robot dances + "I Feel Love" plays automatically on tab visit.
   Stops when user leaves the tab.
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  let _audio = null;
  let _trackId = null;
  let _inited = false;

  async function _findTrack() {
    try {
      const res = await fetch("/api/set-workshop/track-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "I Feel Love" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const tracks = data.tracks || [];
      const match = tracks.find(t => {
        const title = (t.title || "").toLowerCase();
        return title.includes("i feel love") && title.includes("edit");
      });
      return match ? match.id : (tracks[0] ? tracks[0].id : null);
    } catch (_) { return null; }
  }

  window.initDanceTab = function () {
    if (_inited) return;
    _inited = true;
    const sidebar = document.getElementById("dance-controls-sidebar");
    if (typeof initRobotDancer === "function") initRobotDancer(sidebar);
  };

  window.startDance = async function () {
    if (!_inited) initDanceTab();
    // fade in + start robot
    const panel = document.getElementById("robot-panel");
    if (panel) requestAnimationFrame(() => panel.classList.add("dance-visible"));
    if (typeof startRobotDancer === "function") startRobotDancer();
    // start audio
    if (!_audio) {
      _audio = new Audio();
      _audio.loop = true;
    }
    if (!_trackId) _trackId = await _findTrack();
    if (_trackId) {
      _audio.src = `/api/audio/${_trackId}`;
      _audio.play().catch(() => {});
    }
  };

  window.stopDancePlayback = function () {
    if (_audio) { _audio.pause(); _audio.currentTime = 0; }
    if (typeof stopRobotDancer === "function") stopRobotDancer();
    const panel = document.getElementById("robot-panel");
    if (panel) panel.classList.remove("dance-visible");
  };

  // Init robot DOM eagerly (no data needed)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDanceTab());
  } else {
    initDanceTab();
  }
})();
