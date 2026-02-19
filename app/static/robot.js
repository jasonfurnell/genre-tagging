/**
 * robot.js — Dancing robot animation for the Chat tab.
 * Body parts = track cover artwork squares.
 * Joints = animated energy-wave tendrils (same style as Set Workshop).
 */
(function () {
  "use strict";

  // ─── Layout ────────────────────────────────────────────────
  const VW = 300, VH = 420;
  const ROOT_X = VW / 2, ROOT_Y = 215;

  // ─── Base skeleton segment lengths ─────────────────────────
  const S_BASE = {
    spine: 70, neck: 16, shoulderW: 28, upperArm: 42,
    forearm: 38, hipW: 16, thigh: 46, shin: 42,
  };

  // ─── Base body-part cover sizes [w, h] ─────────────────────
  const SIZES_BASE = {
    head:  [42, 42], torso: [50, 60],
    armLU: [24, 38], armRU: [24, 38],
    armLL: [20, 34], armRL: [20, 34],
    legLU: [28, 42], legRU: [28, 42],
    legLL: [24, 38], legRL: [24, 38],
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
    ["torso", "legLU"], ["torso", "legRU"],
    ["legLU", "legLL"], ["legRU", "legRL"],
  ];

  // ─── Dance poses ──────────────────────────────────────────
  const POSES = [
    { sp:-90, aLU:105, aLL:100, aRU:75,  aRL:80,  lLU:93,  lLL:90,  lRU:87,  lRL:90,  hd:0,   ry:0  },
    { sp:-88, aLU:115, aLL:125, aRU:-50, aRL:-65, lLU:95,  lLL:88,  lRU:82,  lRL:86,  hd:8,   ry:0  },
    { sp:-90, aLU:-130,aLL:-105,aRU:-50, aRL:-75, lLU:96,  lLL:88,  lRU:84,  lRL:92,  hd:-3,  ry:5  },
    { sp:-92, aLU:-95, aLL:-40, aRU:105, aRL:100, lLU:88,  lLL:90,  lRU:92,  lRL:90,  hd:-10, ry:0  },
    { sp:-82, aLU:140, aLL:110, aRU:40,  aRL:70,  lLU:108, lLL:72,  lRU:72,  lRL:108, hd:5,   ry:18 },
    { sp:-75, aLU:-110,aLL:-130,aRU:105, aRL:115, lLU:105, lLL:82,  lRU:78,  lRL:88,  hd:12,  ry:8  },
  ];

  const SEQUENCE = [0, 1, 2, 3, 0, 4, 5, 3, 1, 0];

  // ─── Placeholder colours ──────────────────────────────────
  const PH = [
    "#e94560","#d6334e","#0f3460","#16213e","#4ecca3",
    "#c23152","#1b3a5c","#12294d","#3db890","#e05470",
  ];
  const ACCENT_HEX = "#e94560";

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
    skelScale:  0.85,   blockScale: 0.85,
    blockRatio: 1.05,   blockRound: 0,      keyColor: 0,
    waveAmp:    3.7,    waveSpeed:  3.2,
    waveLayers: 3,      waveColor:  0.75,
    bpm:        120,    poseHold:   820,
    poseTrans:  230,    bobAmt:     0,
    swayAmt:    1.5,    poseRandom: 1.25,
    holdRandom: 0.70,   keyRandom:  0,
    moveRandom: 0.90,
  };
  const _cfg = { ...DEFAULTS };

  // ─── State ─────────────────────────────────────────────────
  let _stage = null, _svg = null, _ctrlPanel = null;
  let _els = {};
  let _partCamelot = {};
  let _seqIdx = 0;
  let _fromPose = null, _toPose = null;
  let _phase = "hold";
  let _phaseStart = 0;
  let _frame = null;
  let _startTime = 0;
  let _artworkLoaded = false;

  // ─── Dynamics state (randomiser engines) ───────────────────
  let _curHold = 820;
  let _curTrans = 230;
  let _nextKeyChange = 0;
  let _lastTickTime = 0;
  let _wander = { bob: 0, sway: 0 };

  // ─── Default auto-drive activation ─────────────────────────
  const DEFAULT_AUTO = ["waveAmp", "waveSpeed", "poseHold", "poseTrans", "swayAmt", "poseRandom"];

  // ─── Auto-drive profiles ──────────────────────────────────
  // Each slider that supports auto-drive gets a profile with "moves":
  //   lo/hi   = target value range for this move type
  //   weight  = probability of picking this move type
  //   holdLo/holdHi = how long to hold at the target (ms)
  //   moveDur = base time to reach the target (ms), ±30% jitter applied
  const AUTO_PROFILES = {
    poseTrans: {
      moves: [
        // Snap down to minimum — rapid dancing burst
        { lo: 100, hi: 250,  weight: 0.65, holdLo: 800,  holdHi: 4000, moveDur: 80  },
        // Rise to mid-high — flowing/breathing
        { lo: 500, hi: 1750, weight: 0.35, holdLo: 300,  holdHi: 2500, moveDur: 400 },
      ],
    },
    poseHold: {
      moves: [
        // Short holds — keeps it moving
        { lo: 50,  hi: 150,  weight: 0.55, holdLo: 1500, holdHi: 4000, moveDur: 150 },
        // Longer holds — dramatic pauses
        { lo: 400, hi: 1000, weight: 0.45, holdLo: 800,  holdHi: 2500, moveDur: 300 },
      ],
    },
    bobAmt: {
      moves: [
        // Subtle bob
        { lo: 0.2, hi: 1.2,  weight: 0.4,  holdLo: 2000, holdHi: 5000, moveDur: 600 },
        // Strong bob
        { lo: 2.0, hi: 4.0,  weight: 0.6,  holdLo: 1000, holdHi: 3000, moveDur: 350 },
      ],
    },
    swayAmt: {
      moves: [
        // Minimal sway
        { lo: 0,   hi: 2,    weight: 0.45, holdLo: 2000, holdHi: 5000, moveDur: 700 },
        // Loose sway
        { lo: 4,   hi: 12,   weight: 0.55, holdLo: 1000, holdHi: 3000, moveDur: 400 },
      ],
    },
    waveAmp: {
      moves: [
        // Calm waves
        { lo: 2,   hi: 3,    weight: 0.4,  holdLo: 2000, holdHi: 5000, moveDur: 500 },
        // Energetic waves
        { lo: 3.5, hi: 5,    weight: 0.6,  holdLo: 1000, holdHi: 3000, moveDur: 300 },
      ],
    },
    waveSpeed: {
      moves: [
        // Slow waves
        { lo: 0.3, hi: 1.2,  weight: 0.4,  holdLo: 3000, holdHi: 6000, moveDur: 600 },
        // Fast waves
        { lo: 2.0, hi: 4.0,  weight: 0.6,  holdLo: 1500, holdHi: 3000, moveDur: 400 },
      ],
    },
    skelScale: {
      moves: [
        // Compact
        { lo: 0.5, hi: 0.8,  weight: 0.35, holdLo: 3000, holdHi: 7000, moveDur: 800 },
        // Normal-large
        { lo: 0.9, hi: 1.5,  weight: 0.65, holdLo: 2000, holdHi: 5000, moveDur: 600 },
      ],
    },
    blockScale: {
      moves: [
        // Small blocks
        { lo: 0.5, hi: 0.8,  weight: 0.4,  holdLo: 3000, holdHi: 6000, moveDur: 700 },
        // Large blocks
        { lo: 1.0, hi: 2.0,  weight: 0.6,  holdLo: 2000, holdHi: 5000, moveDur: 500 },
      ],
    },
    poseRandom: {
      moves: [
        // Tight poses
        { lo: 0,   hi: 0.5,  weight: 0.35, holdLo: 2000, holdHi: 5000, moveDur: 400 },
        // Wild poses
        { lo: 1.0, hi: 3.0,  weight: 0.65, holdLo: 1500, holdHi: 4000, moveDur: 300 },
      ],
    },
  };

  // ─── Auto-drive state ─────────────────────────────────────
  // key → { active, phase, target, from, moveStart, moveDur, holdUntil, btn }
  const _auto = {};

  function _autoPickTarget(key, now) {
    const profile = AUTO_PROFILES[key];
    const state = _auto[key];
    const moves = profile.moves;

    // Weighted random pick
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

    // Snap target to slider step
    const s = SLIDERS.find(x => x.key === key);
    if (s) state.target = Math.round(state.target / s.step) * s.step;

    state.moveStart = now;
    state.moveDur = pick.moveDur * (0.7 + Math.random() * 0.6);  // ±30% jitter
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
    if (REFRESH[key]) REFRESH[key]();
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
      // Start immediately with a new target pick
      _autoPickTarget(key, performance.now());
    }
  }

  function _setAllAuto(on) {
    for (const key of Object.keys(AUTO_PROFILES)) {
      _setOneAuto(key, on);
    }
  }

  function _setAutoKeys(keys) {
    const now = performance.now();
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

  // ─── Helpers ───────────────────────────────────────────────
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
    names.forEach(name => {
      _partCamelot[name] = CAMELOT_KEYS[Math.floor(Math.random() * CAMELOT_KEYS.length)];
    });
  }

  function beatPulse(elapsed, bpm) {
    const beatSec = 60 / bpm;
    const phase = (elapsed % beatSec) / beatSec;
    return phase < 0.15 ? phase / 0.15 : Math.pow(1 - (phase - 0.15) / 0.85, 2);
  }

  // ─── Dynamics: compute randomised timing for next phase ────
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

  // ─── Dynamics: key colour cycling ──────────────────────────
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

  // ─── Dynamics: movement wander (Ornstein-Uhlenbeck) ────────
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
    j.elR = { x: j.shR.x + S.upperArm*Math.cos(rad(p.aRU)), y: j.shR.y + S.upperArm*Math.sin(rad(p.aRU)) };
    j.haR = { x: j.elR.x + S.forearm*Math.cos(rad(p.aRL)),  y: j.elR.y + S.forearm*Math.sin(rad(p.aRL)) };

    j.hipL = { x: j.hip.x + S.hipW*Math.cos(pL), y: j.hip.y + S.hipW*Math.sin(pL) };
    j.hipR = { x: j.hip.x + S.hipW*Math.cos(pR), y: j.hip.y + S.hipW*Math.sin(pR) };

    j.knL = { x: j.hipL.x + S.thigh*Math.cos(rad(p.lLU)), y: j.hipL.y + S.thigh*Math.sin(rad(p.lLU)) };
    j.ftL = { x: j.knL.x  + S.shin*Math.cos(rad(p.lLL)),  y: j.knL.y  + S.shin*Math.sin(rad(p.lLL)) };
    j.knR = { x: j.hipR.x + S.thigh*Math.cos(rad(p.lRU)), y: j.hipR.y + S.thigh*Math.sin(rad(p.lRU)) };
    j.ftR = { x: j.knR.x  + S.shin*Math.cos(rad(p.lRL)),  y: j.knR.y  + S.shin*Math.sin(rad(p.lRL)) };

    return j;
  }

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
      legLU: { ...mid(j.hipL, j.knL), rot: ang(j.hipL, j.knL)-90 },
      legRU: { ...mid(j.hipR, j.knR), rot: ang(j.hipR, j.knR)-90 },
      legLL: { ...mid(j.knL, j.ftL),  rot: ang(j.knL, j.ftL)-90 },
      legRL: { ...mid(j.knR, j.ftR),  rot: ang(j.knR, j.ftR)-90 },
    };
  }

  // ─── Pose interpolation ────────────────────────────────────
  function interpPose(a, b, t) {
    const e = ease(t);
    return {
      sp:  lerpAngle(a.sp,  b.sp,  e),
      aLU: lerpAngle(a.aLU, b.aLU, e), aLL: lerpAngle(a.aLL, b.aLL, e),
      aRU: lerpAngle(a.aRU, b.aRU, e), aRL: lerpAngle(a.aRL, b.aRL, e),
      lLU: lerpAngle(a.lLU, b.lLU, e), lLL: lerpAngle(a.lLL, b.lLL, e),
      lRU: lerpAngle(a.lRU, b.lRU, e), lRL: lerpAngle(a.lRL, b.lRL, e),
      hd:  lerpAngle(a.hd,  b.hd,  e),
      ry:  lerp(a.ry, b.ry, e),
    };
  }

  // ─── Pose randomiser — add noise to a base pose ────────────
  function noisyPose(base) {
    const n = _cfg.poseRandom * 30;
    const rn = () => (Math.random() - 0.5) * 2;
    return {
      sp:  base.sp  + rn() * n * 0.25,
      aLU: base.aLU + rn() * n,
      aLL: base.aLL + rn() * n,
      aRU: base.aRU + rn() * n,
      aRL: base.aRL + rn() * n,
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

  // ─── Visual update helpers ─────────────────────────────────

  function _updateBlockSizes() {
    for (const name of Object.keys(SIZES_BASE)) {
      const [w, h] = sz(name);
      _els[name].style.width = w + "px";
      _els[name].style.height = h + "px";
    }
  }

  function _updateBlockRounding() {
    const r = _cfg.blockRound + "%";
    for (const name of Object.keys(SIZES_BASE)) {
      _els[name].style.borderRadius = r;
    }
  }

  function _updateBlockColors() {
    const names = Object.keys(SIZES_BASE);
    names.forEach((name, i) => {
      const kc = partKeyColor(name);
      if (_cfg.keyColor <= 0 || !kc) {
        _els[name].style.background = PH[i];
      } else {
        _els[name].style.background = hexLerp(PH[i], kc, Math.min(_cfg.keyColor, 1));
      }
    });
  }

  // ─── Build DOM ─────────────────────────────────────────────
  function _build() {
    const panel = document.getElementById("robot-panel");
    if (!panel) return false;

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

    panel.innerHTML = "";
    panel.appendChild(_stage);
    _buildControls(panel);
    return true;
  }

  // ─── Slider Control Panel ──────────────────────────────────

  const SLIDERS = [
    { group: "Body" },
    { key: "skelScale",  label: "Skeleton Scale",    min: 0.3, max: 1.5,  step: 0.05, fmt: v => v.toFixed(2) },
    { key: "blockScale", label: "Block Size",         min: 0.5, max: 2.5,  step: 0.05, fmt: v => v.toFixed(2) },
    { key: "blockRatio", label: "Block Ratio",        min: 0.3, max: 3.0,  step: 0.05, fmt: v => v.toFixed(2) },
    { key: "blockRound", label: "Block Rounding",     min: 0,   max: 50,   step: 1,    fmt: v => v + "%" },
    { key: "keyColor",   label: "Key Colour",         min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
    { group: "Energy" },
    { key: "waveAmp",    label: "Wave Amplitude",     min: 2,   max: 5,    step: 0.1,  fmt: v => v.toFixed(1) },
    { key: "waveSpeed",  label: "Wave Speed",         min: 0,   max: 4,    step: 0.1,  fmt: v => v.toFixed(1) },
    { key: "waveLayers", label: "Wave Layers",        min: 1,   max: 6,    step: 1,    fmt: v => String(v) },
    { key: "waveColor",  label: "Wave Colour",        min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
    { group: "Movement" },
    { key: "bpm",        label: "BPM Tempo",          min: 60,  max: 200,  step: 1,    fmt: v => String(v) },
    { key: "poseHold",   label: "Pose Hold",          min: 50,  max: 1000, step: 10,   fmt: v => v + "ms" },
    { key: "poseTrans",  label: "Transition",         min: 100, max: 1750, step: 10,   fmt: v => v + "ms" },
    { key: "bobAmt",     label: "Bob Amount",         min: 0,   max: 4,    step: 0.1,  fmt: v => v.toFixed(1) },
    { key: "swayAmt",    label: "Sway Amount",        min: 0,   max: 12,   step: 0.5,  fmt: v => v.toFixed(1) },
    { key: "poseRandom", label: "Pose Randomiser",    min: 0,   max: 3,    step: 0.05, fmt: v => (v*100|0) + "%" },
    { group: "Dynamics" },
    { key: "holdRandom", label: "Hold Randomiser",    min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
    { key: "keyRandom",  label: "Key Randomiser",     min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
    { key: "moveRandom", label: "Move Randomiser",    min: 0,   max: 1,    step: 0.05, fmt: v => (v*100|0) + "%" },
  ];

  const REFRESH = {
    blockScale: _updateBlockSizes,
    blockRatio: _updateBlockSizes,
    blockRound: _updateBlockRounding,
    keyColor:   _updateBlockColors,
  };

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

      // Auto-drive toggle for eligible sliders
      if (hasAuto) {
        const autoBtn = document.createElement("button");
        autoBtn.className = "robot-ctrl-auto";
        autoBtn.textContent = "\u25B6";  // ▶
        autoBtn.title = "Auto-drive";
        // Initialise auto state for this slider
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
    autopilotBtn.id = "robot-autopilot-btn";
    autopilotBtn.textContent = "Autopilot";
    let autopilotOn = false;
    autopilotBtn.addEventListener("click", () => {
      autopilotOn = !autopilotOn;
      _setAllAuto(autopilotOn);
      autopilotBtn.classList.toggle("active", autopilotOn);
      autopilotBtn.textContent = autopilotOn ? "Stop Autopilot" : "Autopilot";
    });

    const randAllBtn = document.createElement("button");
    randAllBtn.className = "btn btn-sm btn-secondary";
    randAllBtn.textContent = "Randomise All";
    randAllBtn.addEventListener("click", _randomiseAll);

    const artBtn = document.createElement("button");
    artBtn.className = "btn btn-sm btn-secondary";
    artBtn.textContent = "Shuffle Art";
    artBtn.addEventListener("click", () => {
      _artworkLoaded = false;
      _shuffleCamelotKeys();
      _loadArt();
      _updateBlockColors();
    });

    btnRow.appendChild(resetBtn);
    btnRow.appendChild(autopilotBtn);
    btnRow.appendChild(randAllBtn);
    btnRow.appendChild(artBtn);
    _ctrlPanel.appendChild(btnRow);

    panel.appendChild(_ctrlPanel);

    // Activate default auto-drives on init
    _setAutoKeys(DEFAULT_AUTO);
    autopilotBtn.classList.add("active");
    autopilotBtn.textContent = "Stop Autopilot";
    autopilotOn = true;
  }

  function _randomiseAll() {
    _ctrlPanel.querySelectorAll(".robot-ctrl-row").forEach(row => {
      const input = row.querySelector("input[data-key]");
      if (!input) return;
      const s = SLIDERS.find(x => x.key === input.dataset.key);
      if (!s) return;
      const val = row.querySelector(".robot-ctrl-val");
      _randomiseSlider(s, input, val);
    });
    _shuffleCamelotKeys();
    _updateBlockColors();
  }

  function _resetControls() {
    Object.assign(_cfg, DEFAULTS);
    _wander.bob = 0;
    _wander.sway = 0;
    // Restore default auto-drives
    _setAutoKeys(DEFAULT_AUTO);
    const apBtn = document.getElementById("robot-autopilot-btn");
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
    _updateBlockSizes();
    _updateBlockRounding();
    _updateBlockColors();
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
      const img = _els[names[i]].querySelector("img");
      if (typeof loadArtwork === "function") {
        img.style.display = "block";
        loadArtwork(data.artist, data.title, img);
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

    // ── BPM beat pulse (0-1 on the beat) ──
    const beat = beatPulse(elapsed, _cfg.bpm);

    // ── Auto-drive: update any actively driven sliders ──
    _tickAutoDrive(now);

    // ── Dynamics: movement wander ──
    _tickMoveWander(dt);

    // ── Dynamics: key colour cycling ──
    _tickKeyRandom(now);

    // ── Pose state machine (uses randomised timing) ──
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

    // Bob & sway (BPM-synced + movement wander)
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

    // ── Update cover positions + beat-synced glow ──
    const glowBase = 8;
    const glowBeat = beat * 12;
    for (const [name, p] of Object.entries(pos)) {
      const [w, h] = sz(name);
      const kc = partKeyColor(name);
      const glowColor = (_cfg.keyColor > 0 && kc) ? kc : ACCENT_HEX;
      const glowPx = glowBase + glowBeat;
      _els[name].style.transform =
        `translate(${(p.x - w/2).toFixed(1)}px, ${(p.y - h/2).toFixed(1)}px) rotate(${p.rot.toFixed(1)}deg)`;
      _els[name].style.boxShadow =
        `0 0 ${glowPx.toFixed(0)}px ${glowColor}80`;
    }

    // ── Render energy waves (beat pumps amplitude) ──
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
    _svg.innerHTML = svg;

    // Lazy artwork load
    if (!_artworkLoaded && Math.random() < 0.01) _loadArt();

    _frame = requestAnimationFrame(_tick);
  }

  // ─── Public API ────────────────────────────────────────────
  window.initRobotDancer = function () {
    if (_stage) return;
    if (!_build()) return;
    _loadArt();
  };

  window.startRobotDancer = function () {
    if (!_stage) window.initRobotDancer();
    if (!_stage || _frame) return;
    _startTime = performance.now();
    _lastTickTime = _startTime;
    _phaseStart = _startTime;
    _seqIdx = 0;
    _toPose = noisyPose(POSES[0]);
    _phase = "hold";
    _curHold = _rollHold();
    _curTrans = _rollTrans();
    _wander = { bob: 0, sway: 0 };
    _scheduleKeyChange(_startTime);
    _frame = requestAnimationFrame(_tick);
  };

  window.stopRobotDancer = function () {
    if (_frame) { cancelAnimationFrame(_frame); _frame = null; }
  };

  window.refreshRobotArtwork = function () {
    _artworkLoaded = false;
    _loadArt();
  };

})();
