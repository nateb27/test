/**
 * Entry point of the offline sprite pipeline (Blender, run on demand by a developer; never in CI or at runtime).
 *
 *   node scripts/art/run.mjs units [villager spearman ...]   # render unit animations (incremental), then pack sheets
 *   node scripts/art/run.mjs trees                           # render trees and berry bushes, then pack
 *   node scripts/art/run.mjs all                             # everything
 *   node scripts/art/run.mjs pack                            # re-pack sheets from the render cache (e.g. after art:palette)
 *   node scripts/art/run.mjs preview <subject> [k=v ...]     # quick low-sample contact sheet (see pipeline/preview.py)
 *
 * The Python comes from $ART_PYTHON or scripts/art/.venv (see scripts/art/README.md).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPE = join(HERE, 'pipeline');
const UNITS = ['villager', 'spearman', 'swordsman', 'archer', 'siphonarios', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet'];
const VEG = ['oak1', 'oak2', 'cypress', 'olive', 'pine1', 'pine2', 'berry1', 'berry2'];

function python() {
  const env = process.env.ART_PYTHON;
  if (env) return env;
  const local = join(HERE, '.venv', 'bin', 'python');
  if (existsSync(local)) return local;
  console.error('No Python with bpy found: create scripts/art/.venv (see scripts/art/README.md) or set ART_PYTHON.');
  process.exit(1);
}

function run(script, args) {
  const r = spawnSync(python(), [join(PIPE, script), ...args], { stdio: 'inherit', cwd: PIPE });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith('--'));
const names = rest.filter((a) => !a.startsWith('--'));
switch (cmd) {
  case 'units':
    run('render.py', [...(names.length ? names : UNITS), ...flags]);
    run('pack.py', []);
    break;
  case 'trees':
    run('render.py', [...VEG, ...flags]);
    run('pack.py', []);
    break;
  case 'all':
    run('render.py', [...UNITS, ...VEG, ...flags]);
    run('pack.py', []);
    break;
  case 'pack':
    run('pack.py', names);
    break;
  case 'preview':
    run('preview.py', rest);
    break;
  default:
    console.log('usage: node scripts/art/run.mjs units [names] | trees | all | pack | preview <subject> [k=v]');
}
