# Dance Robot — Stances Tab in Settings Drawer

## Summary
Add a tab system to the Robot Settings drawer with two tabs: **Movement** (existing sliders) and **Stances** (pose editor). The Stances tab lets users view, edit, add, and delete the base dance poses and the playback sequence.

## Current State
- 6 hardcoded poses in `POSES[]` array (robot.js:137-144), each with 13 joint angles
- Hardcoded sequence: `[0, 1, 2, 3, 0, 4, 5, 3, 1, 0]`
- Settings drawer has a flat list of slider groups — no tab system
- No way to inspect, edit, or extend poses from the UI

## Design

### Tab Bar
- Inserted below the `dance-settings-header`, above the content area
- Two tabs: **Movement** | **Stances**
- Movement tab shows the existing slider controls (unchanged)
- Stances tab shows the pose editor
- Styled as a compact pill-toggle matching the app's dark theme

### Stances Tab Layout (top to bottom)

**1. Pose Cards** — scrollable horizontal strip of mini robot thumbnails
- One card per pose, showing a **stick-figure SVG** (simple lines + head circle using FK output)
- ~60×84px per card, outlined border, pose number label
- **Selected card** gets accent highlight
- Click a card → selects it, main robot **freezes in that pose** for live preview
- "**+**" card at the end to add a new pose (clones the currently selected one)

**2. Joint Angle Editor** — grouped sliders for the selected pose
- Groups with human-readable labels:
  - **Core**: Spine (-120...-60°), Hip Sway (-30...30°)
  - **Head**: Rotation (-30...30°)
  - **Left Arm**: Upper (-180...180°), Forearm (-180...180°), Hand (-180...180°)
  - **Right Arm**: Upper (-180...180°), Forearm (-180...180°), Hand (-180...180°)
  - **Left Leg**: Thigh (60...120°), Shin (60...120°)
  - **Right Leg**: Thigh (60...120°), Shin (60...120°)
- Each slider updates the pose in real-time → main robot updates instantly
- Same slider styling as Movement tab for consistency
- **Mirror** button: copies left arm/leg angles to right (and vice versa)

**3. Pose Actions** — button row below the sliders
- **Delete** — removes selected pose (disabled if only 1 pose remains)
- **Duplicate** — clones selected pose and appends it
- **Reset All** — restores default 6 poses + sequence

**4. Sequence Editor** — bottom section
- Shows the current sequence as numbered chips (pill badges)
- Each chip shows the pose index, coloured to match its card
- Click **×** on a chip to remove it from the sequence
- **Add** dropdown to insert a pose at the end
- Sequence loops during playback (same as current behaviour)

### Persistence
- Save custom poses + sequence to `localStorage` key `"robot-stances"`
- Load on init; if missing/corrupt, fall back to hardcoded defaults
- Any edit auto-saves (debounced)

### Live Preview
- When Stances tab is active and a pose is selected:
  - Animation **pauses** (stops the normal pose state machine cycling)
  - Robot freezes in the selected pose (no noise/randomisation)
  - Slider changes update the pose in real-time
- When switching back to Movement tab (or closing drawer):
  - Animation **resumes** from where it left off

### Changes to POSES/SEQUENCE
- Convert `POSES` from `const` to `let` (instance-scoped, mutable)
- Convert `SEQUENCE` from `const` to `let`
- Add internal methods: `setPoses(arr)`, `setSequence(arr)`, `getPoses()`, `getSequence()`
- Expose `getPoses()`, `getSequence()`, `setPoses()`, `setSequence()` on the public instance API
- Add `previewPose(pose)` method — freezes robot in a specific pose (like `still()` but deterministic)

## Files Changed

| File | Changes |
|------|---------|
| `app/static/robot.js` | Tab system in `_buildControls()`, stances tab UI builder, pose preview, mutable POSES/SEQUENCE, localStorage persistence, new public API methods |
| `app/static/style.css` | Tab bar styles, stance card grid, stick-figure SVG styles, sequence chip styles |

## Non-Goals
- No drag-and-drop reordering of sequence (chips + add/remove is sufficient)
- No undo/redo for pose edits (Reset All covers the recovery case)
- No import/export of pose sets (future enhancement)
- No changes to `dance.js` or `index.html` — everything lives inside the robot.js controls builder
