# Offline sprite pipeline (Blender)

Renders every unit (8 facings, all animations) and the trees and berry bushes with Blender's Cycles, in the game's
exact isometric projection and light, and packs them into indexed PNG sheets with JSON frame metadata under
`src/client/art/sheets/`. The game loads those at start (`src/client/art/sheet/`); nothing is rendered at runtime.
Run it on demand when a model, pose or the light changes. It never runs in CI.

## Setup (once)

Needs Python 3.13 (the `bpy` wheel's version) and ~1.5 GB of disk for the wheel. Keep the venv out of git (it is
ignored):

```
python3.13 -m venv scripts/art/.venv
scripts/art/.venv/bin/pip install bpy numpy pillow scipy OpenEXR
```

Or point `ART_PYTHON` at any Python that has those packages. `ART_THREADS` caps Cycles' threads (default: all
cores); `ART_CACHE` moves the render cache (default `scripts/art/.cache/`, ignored).

## Commands

```
npm run art:units                          # render all units (incremental), then pack all sheets
node scripts/art/run.mjs units villager    # render one unit, then pack
npm run art:trees                          # trees and berry bushes, then pack
node scripts/art/run.mjs all               # everything
npm run art:sheets                         # pack only (after a palette refit, or to re-dither)
node scripts/art/run.mjs preview archer anims=idle,attack facings=1,7   # quick contact sheet (low samples)
node scripts/art/run.mjs units --force     # ignore the cache
```

Rendering is incremental: every animation's scene (evaluated geometry of every posed copy, materials, light, camera,
render and post settings) is hashed, and an animation whose hash matches the cache is skipped. Changing one unit's
model re-renders only that unit.

Measured on 4 CPU threads of an otherwise idle machine: a foot unit's 8-frame animation (64 frames with all facings,
3x supersampling, 20 samples) takes 70-110 s (the siphonarios, with its bronze, about 3 min); cavalry and siege
(2x supersampling, 10 samples) 80-130 s and 150-300 s; a tree 10-40 s; so the whole roster (about 2,750 frames)
takes about 1.5 hours, much longer when the machine is shared. Packing all sheets takes about a minute,
`npm run art:palette` about 20 s. `ART_VERBOSE=1` prints a time split per animation.

`--adopt` (`python pipeline/render.py --adopt`) records the current scene digests for the cached frames without
rendering, for use after changing the digest code itself.

## Palette

Sheets, voxel buildings and terrain share one 256-colour palette (240 fitted colours plus a 16-step player-colour
ramp). Packing writes `scripts/art/sheet-histogram.json` (the colours of every figure before quantisation);
`npm run art:palette` fits the palette to the voxel renders, the terrain and that histogram and writes
`src/client/art/rendered/palette.json`. After a refit run `npm run art:sheets` so the sheets are re-quantised to it.

## How it works

- `pipeline/core.py`: scene, orthographic camera in the game projection (`screenX = (x - y) * 32`,
  `screenY = (x + y) * 16 - z * 32 * sqrt(1.5)`), sun and sky from `src/client/art/rendered/artConstants.json`
  (shared with the voxel renderer; Cycles' sun is scaled by pi to match its lighting model), procedural materials,
  mesh builder, armature helpers, multilayer EXR read-back (combined, shadow catcher, `team` AOV).
- `pipeline/humans.py`, `horses.py`, `siege.py`, `trees.py`: the models; `human_anims.py`, `horse_anims.py`,
  `siege_anims.py`: poses and animations; `subjects.py`: the registry (frame size and ground anchor per unit).
- `pipeline/render.py`: renders all frames x 8 facings of an animation in one Cycles render (copies of the posed rig on
  a grid), 3x supersampled, 20 samples + denoising, then `post.py` cuts it into layers: figure (hard 1-bit alpha at 50 %
  coverage, the voxel renderer's tone map, sharpening, dark inner edge and soft outline), player-colour levels (from
  the `team` AOV: team surfaces are rendered in a neutral reference cloth and their brightness becomes one of 16 ramp
  levels) and the ground shadow (shadow catcher, same strength formula as the voxel renderer).
- `pipeline/pack.py`: dithers figures to the shared palette (the voxel renderer's masked serpentine Floyd-Steinberg),
  trims, shelf-packs and writes `<unit>-N.png` (indexed: 0 transparent, shadow levels, outline levels, 16 team levels,
  then the shared colours the sheet uses) and `<unit>.json` (states, ms per frame, loop, walk `cycle` in tiles, and per
  frame its rect, offset in the untrimmed frame and the figure's box). `pipeline/sheets_spec.py` maps animations to
  game state names.
- Corpses are the last death frame, darkened and desaturated in packing.
- Walk and carry cycles carry the ground distance one loop covers (from the stride of the rig), so the game advances
  their frames by distance moved and feet do not slide at any speed.
