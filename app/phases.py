"""Phase profile CRUD and persistence for DJ set energy phases."""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_PROFILES_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "output", "phase_profiles.json"
)

_profiles: dict = {}  # id -> profile dict


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Default Profiles (built-in, read-only)
# ---------------------------------------------------------------------------

DEFAULT_PROFILES = {
    "classic_arc": {
        "id": "classic_arc",
        "name": "Classic Arc",
        "description": "The standard DJ set arc \u2014 warm up, build, peak, wind down, outro. Suits festival headlines and standard club nights.",
        "is_default": True,
        "phases": [
            {"name": "Warm-Up",   "pct": [0, 15],   "desc": "Slower BPM, spacious tracks, clearer grooves. Build curiosity rather than intensity. Let people settle in and find their space on the floor.", "color": "#777777"},
            {"name": "Build",     "pct": [15, 40],   "desc": "Gradually layer in bigger basslines, more recognizable hooks, tighter percussion. The crowd starts to commit \u2014 longer blends, more rhythmic drive.", "color": "#999999"},
            {"name": "Peak",      "pct": [40, 75],   "desc": "Full throttle \u2014 your biggest, most powerful tunes. Fewer risks, more crowd-pleasers. Sustained high energy with minor dips for tension and release.", "color": "#CCCCCC"},
            {"name": "Wind-Down", "pct": [75, 90],   "desc": "Ease off the intensity without losing the thread. Still quality selections but less relentless \u2014 transition from peak aggression to something more reflective.", "color": "#999999"},
            {"name": "Outro",     "pct": [90, 100],  "desc": "Cool the room with deeper, mellower selections. Let the crowd breathe and provide a graceful handoff. One or two signature tracks to close.", "color": "#777777"},
        ],
    },
    "double_peak": {
        "id": "double_peak",
        "name": "Double Peak",
        "description": "Two distinct peaks with a valley between. The strategic reset makes the second peak feel even more powerful. Suits extended club sets and progressive/trance.",
        "is_default": True,
        "phases": [
            {"name": "Opening Build", "pct": [0, 15],   "desc": "Quick but tasteful ramp-up. Establish groove and intent faster than a classic arc \u2014 you have two peaks to deliver. Set the sonic palette early.", "color": "#888888"},
            {"name": "First Peak",    "pct": [15, 35],   "desc": "First high-energy plateau but hold something back. Big tracks, driving rhythms, but not maximum intensity \u2014 save your best ammunition for the second peak.", "color": "#BBBBBB"},
            {"name": "Valley",        "pct": [35, 50],   "desc": "Deliberate pull-back into deeper, more hypnotic territory. Let the crowd breathe and reset expectations. Play selectors\u2019 tracks \u2014 build new tension from the bottom.", "color": "#777777"},
            {"name": "Second Build",  "pct": [50, 65],   "desc": "Rebuild from the valley. The crowd knows what\u2019s coming and the anticipation is electric. Can ramp faster than the first build \u2014 tighter mixes, rising energy.", "color": "#AAAAAA"},
            {"name": "Main Peak",     "pct": [65, 85],   "desc": "The real climax \u2014 exceed the first peak in every way. Maximum energy, biggest tracks, the set\u2019s defining moment. This is what they\u2019ll remember.", "color": "#CCCCCC"},
            {"name": "Cool-Down",     "pct": [85, 100],  "desc": "Relatively rapid but smooth descent. The crowd has been through a journey \u2014 give them emotional resolution. Warm, satisfying tracks that say \u2018thank you\u2019.", "color": "#888888"},
        ],
    },
    "slow_burn": {
        "id": "slow_burn",
        "name": "Slow Burn",
        "description": "Continuous ascent that never drops back. Patient and hypnotic \u2014 the crowd doesn\u2019t realise how deep they are until they check the clock. Suits deep/melodic and late-night sets.",
        "is_default": True,
        "phases": [
            {"name": "Foundation",  "pct": [0, 25],   "desc": "Minimal and atmospheric, almost ambient-adjacent. Establish a deep groove and sense of space. Pads, subtle percussion, long blends. Let the room fill naturally.", "color": "#777777"},
            {"name": "Development", "pct": [25, 50],   "desc": "Introduce more defined rhythmic elements. Basslines become prominent, melodies appear but stay understated. Each track adds one layer \u2014 never subtract.", "color": "#999999"},
            {"name": "Deepening",   "pct": [50, 75],   "desc": "The groove is now undeniable. Driving but still deep \u2014 layered, complex arrangements. The crowd is locked in a trance-like state. No sudden moves.", "color": "#BBBBBB"},
            {"name": "Culmination", "pct": [75, 100],  "desc": "The full realisation of everything built before. Not aggressive peak energy \u2014 more like maximum depth and richness. Powerful but never harsh. End at intensity, no wind-down.", "color": "#CCCCCC"},
        ],
    },
    "opening_set": {
        "id": "opening_set",
        "name": "Opening Set",
        "description": "Restraint is an art form. Energy climbs but never reaches headliner territory. Ends at what would be a classic arc\u2019s \u201cbuild\u201d phase. Suits warm-up and support slots.",
        "is_default": True,
        "phases": [
            {"name": "Ambient Welcome",    "pct": [0, 20],   "desc": "People are arriving, finding friends, getting drinks. Background-appropriate but with taste and intention. Atmospheric textures, no heavy bass yet.", "color": "#666666"},
            {"name": "Groove Establish",    "pct": [20, 45],  "desc": "Introduce a clear pulse. The empty dance floor should start to feel inviting. Low-key rhythms, gentle basslines \u2014 make standing near the speakers feel right.", "color": "#888888"},
            {"name": "Gentle Build",        "pct": [45, 75],  "desc": "People are starting to sway. More defined tracks, tasteful selections that hint at the night\u2019s direction without going there yet. Never peak \u2014 always suggest.", "color": "#AAAAAA"},
            {"name": "Handoff",             "pct": [75, 100], "desc": "Sustained warm plateau where you pass the baton. The headliner should be able to pick up seamlessly and take it higher. Never exceed the ceiling \u2014 leave room.", "color": "#999999"},
        ],
    },
    "closing_set": {
        "id": "closing_set",
        "name": "Closing Set",
        "description": "Inherit a hot room and guide people down without killing the vibe. The descent should feel like a choice, not a disappointment. Suits end-of-night and sunrise sets.",
        "is_default": True,
        "phases": [
            {"name": "Takeover",         "pct": [0, 10],   "desc": "Match the outgoing DJ\u2019s energy seamlessly. The crowd should not feel a drop-off. High intensity, confident track selection \u2014 prove you belong here.", "color": "#CCCCCC"},
            {"name": "Sustained Heat",   "pct": [10, 30],  "desc": "Maintain high energy but begin subtle shifts \u2014 deeper bass, longer breakdowns, slightly less frantic percussion. Still dancing hard, but the mood is turning.", "color": "#BBBBBB"},
            {"name": "Graceful Descent", "pct": [30, 60],  "desc": "The core transition. Move from peak-time bangers to deeper, more emotive selections. Melodies over aggression. The crowd shifts from jumping to swaying.", "color": "#999999"},
            {"name": "Afterglow",        "pct": [60, 85],  "desc": "Deep, warm, reflective \u2014 the kind of music that sounds perfect at 4am. Emotional resonance over dancefloor impact. Reward the people who stayed.", "color": "#777777"},
            {"name": "Wind-Down",        "pct": [85, 100], "desc": "Near-ambient, beautiful closure. The last few tracks that say \u2018the night is over and it was beautiful.\u2019 End with one recognisable, emotive track as a full stop.", "color": "#666666"},
        ],
    },
    "marathon": {
        "id": "marathon",
        "name": "Marathon",
        "description": "Repeating waves with a rising tide. Human energy can\u2019t sustain a single arc over 4+ hours, so each wave is a mini-arc. Suits B2B, all-night, and 4hr+ sets.",
        "is_default": True,
        "phases": [
            {"name": "Settling In", "pct": [0, 10],   "desc": "Set the tone for a long journey. The crowd knows they\u2019re in for the long haul. Eclectic, interesting, groove-forward \u2014 show your range and earn their trust early.", "color": "#777777"},
            {"name": "Wave 1",      "pct": [10, 30],  "desc": "First full build-and-release cycle. Take it up, let it breathe at the top, then pull back. Tests the crowd\u2019s range and establishes the wave pattern.", "color": "#999999"},
            {"name": "Wave 2",      "pct": [30, 55],  "desc": "Second cycle goes higher than the first. More intense peak, slightly shorter valley. The crowd trusts you now \u2014 they\u2019ll follow you into deeper territory.", "color": "#AAAAAA"},
            {"name": "Wave 3",      "pct": [55, 75],  "desc": "The biggest wave \u2014 maximum energy reached here. This is the set\u2019s true peak zone. Your best tracks, tightest mixing, most electric moments.", "color": "#CCCCCC"},
            {"name": "Wave 4",      "pct": [75, 90],  "desc": "One more push, but the ceiling is lower than wave 3. High quality, crowd-pleasing selections that acknowledge fatigue is real. Keep it joyful, not punishing.", "color": "#BBBBBB"},
            {"name": "Resolution",  "pct": [90, 100], "desc": "Bring it home. The crowd has been through a marathon together \u2014 end with feeling and resolution, not a whimper. Emotive closers that honour the journey.", "color": "#888888"},
        ],
    },
}


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------

def _load_profiles():
    """Load custom profiles from disk and merge with defaults."""
    global _profiles
    _profiles = dict(DEFAULT_PROFILES)  # start with defaults
    if os.path.exists(_PROFILES_FILE):
        try:
            with open(_PROFILES_FILE) as f:
                custom = json.load(f)
            for pid, prof in custom.items():
                if pid not in DEFAULT_PROFILES:
                    _profiles[pid] = prof
        except Exception:
            pass  # keep defaults only


def _save_profiles():
    """Save only custom profiles to disk (defaults live in code)."""
    custom = {k: v for k, v in _profiles.items() if not v.get("is_default")}
    os.makedirs(os.path.dirname(_PROFILES_FILE), exist_ok=True)
    with open(_PROFILES_FILE, "w") as f:
        json.dump(custom, f, indent=2)


# Load on import
_load_profiles()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_phases(phases):
    """Validate a phases list. Returns (ok, error_message)."""
    if not isinstance(phases, list) or len(phases) == 0:
        return False, "At least one phase is required"
    for i, p in enumerate(phases):
        if not p.get("name", "").strip():
            return False, f"Phase {i + 1} is missing a name"
        pct = p.get("pct")
        if not isinstance(pct, (list, tuple)) or len(pct) != 2:
            return False, f"Phase '{p['name']}' has invalid pct range"
        start, end = pct
        if not (isinstance(start, (int, float)) and isinstance(end, (int, float))):
            return False, f"Phase '{p['name']}' pct values must be numbers"
        if start >= end:
            return False, f"Phase '{p['name']}' start must be less than end"
        color = p.get("color", "")
        if not _HEX_RE.match(color):
            return False, f"Phase '{p['name']}' has invalid color (need #RRGGBB)"
    # Check contiguous coverage 0..100
    if phases[0]["pct"][0] != 0:
        return False, "First phase must start at 0%"
    if phases[-1]["pct"][1] != 100:
        return False, "Last phase must end at 100%"
    for i in range(len(phases) - 1):
        if phases[i]["pct"][1] != phases[i + 1]["pct"][0]:
            return False, f"Gap or overlap between '{phases[i]['name']}' and '{phases[i + 1]['name']}'"
    return True, None


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_profiles():
    """Return all profiles, defaults first then custom sorted by name."""
    defaults = sorted(
        [p for p in _profiles.values() if p.get("is_default")],
        key=lambda p: p["name"],
    )
    custom = sorted(
        [p for p in _profiles.values() if not p.get("is_default")],
        key=lambda p: p["name"],
    )
    return defaults + custom


def get_profile(profile_id):
    return _profiles.get(profile_id)


def create_profile(name, description="", phases=None):
    pid = str(uuid.uuid4())[:8]
    profile = {
        "id": pid,
        "name": name,
        "description": description,
        "is_default": False,
        "phases": phases or [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    _profiles[pid] = profile
    _save_profiles()
    return profile


def update_profile(profile_id, name=None, description=None, phases=None):
    prof = _profiles.get(profile_id)
    if not prof:
        return None
    if prof.get("is_default"):
        return None  # cannot edit defaults
    if name is not None:
        prof["name"] = name
    if description is not None:
        prof["description"] = description
    if phases is not None:
        prof["phases"] = phases
    prof["updated_at"] = _now()
    _save_profiles()
    return prof


def delete_profile(profile_id):
    prof = _profiles.get(profile_id)
    if not prof or prof.get("is_default"):
        return False
    del _profiles[profile_id]
    _save_profiles()
    return True


def duplicate_profile(source_id, new_name):
    source = _profiles.get(source_id)
    if not source:
        return None
    import copy
    phases_copy = copy.deepcopy(source["phases"])
    return create_profile(new_name, description=source.get("description", ""), phases=phases_copy)
