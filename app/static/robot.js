/**
 * robot.js — Dancing robot animation for the Chat tab.
 * Body parts = track cover artwork squares.
 * Joints = animated energy-wave tendrils (same style as Set Workshop).
 *
 * Supports multiple independent instances via createRobotDancer() factory.
 */
(function () {
  "use strict";

  // ═══ SHARED CONSTANTS ═══════════════════════════════════════
  const VW = 180, VH = 252;

  // ═══ SHARED PURE HELPERS ════════════════════════════════════
  const rad = (d) => d * Math.PI / 180;
  const lerp = (a, b, t) => a + (b - a) * t;

  function lerpAngle(a, b, t) {
    return a + (((b - a + 540) % 360) - 180) * t;
  }

  function ease(t) {
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
  }

  function hexLerp(a, b, t) {
    const p = (s, o) => parseInt(s.slice(o, o+2), 16);
    const r = Math.round(p(a,1) + (p(b,1)-p(a,1))*t);
    const g = Math.round(p(a,3) + (p(b,3)-p(a,3))*t);
    const bl= Math.round(p(a,5) + (p(b,5)-p(a,5))*t);
    return "#" + [r,g,bl].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("");
  }

  function gaussNoise() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function beatPulse(elapsed, bpm) {
    const beatSec = 60 / bpm;
    const phase = (elapsed % beatSec) / beatSec;
    return phase < 0.15 ? phase / 0.15 : Math.pow(1 - (phase - 0.15) / 0.85, 2);
  }

  // ─── Catmull-Rom spline ───────────────────────────────────
  function crPath(pts, tension) {
    if (pts.length < 2) return "";
    const T = 1 / (6 * (tension || 0.3));
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i-1,0)];
      const p1 = pts[i], p2 = pts[i+1];
      const p3 = pts[Math.min(i+2, pts.length-1)];
      d += ` C${(p1.x+(p2.x-p0.x)*T).toFixed(1)} ${(p1.y+(p2.y-p0.y)*T).toFixed(1)},`
         + `${(p2.x-(p3.x-p1.x)*T).toFixed(1)} ${(p2.y-(p3.y-p1.y)*T).toFixed(1)},`
         + `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  // ─── Pose interpolation (pure) ────────────────────────────
  function interpPose(a, b, t) {
    const e = ease(t);
    return {
      sp:  lerpAngle(a.sp,  b.sp,  e),
      aLU: lerpAngle(a.aLU, b.aLU, e), aLL: lerpAngle(a.aLL, b.aLL, e), aLH: lerpAngle(a.aLH, b.aLH, e),
      aRU: lerpAngle(a.aRU, b.aRU, e), aRL: lerpAngle(a.aRL, b.aRL, e), aRH: lerpAngle(a.aRH, b.aRH, e),
      lLU: lerpAngle(a.lLU, b.lLU, e), lLL: lerpAngle(a.lLL, b.lLL, e),
      lRU: lerpAngle(a.lRU, b.lRU, e), lRL: lerpAngle(a.lRL, b.lRL, e),
      hd:  lerpAngle(a.hd,  b.hd,  e),
      ry:  lerp(a.ry, b.ry, e),
    };
  }

  // ─── Part positions from joints (pure) ────────────────────
  function partPos(j) {
    const mid = (a,b) => ({ x:(a.x+b.x)/2, y:(a.y+b.y)/2 });
    const ang = (a,b) => Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI;
    return {
      head:  { ...j.head, rot: 0 },
      torso: { ...mid(j.neck, j.hip), rot: ang(j.neck, j.hip)-90 },
      armLU: { ...mid(j.shL, j.elL),  rot: ang(j.shL, j.elL)-90 },
      armRU: { ...mid(j.shR, j.elR),  rot: ang(j.shR, j.elR)-90 },
      armLL: { ...mid(j.elL, j.haL),  rot: ang(j.elL, j.haL)-90 },
      armRL: { ...mid(j.elR, j.haR),  rot: ang(j.elR, j.haR)-90 },
      handL: { ...mid(j.haL, j.fiL),  rot: ang(j.haL, j.fiL)-90 },
      handR: { ...mid(j.haR, j.fiR),  rot: ang(j.haR, j.fiR)-90 },
      legLU: { ...mid(j.hipL, j.knL), rot: ang(j.hipL, j.knL)-90 },
      legRU: { ...mid(j.hipR, j.knR), rot: ang(j.hipR, j.knR)-90 },
      legLL: { ...mid(j.knL, j.ftL),  rot: ang(j.knL, j.ftL)-90 },
      legRL: { ...mid(j.knR, j.ftR),  rot: ang(j.knR, j.ftR)-90 },
    };
  }

  // ═══ ROBOT DANCER FACTORY ═══════════════════════════════════
  function createRobotDancer(panelEl, opts) {
    opts = opts || {};
    const _showControls = opts.showControls !== false;

    // ─── Layout ────────────────────────────────────────────────
    const ROOT_X = VW / 2, ROOT_Y = 130;

    // ─── Base skeleton segment lengths ─────────────────────────
    const S_BASE = {
      spine: 42, neck: 10, shoulderW: 17, upperArm: 25,
      forearm: 23, hand: 16, hipW: 10, thigh: 28, shin: 25,
    };

    // ─── Base body-part cover sizes [w, h] ─────────────────────
    const SIZES_BASE = {
      head:  [25, 25], torso: [30, 36],
      armLU: [14, 23], armRU: [14, 23],
      armLL: [12, 20], armRL: [12, 20],
      legLU: [17, 25], legRU: [17, 25],
      legLL: [14, 23], legRL: [14, 23],
    };

    // ─── Z-order (higher = in front) ──────────────────────────
    const ZI = {
      legLU: 1, legRU: 1, legLL: 2, legRL: 2,
      torso: 3, armLU: 4, armRU: 4, armLL: 5, armRL: 5, head: 6,
    };

    // ─── Connections for energy waves ──────────────────────────
    const CONNS = [
      ["head",  "torso"],
      ["torso", "armLU"], ["torso", "armRU"],
      ["armLU", "armLL"], ["armRU", "armRL"],
      ["armLL", "handL"], ["armRL", "handR"],
      ["torso", "legLU"], ["torso", "legRU"],
      ["legLU", "legLL"], ["legRU", "legRL"],
    ];

    // ─── Dance poses ──────────────────────────────────────────
    const POSES = [
      { sp:-90, aLU:105, aLL:100, aLH:110, aRU:75,  aRL:80,  aRH:70,  lLU:93,  lLL:90,  lRU:87,  lRL:90,  hd:0,   ry:0  },
      { sp:-88, aLU:115, aLL:125, aLH:140, aRU:-50, aRL:-65, aRH:-50, lLU:95,  lLL:88,  lRU:82,  lRL:86,  hd:8,   ry:0  },
      { sp:-90, aLU:-130,aLL:-105,aLH:-90, aRU:-50, aRL:-75, aRH:-60, lLU:96,  lLL:88,  lRU:84,  lRL:92,  hd:-3,  ry:5  },
      { sp:-92, aLU:-95, aLL:-40, aLH:-25, aRU:105, aRL:100, aRH:115, lLU:88,  lLL:90,  lRU:92,  lRL:90,  hd:-10, ry:0  },
      { sp:-82, aLU:140, aLL:110, aLH:125, aRU:40,  aRL:70,  aRH:55,  lLU:108, lLL:72,  lRU:72,  lRL:108, hd:5,   ry:18 },
      { sp:-75, aLU:-110,aLL:-130,aLH:-115,aRU:105, aRL:115, aRH:130, lLU:105, lLL:82,  lRU:78,  lRL:88,  hd:12,  ry:8  },
    ];

    const SEQUENCE = [0, 1, 2, 3, 0, 4, 5, 3, 1, 0];

    // ─── Placeholder colours ──────────────────────────────────
    const PH = [
      "#e94560","#d6334e","#0f3460","#16213e","#4ecca3",
      "#c23152","#1b3a5c","#12294d","#3db890","#e05470",
    ];
    const ACCENT_HEX = "#e94560";

    // ─── Equaliser finger bars ──────────────────────────────
    const EQ_BARS = 5;
    const EQ_BASE_HEIGHT = 7;
    const EQ_MAX_HEIGHT = 40;
    const EQ_BANDS = [
      [1.0,  1.2, 0.55, 0.0],   // sub-bass
      [0.80, 3.2, 0.58, 1.1],   // bass
      [0.55, 6.0, 0.70, 2.7],   // mid
      [0.35, 9.0, 0.82, 4.2],   // presence
      [0.20, 12.0,0.90, 5.7],   // air — fastest
    ];

    // ─── Camelot colour palette ───────────────────────────────
    const CAMELOT_KEYS = [
      "1A","1B","2A","2B","3A","3B","4A","4B","5A","5B",
      "6A","6B","7A","7B","8A","8B","9A","9B","10A","10B",
      "11A","11B","12A","12B",
    ];
    const CAMELOT_HEX = {
      "1A":"#7BEED9","1B":"#00D4D4","2A":"#4BF1A8","2B":"#00E67E",
      "3A":"#90ED7D","3B":"#6FDB5E","4A":"#D5E96E","4B":"#C6D84E",
      "5A":"#F5C895","5B":"#F5B270","6A":"#FFB3B3","6B":"#FF8FA3",
      "7A":"#FF99C8","7B":"#FF6DB5","8A":"#EEA5D8","8B":"#E780CE",
      "9A":"#D5B0E8","9B":"#C88FDE","10A":"#B8B5ED","10B":"#9F98E8",
      "11A":"#98C9F1","11B":"#7BB2ED","12A":"#6DD9ED","12B":"#00C8E8",
    };

    // ─── Tunable config (sliders modify these live) ────────────
    const DEFAULTS = {
      skelScale:  1.00,   blockScale: 1.00,
      blockRatio: 1.05,   blockRound: 0,      keyColor: 0,
      waveAmp:    4.7,    waveSpeed:  0.3,
      waveLayers: 3,      waveColor:  0.70,
      bpm:        120,    poseHold:   130,
      poseTrans:  120,    bobAmt:     0,
      swayAmt:    0,      poseRandom: 3.00,
      holdRandom: 0.70,   keyRandom:  0,
      moveRandom: 1.00,
      driftFreq:  8,      driftSpeed: 2.5,
      driftAmount: 0.75,
    };

    // ─── Per-instance state ─────────────────────────────────────
    const _cfg = { ...DEFAULTS };
    let _stage = null, _svg = null, _ctrlPanel = null;
    let _els = {};
    const _extraStages = [];  // additional synced visual stages: { stageEl, svgEl, els }
    let _partCamelot = {};
    let _seqIdx = 0;
    let _fromPose = null, _toPose = null;
    let _phase = "hold";
    let _phaseStart = 0;
    let _frame = null;
    let _startTime = 0;
    let _artworkLoaded = false;

    // ─── Dynamics state (randomiser engines) ───────────────────
    let _curHold = 130;
    let _curTrans = 120;
    let _nextKeyChange = 0;
    let _lastTickTime = 0;
    let _wander = { bob: 0, sway: 0 };

    // ─── Drift state (home ↔ random cycling) ──────────────────
    const DRIFT_KEYS = [
      "skelScale", "blockScale", "blockRatio", "keyColor",
      "waveAmp", "waveSpeed", "waveLayers", "waveColor",
      "poseHold", "poseTrans", "bobAmt", "swayAmt", "poseRandom",
    ];
    const _drift = {
      active: false,
      phase: "home",
      phaseStart: 0,
      phaseDur: 0,
      homeVals: {},
      awayVals: {},
      btn: null,
    };

    // ─── Default auto-drive activation ─────────────────────────
    const DEFAULT_AUTO = ["waveAmp", "waveSpeed", "poseHold", "poseTrans", "waveColor"];

    // ─── Auto-drive profiles ──────────────────────────────────
    const AUTO_PROFILES = {
      poseTrans: {
        moves: [
          { lo: 100, hi: 250,  weight: 0.65, holdLo: 800,  holdHi: 4000, moveDur: 80  },
          { lo: 500, hi: 1750, weight: 0.35, holdLo: 300,  holdHi: 2500, moveDur: 400 },
        ],
      },
      poseHold: {
        moves: [
          { lo: 50,  hi: 150,  weight: 0.55, holdLo: 1500, holdHi: 4000, moveDur: 150 },
          { lo: 400, hi: 1000, weight: 0.45, holdLo: 800,  holdHi: 2500, moveDur: 300 },
        ],
      },
      bobAmt: {
        moves: [
          { lo: 0.2, hi: 1.2,  weight: 0.4,  holdLo: 2000, holdHi: 5000, moveDur: 600 },
          { lo: 2.0, hi: 4.0,  weight: 0.6,  holdLo: 1000, holdHi: 3000, moveDur: 350 },
        ],
      },
      swayAmt: {
        moves: [
          { lo: 0,   hi: 2,    weight: 0.45, holdLo: 2000, holdHi: 5000, moveDur: 700 },
          { lo: 4,   hi: 12,   weight: 0.55, holdLo: 1000, holdHi: 3000, moveDur: 400 },
        ],
      },
      waveAmp: {
        moves: [
          { lo: 2,   hi: 3,    weight: 0.4,  holdLo: 2000, holdHi: 5000, moveDur: 500 },
          { lo: 3.5, hi: 5,    weight: 0.6,  holdLo: 1000, holdHi: 3000, moveDur: 300 },
        ],
      },
      waveSpeed: {
        moves: [
          { lo: 0.3, hi: 1.2,  weight: 0.4,  holdLo: 3000, holdHi: 6000, moveDur: 600 },
          { lo: 2.0, hi: 4.0,  weight: 0.6,  holdLo: 1500, holdHi: 3000, moveDur: 400 },
        ],
      },
      skelScale: {
        moves: [
          { lo: 0.80, hi: 1.0, weight: 0.35, holdLo: 3000, holdHi: 7000, moveDur: 800 },
          { lo: 1.05, hi: 1.4, weight: 0.65, holdLo: 2000, holdHi: 5000, moveDur: 600 },
        ],
      },
      blockScale: {
        moves: [
          { lo: 0.40, hi: 0.75, weight: 0.4, holdLo: 3000, holdHi: 6000, moveDur: 700 },
          { lo: 0.95, hi: 1.40, weight: 0.6, holdLo: 2000, holdHi: 5000, moveDur: 500 },
        ],
      },
      poseRandom: {
        moves: [
          { lo: 0,   hi: 0.5,  weight: 0.35, holdLo: 2000, holdHi: 5000, moveDur: 400 },
          { lo: 1.0, hi: 3.0,  weight: 0.65, holdLo: 1500, holdHi: 4000, moveDur: 300 },
        ],
      },
      keyColor: {
        moves: [
          { lo: 0,   hi: 0.35, weight: 0.4,  holdLo: 2000, holdHi: 5000, moveDur: 600 },
          { lo: 0.5, hi: 1.0,  weight: 0.6,  holdLo: 1500, holdHi: 4000, moveDur: 400 },
        ],
      },
      waveColor: {
        moves: [
          { lo: 0,   hi: 0.35, weight: 0.35, holdLo: 2000, holdHi: 5000, moveDur: 500 },
          { lo: 0.5, hi: 1.0,  weight: 0.65, holdLo: 1500, holdHi: 4000, moveDur: 400 },
        ],
      },
    };

    // ─── Auto-drive state ─────────────────────────────────────
    const _auto = {};

    // ─── Auto-Random state ────────────────────────────────────
    const _autoRandom = { active: false, nextFire: 0, btn: null };

    // ─── Slider definitions ───────────────────────────────────
    const SLIDERS = [
      { group: "Body" },
      { key: "skelScale",  label: "Skeleton Scale",    min: 0.80, max: 1.40, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "blockScale", label: "Block Size",         min: 0.25, max: 1.82, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "blockRatio", label: "Block Ratio",        min: 0.20, max: 2.00, step: 0.05, fmt: v => v.toFixed(2) },
      { key: "keyColor",   label: "Key Colour",         min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { group: "Energy" },
      { key: "waveAmp",    label: "Wave Amplitude",     min: 2,   max: 5,    step: 0.1,  fmt: v => v.toFixed(1) },
      { key: "waveSpeed",  label: "Wave Speed",         min: 0,   max: 4,    step: 0.1,  fmt: v => v.toFixed(1) },
      { key: "waveLayers", label: "Wave Layers",        min: 1,   max: 5,    step: 1,    fmt: v => String(v) },
      { key: "waveColor",  label: "Wave Colour",        min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { group: "Movement" },
      { key: "bpm",        label: "BPM Tempo",          min: 60,  max: 200,  step: 1,    fmt: v => String(v) },
      { key: "poseHold",   label: "Pose Hold",          min: 50,  max: 1000, step: 10,   fmt: v => v + "ms" },
      { key: "poseTrans",  label: "Transition",         min: 100, max: 1750, step: 10,   fmt: v => v + "ms" },
      { key: "bobAmt",     label: "Bob Amount",         min: 0,   max: 4,    step: 0.1,  fmt: v => v.toFixed(1) },
      { key: "swayAmt",    label: "Sway Amount",        min: 0,   max: 12,   step: 0.5,  fmt: v => v.toFixed(1) },
      { key: "poseRandom", label: "Pose Randomiser",    min: 1.5, max: 3,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { group: "Dynamics" },
      { key: "holdRandom", label: "Hold Randomiser",    min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { key: "keyRandom",  label: "Key Randomiser",     min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { key: "moveRandom", label: "Move Randomiser",    min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
      { group: "Drift" },
      { key: "driftFreq",   label: "Drift Frequency",    min: 1,   max: 20,   step: 0.5,  fmt: v => v.toFixed(1) + "s" },
      { key: "driftSpeed",  label: "Drift Speed",        min: 0.3, max: 5,    step: 0.1,  fmt: v => v.toFixed(1) + "s" },
      { key: "driftAmount", label: "Drift Wildness",     min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
    ];

    // ─── Instance functions ───────────────────────────────────

    function ss() {
      const f = _cfg.skelScale;
      const o = {};
      for (const k in S_BASE) o[k] = S_BASE[k] * f;
      return o;
    }

    function sz(name) {
      const [w, h] = SIZES_BASE[name];
      const f = _cfg.blockScale;
      const r = Math.sqrt(_cfg.blockRatio);
      return [w * f * r, h * f / r];
    }

    function partKeyColor(name) {
      const k = _partCamelot[name];
      return k ? (CAMELOT_HEX[k] || null) : null;
    }

    function _shuffleCamelotKeys() {
      const names = Object.keys(SIZES_BASE);
      const limbGroups = [
        ["armLU", "armLL"],
        ["armRU", "armRL"],
        ["legLU", "legLL"],
        ["legRU", "legRL"],
      ];
      const grouped = new Set(limbGroups.flat());
      limbGroups.forEach(group => {
        const k = CAMELOT_KEYS[Math.floor(Math.random() * CAMELOT_KEYS.length)];
        group.forEach(name => { _partCamelot[name] = k; });
      });
      names.forEach(name => {
        if (!grouped.has(name)) {
          _partCamelot[name] = CAMELOT_KEYS[Math.floor(Math.random() * CAMELOT_KEYS.length)];
        }
      });
    }

    // ─── Dynamics ─────────────────────────────────────────────

    function _rollHold() {
      const base = _cfg.poseHold;
      const r = _cfg.holdRandom;
      if (r <= 0) return base;
      const lo = base * Math.max(0.05, 1 - r * 0.8);
      const hi = base * (1 + r * 2);
      return lo + Math.random() * (hi - lo);
    }

    function _rollTrans() {
      const base = _cfg.poseTrans;
      const r = _cfg.holdRandom;
      if (r <= 0) return base;
      const lo = base * Math.max(0.05, 0.15);
      const hi = base * (1 + r * 1.5);
      const roll = Math.random();
      if (roll < 0.6 * r) {
        return lo + Math.random() * (base * 0.4 - lo);
      }
      return lo + Math.random() * (hi - lo);
    }

    function _scheduleKeyChange(now) {
      if (_cfg.keyRandom <= 0) { _nextKeyChange = Infinity; return; }
      const interval = lerp(8000, 300, _cfg.keyRandom);
      const jitter = interval * (0.6 + Math.random() * 0.8);
      _nextKeyChange = now + jitter;
    }

    function _tickKeyRandom(now) {
      if (_cfg.keyRandom <= 0) return;
      if (now < _nextKeyChange) return;
      const names = Object.keys(SIZES_BASE);
      const count = Math.ceil(_cfg.keyRandom * 4);
      for (let i = 0; i < count; i++) {
        const name = names[Math.floor(Math.random() * names.length)];
        _partCamelot[name] = CAMELOT_KEYS[Math.floor(Math.random() * CAMELOT_KEYS.length)];
      }
      _updateBlockColors();
      _scheduleKeyChange(now);
    }

    function _tickMoveWander(dt) {
      const r = _cfg.moveRandom;
      if (r <= 0) { _wander.bob = 0; _wander.sway = 0; return; }
      const spring = 2.5;
      const noise = r * 2.5;
      _wander.bob  += (-spring * _wander.bob  * dt) + gaussNoise() * noise * Math.sqrt(dt);
      _wander.sway += (-spring * _wander.sway * dt) + gaussNoise() * noise * Math.sqrt(dt);
      _wander.bob  = Math.max(-_cfg.bobAmt * 0.8,  Math.min(_cfg.bobAmt * 1.5,  _wander.bob));
      _wander.sway = Math.max(-_cfg.swayAmt * 0.8, Math.min(_cfg.swayAmt * 1.5, _wander.sway));
    }

    // ─── Auto-drive ───────────────────────────────────────────

    function _autoPickTarget(key, now) {
      const profile = AUTO_PROFILES[key];
      const state = _auto[key];
      const moves = profile.moves;

      const totalW = moves.reduce((s, m) => s + m.weight, 0);
      let roll = Math.random() * totalW;
      let pick = moves[0];
      for (const m of moves) {
        roll -= m.weight;
        if (roll <= 0) { pick = m; break; }
      }

      state.phase = "move";
      state.from = _cfg[key];
      state.target = pick.lo + Math.random() * (pick.hi - pick.lo);

      const s = SLIDERS.find(x => x.key === key);
      if (s) state.target = Math.round(state.target / s.step) * s.step;

      state.moveStart = now;
      state.moveDur = pick.moveDur * (0.7 + Math.random() * 0.6);
      state.holdUntil = now + state.moveDur
        + pick.holdLo + Math.random() * (pick.holdHi - pick.holdLo);
    }

    function _tickAutoDrive(now) {
      for (const key of Object.keys(_auto)) {
        const state = _auto[key];
        if (!state.active) continue;
        const profile = AUTO_PROFILES[key];
        if (!profile) continue;

        if (state.phase === "move") {
          const t = Math.min((now - state.moveStart) / state.moveDur, 1);
          const e = ease(t);
          _cfg[key] = lerp(state.from, state.target, e);
          _syncSliderUI(key);
          if (t >= 1) {
            _cfg[key] = state.target;
            state.phase = "hold";
          }
        } else if (state.phase === "hold") {
          if (now >= state.holdUntil) {
            _autoPickTarget(key, now);
          }
        }
      }
    }

    function _syncSliderUI(key) {
      if (!_ctrlPanel) return;
      const input = _ctrlPanel.querySelector(`input[data-key="${key}"]`);
      if (!input) return;
      const s = SLIDERS.find(x => x.key === key);
      if (!s) return;
      const snapped = Math.round(_cfg[key] / s.step) * s.step;
      input.value = snapped;
      const val = input.parentElement.querySelector(".robot-ctrl-val");
      if (val) val.textContent = s.fmt(snapped);
      if (REFRESH[s.key]) REFRESH[s.key]();
    }

    function _toggleAuto(key, btn) {
      if (!_auto[key]) {
        _auto[key] = { active: false, phase: "hold", target: _cfg[key],
                       from: _cfg[key], moveStart: 0, moveDur: 0,
                       holdUntil: 0, btn: btn };
      }
      const state = _auto[key];
      state.active = !state.active;
      btn.classList.toggle("active", state.active);
      btn.textContent = state.active ? "\u23F8" : "\u25B6";
      if (state.active) {
        _autoPickTarget(key, performance.now());
      }
    }

    function _setAllAuto(on) {
      for (const key of Object.keys(AUTO_PROFILES)) {
        _setOneAuto(key, on);
      }
    }

    function _setAutoKeys(keys) {
      for (const key of Object.keys(AUTO_PROFILES)) {
        _setOneAuto(key, keys.includes(key));
      }
    }

    function _setOneAuto(key, on) {
      if (!_auto[key]) return;
      const state = _auto[key];
      if (state.active === on) return;
      state.active = on;
      if (state.btn) {
        state.btn.classList.toggle("active", on);
        state.btn.textContent = on ? "\u23F8" : "\u25B6";
      }
      if (on) _autoPickTarget(key, performance.now());
    }

    // ─── Drift: home ↔ random cycling ──────────────────────────

    function _generateDriftTarget() {
      const away = {};
      for (const key of DRIFT_KEYS) {
        const s = SLIDERS.find(x => x.key === key);
        if (!s) continue;
        const v = s.min + Math.random() * (s.max - s.min);
        away[key] = Math.max(s.min, Math.min(s.max, Math.round(v / s.step) * s.step));
      }
      return away;
    }

    function _playRandom() {
      for (const key of DRIFT_KEYS) {
        const s = SLIDERS.find(x => x.key === key);
        if (!s) continue;
        const v = s.min + Math.random() * (s.max - s.min);
        _cfg[key] = Math.max(s.min, Math.min(s.max, Math.round(v / s.step) * s.step));
        _syncSliderUI(key);
      }
      _shuffleCamelotKeys();
      _updateBlockColors();
    }

    function _tickAutoRandom(now) {
      if (!_autoRandom.active) return;
      if (now >= _autoRandom.nextFire) {
        _playRandom();
        _scheduleNextRandom(now);
      }
    }

    function _scheduleNextRandom(now) {
      const freq = _cfg.driftFreq;
      const wild = _cfg.driftAmount;
      const base = 30000 / Math.max(freq, 1);
      const jitter = base * wild * (Math.random() - 0.5);
      _autoRandom.nextFire = now + Math.max(500, base + jitter);
    }

    function _startAutoRandom() {
      _autoRandom.active = true;
      _scheduleNextRandom(performance.now());
      if (_autoRandom.btn) {
        _autoRandom.btn.classList.add("active");
        _autoRandom.btn.textContent = "Stop Random";
      }
    }

    function _stopAutoRandom() {
      _autoRandom.active = false;
      if (_autoRandom.btn) {
        _autoRandom.btn.classList.remove("active");
        _autoRandom.btn.textContent = "Play Random";
      }
    }

    function _toggleAutoRandom() {
      if (_autoRandom.active) _stopAutoRandom(); else _startAutoRandom();
    }

    function _tickDrift(now) {
      if (!_drift.active) return;

      const elapsed = now - _drift.phaseStart;
      const amt = _cfg.driftAmount;

      switch (_drift.phase) {
        case "home":
          if (elapsed >= _drift.phaseDur) {
            _drift.awayVals = _generateDriftTarget();
            _drift.phase = "going-out";
            _drift.phaseStart = now;
            const outSpeed = _cfg.driftSpeed * 1000 * (1 - amt * 0.5 + Math.random() * amt);
            _drift.phaseDur = Math.max(100, outSpeed);
          }
          break;

        case "going-out": {
          const t = Math.min(elapsed / _drift.phaseDur, 1);
          const e = ease(t);
          for (const key of DRIFT_KEYS) {
            if (!(key in _drift.homeVals) || !(key in _drift.awayVals)) continue;
            _cfg[key] = lerp(_drift.homeVals[key], _drift.awayVals[key], e);
            _syncSliderUI(key);
          }
          if (t >= 1) {
            _drift.phase = "away";
            _drift.phaseStart = now;
            const awayHold = _cfg.driftFreq * 1000 * (0.3 + Math.random() * amt * 1.4);
            _drift.phaseDur = Math.max(200, awayHold);
          }
          break;
        }

        case "away":
          if (elapsed >= _drift.phaseDur) {
            _drift.phase = "coming-back";
            _drift.phaseStart = now;
            const backSpeed = _cfg.driftSpeed * 1000 * (1 - amt * 0.3 + Math.random() * amt * 0.6);
            _drift.phaseDur = Math.max(100, backSpeed);
          }
          break;

        case "coming-back": {
          const t = Math.min(elapsed / _drift.phaseDur, 1);
          const e = ease(t);
          for (const key of DRIFT_KEYS) {
            if (!(key in _drift.awayVals) || !(key in _drift.homeVals)) continue;
            _cfg[key] = lerp(_drift.awayVals[key], _drift.homeVals[key], e);
            _syncSliderUI(key);
          }
          if (t >= 1) {
            _drift.phase = "home";
            _drift.phaseStart = now;
            const homeHold = _cfg.driftFreq * 1000 * (0.5 + Math.random() * 1.0);
            _drift.phaseDur = Math.max(300, homeHold);
          }
          break;
        }
      }
    }

    function _startDrift() {
      for (const key of DRIFT_KEYS) {
        _drift.homeVals[key] = DEFAULTS[key];
      }
      _drift.active = true;
      _drift.phase = "home";
      _drift.phaseStart = performance.now();
      _drift.phaseDur = _cfg.driftFreq * 500 * (0.5 + Math.random() * 0.5);
      if (_drift.btn) {
        _drift.btn.classList.add("active");
        _drift.btn.textContent = "Stop Drift";
      }
    }

    function _stopDrift() {
      _drift.active = false;
      for (const key of DRIFT_KEYS) {
        if (key in _drift.homeVals) {
          _cfg[key] = _drift.homeVals[key];
          _syncSliderUI(key);
        }
      }
      if (_drift.btn) {
        _drift.btn.classList.remove("active");
        _drift.btn.textContent = "Drift";
      }
    }

    function _toggleDrift() {
      if (_drift.active) _stopDrift();
      else _startDrift();
    }

    // ─── Forward Kinematics ────────────────────────────────────
    function fk(p) {
      const S = ss();
      const j = {};
      j.hip = { x: ROOT_X, y: ROOT_Y + (p.ry||0) };

      const sa = rad(p.sp);
      j.neck = { x: j.hip.x + S.spine*Math.cos(sa), y: j.hip.y + S.spine*Math.sin(sa) };
      j.head = { x: j.neck.x + S.neck*Math.cos(sa), y: j.neck.y + S.neck*Math.sin(sa) };

      const pL = sa - Math.PI/2, pR = sa + Math.PI/2;
      j.shL = { x: j.neck.x + S.shoulderW*Math.cos(pL), y: j.neck.y + S.shoulderW*Math.sin(pL) };
      j.shR = { x: j.neck.x + S.shoulderW*Math.cos(pR), y: j.neck.y + S.shoulderW*Math.sin(pR) };

      j.elL = { x: j.shL.x + S.upperArm*Math.cos(rad(p.aLU)), y: j.shL.y + S.upperArm*Math.sin(rad(p.aLU)) };
      j.haL = { x: j.elL.x + S.forearm*Math.cos(rad(p.aLL)),  y: j.elL.y + S.forearm*Math.sin(rad(p.aLL)) };
      j.fiL = { x: j.haL.x + S.hand*Math.cos(rad(p.aLH)),    y: j.haL.y + S.hand*Math.sin(rad(p.aLH)) };
      j.elR = { x: j.shR.x + S.upperArm*Math.cos(rad(p.aRU)), y: j.shR.y + S.upperArm*Math.sin(rad(p.aRU)) };
      j.haR = { x: j.elR.x + S.forearm*Math.cos(rad(p.aRL)),  y: j.elR.y + S.forearm*Math.sin(rad(p.aRL)) };
      j.fiR = { x: j.haR.x + S.hand*Math.cos(rad(p.aRH)),    y: j.haR.y + S.hand*Math.sin(rad(p.aRH)) };

      j.hipL = { x: j.hip.x + S.hipW*Math.cos(pL), y: j.hip.y + S.hipW*Math.sin(pL) };
      j.hipR = { x: j.hip.x + S.hipW*Math.cos(pR), y: j.hip.y + S.hipW*Math.sin(pR) };

      j.knL = { x: j.hipL.x + S.thigh*Math.cos(rad(p.lLU)), y: j.hipL.y + S.thigh*Math.sin(rad(p.lLU)) };
      j.ftL = { x: j.knL.x  + S.shin*Math.cos(rad(p.lLL)),  y: j.knL.y  + S.shin*Math.sin(rad(p.lLL)) };
      j.knR = { x: j.hipR.x + S.thigh*Math.cos(rad(p.lRU)), y: j.hipR.y + S.thigh*Math.sin(rad(p.lRU)) };
      j.ftR = { x: j.knR.x  + S.shin*Math.cos(rad(p.lRL)),  y: j.knR.y  + S.shin*Math.sin(rad(p.lRL)) };

      return j;
    }

    // ─── Pose randomiser — add noise to a base pose ────────────
    function noisyPose(base) {
      const n = _cfg.poseRandom * 30;
      const rn = () => (Math.random() - 0.5) * 2;
      return {
        sp:  base.sp  + rn() * n * 0.25,
        aLU: base.aLU + rn() * n,
        aLL: base.aLL + rn() * n,
        aLH: base.aLH + rn() * n,
        aRU: base.aRU + rn() * n,
        aRL: base.aRL + rn() * n,
        aRH: base.aRH + rn() * n,
        lLU: base.lLU + rn() * n * 0.5,
        lLL: base.lLL + rn() * n * 0.5,
        lRU: base.lRU + rn() * n * 0.5,
        lRL: base.lRL + rn() * n * 0.5,
        hd:  base.hd  + rn() * n * 0.4,
        ry:  base.ry  + rn() * n * 0.2,
      };
    }

    // ─── Animated energy-wave path ─────────────────────────────
    function wavePath(p1, p2, elapsed, seed, baseAmp, beatAmp) {
      const dx = p2.x-p1.x, dy = p2.y-p1.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len < 8) return "";
      const px = -dy/len, py = dx/len;
      const N = 8;
      const amp = baseAmp * _cfg.waveAmp + beatAmp;
      const spd = _cfg.waveSpeed;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const t = i/N;
        const s = seed + i*3.1;
        const disp = Math.sin(elapsed*1.7*spd + s)*amp*0.5
                   + Math.sin(elapsed*0.61*spd + s*1.3)*amp*0.4
                   + Math.sin(elapsed*2.83*spd + s*0.5)*amp*0.3;
        const taper = Math.sin(t * Math.PI);
        pts.push({
          x: p1.x + dx*t + px*disp*taper,
          y: p1.y + dy*t + py*disp*taper,
        });
      }
      return crPath(pts, 0.3);
    }

    // ─── Equaliser finger rendering ───────────────────────
    function renderEqFingers(j, elapsed, beat) {
      let svg = "";
      const attachments = [
        { from: j.haL,  to: j.fiL,  widthPart: "armLL", atMid: true,  hScale: 1.0 },
        { from: j.haR,  to: j.fiR,  widthPart: "armRL", atMid: true,  hScale: 1.0 },
        { from: j.knL,  to: j.ftL,  widthPart: "legLL", atMid: false, hScale: 1.5 },
        { from: j.knR,  to: j.ftR,  widthPart: "legRL", atMid: false, hScale: 1.5 },
      ];

      for (const { from, to, widthPart, atMid, hScale } of attachments) {
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = dx / len, dirY = dy / len;
        const perpX = -dirY, perpY = dirX;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI;

        const [blockW] = sz(widthPart);
        const barW = blockW / EQ_BARS;
        const gap = barW * 0.15;
        const barNetW = barW - gap;

        // Bar colour matches the connected body block exactly
        const partNames = Object.keys(SIZES_BASE);
        const idx = partNames.indexOf(widthPart);
        const baseFill = PH[idx] || ACCENT_HEX;
        const kc = partKeyColor(widthPart);
        const fill = (_cfg.keyColor > 0 && kc)
          ? hexLerp(baseFill, kc, Math.min(_cfg.keyColor, 1))
          : baseFill;

        for (let i = 0; i < EQ_BARS; i++) {
          const [beatMul, oscFreq, oscAmp, phase] = EQ_BANDS[i];
          const osc = (Math.sin(elapsed * oscFreq + phase) * 0.5 + 0.5) * oscAmp;
          const maxH = EQ_MAX_HEIGHT * hScale;
          const h = EQ_BASE_HEIGHT * hScale + (beat * beatMul + osc) * (maxH - EQ_BASE_HEIGHT * hScale);
          const barH = Math.min(h, maxH);

          const ax = atMid ? (from.x + to.x) / 2 : to.x;
          const ay = atMid ? (from.y + to.y) / 2 : to.y;
          const offset = (i - (EQ_BARS - 1) / 2) * barW;
          const bx = ax + perpX * offset;
          const by = ay + perpY * offset;

          const rx = bx - barNetW / 2;
          const ry = by - barH;

          const glowPx = 3 + beat * 6;
          const op = 0.7 + beat * 0.25;
          svg += `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" `
            + `width="${barNetW.toFixed(1)}" height="${barH.toFixed(1)}" rx="1" `
            + `fill="${fill}" opacity="${op.toFixed(2)}" `
            + `transform="rotate(${(ang + 90).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)})" `
            + `style="filter:drop-shadow(0 0 ${glowPx.toFixed(0)}px ${fill})" />`;
        }
      }
      return svg;
    }

    // ─── Visual update helpers ─────────────────────────────────

    function _allEls() { return [_els, ..._extraStages.map(s => s.els)]; }

    function _updateBlockSizes() {
      for (const name of Object.keys(SIZES_BASE)) {
        const [w, h] = sz(name);
        for (const els of _allEls()) {
          els[name].style.width = w + "px";
          els[name].style.height = h + "px";
        }
      }
    }

    function _updateBlockRounding() {
      const r = _cfg.blockRound + "%";
      for (const name of Object.keys(SIZES_BASE)) {
        for (const els of _allEls()) { els[name].style.borderRadius = r; }
      }
    }

    function _updateBlockColors() {
      const names = Object.keys(SIZES_BASE);
      names.forEach((name, i) => {
        const kc = partKeyColor(name);
        const bg = (_cfg.keyColor <= 0 || !kc)
          ? PH[i]
          : hexLerp(PH[i], kc, Math.min(_cfg.keyColor, 1));
        for (const els of _allEls()) { els[name].style.background = bg; }
      });
    }

    const REFRESH = {
      blockScale: _updateBlockSizes,
      blockRatio: _updateBlockSizes,
      keyColor:   _updateBlockColors,
    };

    // ─── Build DOM ─────────────────────────────────────────────
    function _build(controlsTarget) {
      if (!panelEl) return false;

      _shuffleCamelotKeys();

      _stage = document.createElement("div");
      _stage.className = "robot-stage";
      _stage.style.cssText = `position:relative;width:${VW}px;height:${VH}px;flex-shrink:0;`;

      _svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      _svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
      _svg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;"
        + "z-index:0;pointer-events:none;overflow:visible;";
      _stage.appendChild(_svg);

      const names = Object.keys(SIZES_BASE);
      names.forEach((name, i) => {
        const [w, h] = SIZES_BASE[name];
        const el = document.createElement("div");
        el.className = "robot-part";
        el.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;`
          + `z-index:${ZI[name]};will-change:transform;border-radius:${_cfg.blockRound}%;`
          + `overflow:hidden;background:${PH[i]};box-shadow:0 0 8px rgba(233,69,96,0.3);`
          + `transition:box-shadow 0.08s ease;`;

        const img = document.createElement("img");
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:none;";
        img.alt = "";
        el.appendChild(img);
        _stage.appendChild(el);
        _els[name] = el;
      });

      panelEl.innerHTML = "";
      panelEl.appendChild(_stage);

      if (_showControls) {
        _buildControls(controlsTarget || panelEl);
      } else {
        _initAutoState();
      }
      return true;
    }

    // ─── Init auto state without controls UI ──────────────────
    function _initAutoState() {
      SLIDERS.forEach(s => {
        if (!s.key) return;
        if (!AUTO_PROFILES[s.key]) return;
        _auto[s.key] = { active: false, phase: "hold", target: _cfg[s.key],
                         from: _cfg[s.key], moveStart: 0, moveDur: 0,
                         holdUntil: 0, btn: null };
      });
      _setAutoKeys(DEFAULT_AUTO);
      _startDrift();
      _startAutoRandom();
    }

    // ─── Slider Control Panel ──────────────────────────────────

    function _randomiseSlider(s, input, valSpan) {
      const range = s.max - s.min;
      const v = s.min + Math.random() * range;
      const snapped = Math.round(v / s.step) * s.step;
      const clamped = Math.max(s.min, Math.min(s.max, snapped));
      _cfg[s.key] = clamped;
      input.value = clamped;
      valSpan.textContent = s.fmt(clamped);
      if (REFRESH[s.key]) REFRESH[s.key]();
    }

    function _buildControls(panel) {
      _ctrlPanel = document.createElement("div");
      _ctrlPanel.className = "robot-controls";

      SLIDERS.forEach(s => {
        if (s.group) {
          const hdr = document.createElement("div");
          hdr.className = "robot-ctrl-group";
          hdr.textContent = s.group;
          _ctrlPanel.appendChild(hdr);
          return;
        }

        const hasAuto = !!AUTO_PROFILES[s.key];
        const row = document.createElement("div");
        row.className = "robot-ctrl-row" + (hasAuto ? " has-auto" : "");

        const lbl = document.createElement("label");
        lbl.className = "robot-ctrl-label";
        lbl.textContent = s.label;

        const input = document.createElement("input");
        input.type = "range";
        input.className = "robot-ctrl-slider";
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.value = _cfg[s.key];
        input.dataset.key = s.key;

        const val = document.createElement("span");
        val.className = "robot-ctrl-val";
        val.textContent = s.fmt(_cfg[s.key]);

        const dice = document.createElement("button");
        dice.className = "robot-ctrl-dice";
        dice.textContent = "\u2684";
        dice.title = "Randomise";
        dice.addEventListener("click", () => _randomiseSlider(s, input, val));

        input.addEventListener("input", () => {
          const v = Number(input.value);
          _cfg[s.key] = v;
          val.textContent = s.fmt(v);
          if (REFRESH[s.key]) REFRESH[s.key]();
        });

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(val);
        row.appendChild(dice);

        if (hasAuto) {
          const autoBtn = document.createElement("button");
          autoBtn.className = "robot-ctrl-auto";
          autoBtn.textContent = "\u25B6";
          autoBtn.title = "Auto-drive";
          _auto[s.key] = { active: false, phase: "hold", target: _cfg[s.key],
                           from: _cfg[s.key], moveStart: 0, moveDur: 0,
                           holdUntil: 0, btn: autoBtn };
          autoBtn.addEventListener("click", () => _toggleAuto(s.key, autoBtn));
          row.appendChild(autoBtn);
        }

        _ctrlPanel.appendChild(row);
      });

      // Buttons
      const btnRow = document.createElement("div");
      btnRow.className = "robot-ctrl-btn-row";

      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-sm btn-secondary";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", _resetControls);

      const autopilotBtn = document.createElement("button");
      autopilotBtn.className = "btn btn-sm btn-secondary";
      autopilotBtn.textContent = "Autopilot";
      let autopilotOn = false;
      autopilotBtn.addEventListener("click", () => {
        autopilotOn = !autopilotOn;
        _setAllAuto(autopilotOn);
        autopilotBtn.classList.toggle("active", autopilotOn);
        autopilotBtn.textContent = autopilotOn ? "Stop Autopilot" : "Autopilot";
      });

      const driftBtn = document.createElement("button");
      driftBtn.className = "btn btn-sm btn-secondary";
      driftBtn.textContent = "Drift";
      _drift.btn = driftBtn;
      driftBtn.addEventListener("click", _toggleDrift);

      const autoRandBtn = document.createElement("button");
      autoRandBtn.className = "btn btn-sm btn-secondary";
      autoRandBtn.textContent = "Play Random";
      _autoRandom.btn = autoRandBtn;
      autoRandBtn.addEventListener("click", _toggleAutoRandom);

      btnRow.appendChild(resetBtn);
      btnRow.appendChild(autopilotBtn);
      btnRow.appendChild(driftBtn);
      btnRow.appendChild(autoRandBtn);
      _ctrlPanel.appendChild(btnRow);

      panel.appendChild(_ctrlPanel);

      // Activate default auto-drives + drift + auto-random on init
      _setAutoKeys(DEFAULT_AUTO);
      autopilotBtn.classList.add("active");
      autopilotBtn.textContent = "Stop Autopilot";
      autopilotOn = true;
      _startDrift();
      _startAutoRandom();
    }

    function _resetControls() {
      if (_drift.active) _stopDrift();
      Object.assign(_cfg, DEFAULTS);
      _wander.bob = 0;
      _wander.sway = 0;
      _setAutoKeys(DEFAULT_AUTO);
      if (_ctrlPanel) {
        const apBtn = _ctrlPanel.querySelector(".robot-ctrl-btn-row .btn-secondary:nth-child(2)");
        if (apBtn) {
          const anyOn = DEFAULT_AUTO.length > 0;
          apBtn.classList.toggle("active", anyOn);
          apBtn.textContent = anyOn ? "Stop Autopilot" : "Autopilot";
        }
        _ctrlPanel.querySelectorAll("input[data-key]").forEach(input => {
          const s = SLIDERS.find(x => x.key === input.dataset.key);
          if (!s) return;
          input.value = _cfg[s.key];
          const val = input.parentElement.querySelector(".robot-ctrl-val");
          if (val) val.textContent = s.fmt(_cfg[s.key]);
        });
      }
      _updateBlockSizes();
      _updateBlockRounding();
      _shuffleCamelotKeys();
      _updateBlockColors();
      _startDrift();
      _startAutoRandom();
    }

    // ─── Load artwork ──────────────────────────────────────────
    function _loadArt() {
      if (_artworkLoaded) return;
      if (typeof gridOptions === "undefined" || !gridOptions.api) return;
      const total = gridOptions.api.getDisplayedRowCount();
      if (!total) return;

      const idxs = new Set();
      const need = Math.min(Object.keys(SIZES_BASE).length, total);
      while (idxs.size < need) idxs.add(Math.floor(Math.random() * total));

      const names = Object.keys(SIZES_BASE);
      [...idxs].forEach((idx, i) => {
        if (i >= names.length) return;
        const data = gridOptions.api.getDisplayedRowAtIndex(idx)?.data;
        if (!data) return;
        if (data.key) _partCamelot[names[i]] = data.key;
        for (const els of _allEls()) {
          const img = els[names[i]].querySelector("img");
          if (typeof loadArtwork === "function") {
            img.style.display = "block";
            loadArtwork(data.artist, data.title, img);
          }
        }
      });
      _artworkLoaded = true;
      _updateBlockColors();
    }

    // ─── Animation tick ────────────────────────────────────────
    function _tick() {
      const now = performance.now();
      const elapsed = (now - _startTime) / 1000;
      const dt = Math.min((now - _lastTickTime) / 1000, 0.1);
      _lastTickTime = now;

      const tempo = _cfg.bpm / 120;

      const beat = beatPulse(elapsed, _cfg.bpm);

      _tickAutoRandom(now);
      _tickDrift(now);
      _tickAutoDrive(now);
      _tickMoveWander(dt);
      _tickKeyRandom(now);

      // ── Pose state machine ──
      if (_phase === "hold" && now - _phaseStart > _curHold / tempo) {
        _phase = "transition";
        _phaseStart = now;
        _curTrans = _rollTrans();
        _fromPose = _toPose || noisyPose(POSES[SEQUENCE[_seqIdx]]);
        _seqIdx = (_seqIdx + 1) % SEQUENCE.length;
        _toPose = noisyPose(POSES[SEQUENCE[_seqIdx]]);
      }
      if (_phase === "transition" && now - _phaseStart > _curTrans / tempo) {
        _phase = "hold";
        _phaseStart = now;
        _curHold = _rollHold();
      }

      // ── Current pose ──
      const effTrans = _curTrans / tempo;
      let pose;
      if (_phase === "transition") {
        const t = Math.min((now - _phaseStart) / effTrans, 1);
        pose = interpPose(_fromPose, _toPose, t);
      } else {
        pose = _toPose ? { ..._toPose } : { ...POSES[0] };
      }

      const effBob  = Math.max(0, _cfg.bobAmt  + _wander.bob);
      const effSway = Math.max(0, _cfg.swayAmt + _wander.sway);
      const bobFreq = (Math.PI * 2 * _cfg.bpm) / 60;
      pose.ry = (pose.ry||0) + Math.sin(elapsed * bobFreq / 2) * effBob
                              + beat * effBob * 0.8;
      const sway = Math.sin(elapsed * bobFreq / 4) * effSway;

      // ── Forward kinematics ──
      const j = fk(pose);
      Object.values(j).forEach(jt => { jt.x += sway; });

      const pos = partPos(j);
      pos.head.rot = pose.hd || 0;

      // ── Update cover positions + beat-synced glow (all stages) ──
      const glowBase = 8;
      const glowBeat = beat * 12;
      for (const [name, p] of Object.entries(pos)) {
        if (!SIZES_BASE[name]) continue;  // skip handL/handR (no DOM element)
        const [w, h] = sz(name);
        const kc = partKeyColor(name);
        const glowColor = (_cfg.keyColor > 0 && kc) ? kc : ACCENT_HEX;
        const glowPx = glowBase + glowBeat;
        const tf = `translate(${(p.x - w/2).toFixed(1)}px, ${(p.y - h/2).toFixed(1)}px) rotate(${p.rot.toFixed(1)}deg)`;
        const bs = `0 0 ${glowPx.toFixed(0)}px ${glowColor}80`;
        for (const els of _allEls()) {
          els[name].style.transform = tf;
          els[name].style.boxShadow = bs;
        }
      }

      // ── Render energy waves ──
      let svg = "";
      const layers = Math.round(_cfg.waveLayers);
      const beatAmpBoost = beat * 6;
      CONNS.forEach(([a, b], ci) => {
        const pa = pos[a], pb = pos[b];

        let stroke = ACCENT_HEX;
        if (_cfg.waveColor > 0) {
          const kc = partKeyColor(a) || partKeyColor(b);
          if (kc) stroke = _cfg.waveColor >= 1 ? kc : hexLerp(ACCENT_HEX, kc, _cfg.waveColor);
        }

        const swBoost = beat * 1.5;

        for (let li = 0; li < layers; li++) {
          const d = wavePath(pa, pb, elapsed, ci*13.7 + li*47.3, 5 + li*2, beatAmpBoost);
          if (!d) return;
          const op = (li === 0 ? 0.6 : li <= Math.floor(layers/2) ? 0.35 : 0.2) + beat * 0.15;
          const sw = (li === 0 ? 2.5 : li <= Math.floor(layers/2) ? 1.8 : 1.2) + swBoost;
          const gl = (li === 0 ? 6 : 3) + beat * 4;
          svg += `<path d="${d}" fill="none" stroke="${stroke}" `
            + `stroke-width="${sw.toFixed(1)}" opacity="${op.toFixed(2)}" `
            + `style="filter:drop-shadow(0 0 ${gl.toFixed(0)}px ${stroke})" />`;
        }
      });

      svg += renderEqFingers(j, elapsed, beat);

      _svg.innerHTML = svg;
      for (const ex of _extraStages) ex.svgEl.innerHTML = svg;

      if (!_artworkLoaded && Math.random() < 0.01) _loadArt();

      _frame = requestAnimationFrame(_tick);
    }

    // ─── Instance public methods ───────────────────────────────

    function init(controlsTarget) {
      if (_stage) return;
      if (!_build(controlsTarget)) return;
      _loadArt();
    }

    function start() {
      if (!_stage) init();
      if (!_stage || _frame) return;
      _startTime = performance.now();
      _lastTickTime = _startTime;
      _phaseStart = _startTime;
      // Random starting position so each robot dances independently
      _seqIdx = Math.floor(Math.random() * SEQUENCE.length);
      _toPose = noisyPose(POSES[SEQUENCE[_seqIdx]]);
      _phase = "hold";
      _curHold = _rollHold();
      _curTrans = _rollTrans();
      _wander = { bob: 0, sway: 0 };
      _scheduleKeyChange(_startTime);
      _frame = requestAnimationFrame(_tick);
    }

    function stop() {
      if (_frame) { cancelAnimationFrame(_frame); _frame = null; }
    }

    function refreshArtwork() {
      _artworkLoaded = false;
      _loadArt();
    }

    // Add a synced visual stage (same animation, no controls)
    function addStage(parentEl, scale) {
      const stageEl = document.createElement("div");
      stageEl.className = "robot-stage";
      stageEl.style.cssText = `position:relative;width:${VW}px;height:${VH}px;flex-shrink:0;`;
      if (scale && scale !== 1) {
        stageEl.style.transform = `scale(${scale})`;
        stageEl.style.transformOrigin = "top left";
      }

      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgEl.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
      svgEl.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;"
        + "z-index:0;pointer-events:none;overflow:visible;";
      stageEl.appendChild(svgEl);

      const els = {};
      const names = Object.keys(SIZES_BASE);
      names.forEach((name, i) => {
        const [w, h] = SIZES_BASE[name];
        const el = document.createElement("div");
        el.className = "robot-part";
        el.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;`
          + `z-index:${ZI[name]};will-change:transform;border-radius:${_cfg.blockRound}%;`
          + `overflow:hidden;background:${PH[i]};box-shadow:0 0 8px rgba(233,69,96,0.3);`
          + `transition:box-shadow 0.08s ease;`;
        const img = document.createElement("img");
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:none;";
        img.alt = "";
        el.appendChild(img);
        stageEl.appendChild(el);
        els[name] = el;
      });

      parentEl.appendChild(stageEl);
      _extraStages.push({ stageEl, svgEl, els });
      return stageEl;
    }

    function still() {
      if (!_stage) init();
      if (!_stage) return;
      if (_frame) return; // already animating, don't overwrite
      const pose = noisyPose(POSES[SEQUENCE[Math.floor(Math.random() * SEQUENCE.length)]]);
      const j = fk(pose);
      const pos = partPos(j);
      pos.head.rot = pose.hd || 0;
      for (const [name, p] of Object.entries(pos)) {
        if (!SIZES_BASE[name]) continue;
        const [w, h] = sz(name);
        const tf = `translate(${(p.x - w/2).toFixed(1)}px, ${(p.y - h/2).toFixed(1)}px) rotate(${p.rot.toFixed(1)}deg)`;
        for (const els of _allEls()) {
          els[name].style.transform = tf;
          els[name].style.boxShadow = `0 0 8px ${ACCENT_HEX}80`;
        }
      }
      _svg.innerHTML = "";
      for (const ex of _extraStages) ex.svgEl.innerHTML = "";
    }

    return { init, start, stop, still, refreshArtwork, addStage, stage: () => _stage };
  }

  // ═══ PUBLIC API (single instance, multiple synced stages) ═══

  let _inst = null;

  window.createRobotDancer = createRobotDancer;

  window.initRobotDancer = function (controlsContainer, opts) {
    if (_inst) return;
    const panel = document.getElementById("robot-panel");
    if (!panel) return;

    const wantControls = opts?.showControls !== false;
    const scale = 2.0;

    // Row of 3 synced robots
    panel.innerHTML = "";
    const row = document.createElement("div");
    row.className = "robot-row";
    row.style.cssText = "display:flex;align-items:flex-end;justify-content:center;gap:0;";
    panel.appendChild(row);

    // Left stage
    const leftSub = document.createElement("div");
    leftSub.className = "robot-sub-panel";
    leftSub.style.cssText = `width:${VW * scale}px;height:${VH * scale}px;flex-shrink:0;overflow:visible;`;
    row.appendChild(leftSub);

    // Center panel (primary — factory builds into this)
    const centerSub = document.createElement("div");
    centerSub.className = "robot-sub-panel";
    centerSub.style.cssText = `width:${VW * scale}px;height:${VH * scale}px;flex-shrink:0;overflow:visible;`;
    row.appendChild(centerSub);

    // Right stage
    const rightSub = document.createElement("div");
    rightSub.className = "robot-sub-panel";
    rightSub.style.cssText = `width:${VW * scale}px;height:${VH * scale}px;flex-shrink:0;overflow:visible;`;
    row.appendChild(rightSub);

    // Single instance with controls
    _inst = createRobotDancer(centerSub, { showControls: wantControls });
    _inst.init(wantControls ? controlsContainer : null);

    // Apply scale to primary stage
    const stg = _inst.stage();
    if (stg) {
      stg.style.transform = `scale(${scale})`;
      stg.style.transformOrigin = "top left";
    }

    // Add synced left + right stages
    _inst.addStage(leftSub, scale);
    _inst.addStage(rightSub, scale);
  };

  window.startRobotDancer = function () {
    if (!_inst) window.initRobotDancer();
    if (_inst) _inst.start();
  };

  window.stopRobotDancer = function () {
    if (_inst) _inst.stop();
  };

  window.stillRobotDancer = function () {
    if (!_inst) window.initRobotDancer();
    if (_inst) _inst.still();
  };

  window.refreshRobotArtwork = function () {
    if (_inst) _inst.refreshArtwork();
  };

})();
