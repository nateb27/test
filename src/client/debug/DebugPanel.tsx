/**
 * The F3 debug overlay (plan 9.6): frame rate, tick time, entity counts, path
 * queue, drawing toggles and the cheats panel. Mounted only while open (and
 * only in dev and e2e builds), so it polls and profiles nothing when closed.
 */

import { useEffect, useState } from 'preact/hooks';
import { RESOURCE_TYPES } from '../../sim/types';
import { CHEAT_RESOURCE_AMOUNT, type DebugController, type DebugSnapshot } from './controller';
import type { DebugToggles } from './debugLayer';
import './debug.css';

/** How often the readouts refresh (ms). */
const POLL_MS = 250;

const TOGGLES: readonly { key: keyof DebugToggles; label: string }[] = [
  { key: 'occupancy', label: 'Occupancy grid' },
  { key: 'paths', label: 'Unit paths' },
  { key: 'approach', label: 'Approach tiles (selection)' },
  { key: 'coords', label: 'Tile under cursor' },
];

function ms(v: number): string {
  return v.toFixed(2);
}

export function DebugPanel({ controller }: { controller: DebugController }) {
  const [snap, setSnap] = useState<DebugSnapshot>(() => controller.snapshot());
  const [toggles, setToggles] = useState<DebugToggles>({ ...controller.layer.toggles });
  const [unit, setUnit] = useState(controller.unitTypes[0] ?? 'villager');
  const [armed, setArmed] = useState<string | null>(controller.armed);
  const [hash, setHash] = useState<string>('');
  const [liveHash, setLiveHash] = useState(false);
  const [instant, setInstant] = useState({ build: false, research: false });

  useEffect(() => {
    controller.attach();
    const refresh = (): void => {
      const s = controller.snapshot();
      setSnap(s);
      // While paused a clicked cheat has not been applied by a tick yet: keep the checkbox as clicked.
      if (!s.paused) setInstant({ build: s.cheats.instantBuild, research: s.cheats.instantResearch });
      if (liveHash) setHash(controller.stateHash());
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.detach();
    };
  }, [controller, liveHash]);

  const toggle = (key: keyof DebugToggles, on: boolean): void => {
    controller.setToggle(key, on);
    setToggles((t) => ({ ...t, [key]: on }));
  };
  const { profile, counts } = snap;
  const types = Object.entries(counts.byType)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8);

  return (
    <div class="debug-root ui-root" data-testid="debug-overlay">
      <div class="debug-panel panel">
        <div class="debug-title">
          Debug <span class="debug-key">F3</span>
        </div>
        <div class="debug-cols">
          <div class="debug-col">
            <h3>Performance</h3>
            <dl class="debug-stats">
              <dt>Frame rate</dt>
              <dd data-testid="debug-fps">{profile.fps.toFixed(profile.fps < 10 ? 1 : 0)} fps</dd>
              <dt>Tick (avg / max)</dt>
              <dd data-testid="debug-tick-ms">
                {ms(profile.tickAvgMs)} / {ms(profile.tickMaxMs)} ms
              </dd>
              <dt>Sim tick</dt>
              <dd data-testid="debug-tick">{snap.tick}{snap.paused ? ' (paused)' : ''}</dd>
              <dt>Path queue</dt>
              <dd data-testid="debug-path-queue">{counts.pathQueue}</dd>
              <dt>Entities</dt>
              <dd data-testid="debug-entities">
                {counts.total} ({counts.unit} units, {counts.building} buildings, {counts.node} nodes)
              </dd>
            </dl>
            <div class="debug-types" data-testid="debug-types">
              {types.map(([id, n]) => (
                <span key={id} class="debug-chip">
                  {id} {n}
                </span>
              ))}
            </div>
            <h3>Draw</h3>
            {TOGGLES.map((t) => (
              <label key={t.key} class="debug-check">
                <input
                  type="checkbox"
                  data-testid={`debug-toggle-${t.key}`}
                  checked={toggles[t.key]}
                  onChange={(e) => {
                    toggle(t.key, (e.currentTarget as HTMLInputElement).checked);
                    (e.currentTarget as HTMLInputElement).blur(); // keep the game hotkeys live
                  }}
                />
                {t.label}
              </label>
            ))}
            <div class="debug-cursor" data-testid="debug-cursor">
              Cursor tile: {snap.cursorTile === null ? 'off map' : `${snap.cursorTile.tx}, ${snap.cursorTile.ty}`}
            </div>
          </div>
          <div class="debug-col" data-testid="debug-cheats">
            <h3>Cheats</h3>
            <div class="debug-row">
              {RESOURCE_TYPES.map((r) => (
                <button key={r} type="button" data-testid={`cheat-add-${r}`} onClick={() => controller.addResources(CHEAT_RESOURCE_AMOUNT, [r])}>
                  +{CHEAT_RESOURCE_AMOUNT / 1000}k {r}
                </button>
              ))}
              <button type="button" data-testid="cheat-add-all" onClick={() => controller.addResources(CHEAT_RESOURCE_AMOUNT)}>
                +1k all
              </button>
            </div>
            <label class="debug-check">
              <input
                type="checkbox"
                data-testid="cheat-instant-build"
                checked={instant.build}
                onChange={(e) => {
                  const on = (e.currentTarget as HTMLInputElement).checked;
                  setInstant((i) => ({ ...i, build: on }));
                  controller.setInstantBuild(on);
                  (e.currentTarget as HTMLInputElement).blur();
                }}
              />
              Instant build
            </label>
            <label class="debug-check">
              <input
                type="checkbox"
                data-testid="cheat-instant-research"
                checked={instant.research}
                onChange={(e) => {
                  const on = (e.currentTarget as HTMLInputElement).checked;
                  setInstant((i) => ({ ...i, research: on }));
                  controller.setInstantResearch(on);
                  (e.currentTarget as HTMLInputElement).blur();
                }}
              />
              Instant research and training
            </label>
            <div class="debug-row">
              <select
                data-testid="cheat-unit"
                value={unit}
                onChange={(e) => {
                  setUnit((e.currentTarget as HTMLSelectElement).value);
                  (e.currentTarget as HTMLSelectElement).blur();
                  if (armed !== null) {
                    controller.armSpawn((e.currentTarget as HTMLSelectElement).value);
                    setArmed((e.currentTarget as HTMLSelectElement).value);
                  }
                }}
              >
                {controller.unitTypes.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button
                type="button"
                class={armed !== null ? 'active' : ''}
                data-testid="cheat-spawn"
                onClick={() => {
                  const next = armed === null ? unit : null;
                  controller.armSpawn(next);
                  setArmed(next);
                }}
              >
                {armed !== null ? 'Click the map (off)' : 'Spawn at cursor'}
              </button>
            </div>
            <div class="debug-hint">Armed: each left click on the map spawns the unit where you click.</div>
            <h3>State hash</h3>
            <div class="debug-row">
              <button type="button" data-testid="debug-hash-refresh" onClick={() => setHash(controller.stateHash())}>
                Show hash
              </button>
              <label class="debug-check">
                <input type="checkbox" checked={liveHash} onChange={(e) => {
                  setLiveHash((e.currentTarget as HTMLInputElement).checked);
                  (e.currentTarget as HTMLInputElement).blur();
                }} />
                live
              </label>
            </div>
            <code class="debug-hash" data-testid="debug-hash">
              {hash === '' ? '-' : hash}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
