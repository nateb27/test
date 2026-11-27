import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DataRegistry } from '../../../data/schema';
import { artVersion, onArtUpdate } from '../../art/updates';
import type { Sim } from '../../../sim/types';
import type { SaveStorage } from '../../platform';
import type { HudController } from '../hudController';
import { MODE_HINT_TEXT, type TargetModeKind } from '../text';
import type { HudViewModel } from '../viewModel';
import { CommandCard } from './CommandCard';
import { GameMenu } from './GameMenu';
import { IconContext, type IconResolver } from './Icon';
import { Banner, Toasts } from './Notifications';
import { SelectionPanel } from './SelectionPanel';
import { TopBar } from './TopBar';
import '../hud.css';

/** The art version (`art/updates.ts`): changes when sprites or icons arrive after loading. */
export function useArtVersion(): number {
  const [v, setV] = useState(artVersion());
  useEffect(() => {
    setV(artVersion());
    return onArtUpdate(setV);
  }, []);
  return v;
}

/** Subscribe a component to the controller's view-model. */
export function useViewModel(controller: Pick<HudController, 'vm' | 'subscribe'>): HudViewModel {
  const [vm, setVm] = useState(controller.vm);
  useEffect(() => {
    setVm(controller.vm);
    return controller.subscribe(setVm);
  }, [controller]);
  return vm;
}

export interface HudProps {
  controller: Pick<HudController, 'vm' | 'subscribe' | 'clickSlot' | 'narrowSelection' | 'cancelQueueItem' | 'cycleIdleVillager' | 'cycleIdleMilitary' | 'setSpeed' | 'togglePause' | 'setMenuOpen' | 'requestResign' | 'confirmResign' | 'cancelResign'>;
  iconUrl: IconResolver;
  storage: SaveStorage;
  /** The running sim (for saving). */
  sim: Sim;
  registry?: DataRegistry;
  onRestart(): void;
  onQuit(): void;
  onLoaded(sim: Sim): void;
  /** The active target mode (attack-move, repair, rally), shown as a hint like placement's; null or absent: none. */
  targetMode?: TargetModeKind | null;
}

/**
 * The in-match HUD. The root never captures pointer events; only its panels do,
 * so the canvas stays clickable everywhere else.
 */
export function Hud({ controller, iconUrl, storage, sim, registry, onRestart, onQuit, onLoaded, targetMode = null }: HudProps) {
  const vm = useViewModel(controller);
  // A new resolver identity when art arrives late (the rendered art's background pass): every icon re-reads its URL,
  // so a portrait drawn before its sprite existed (a blank frame) is replaced by the real one.
  const art = useArtVersion();
  const resolveIcon = useMemo<IconResolver>(() => (id) => iconUrl(id), [iconUrl, art]);
  // The controller keeps the parts of the view-model that did not change as the same objects, so these
  // elements are rebuilt (and Preact skips diffing them) only when their own part changed.
  const topBar = useMemo(() => <TopBar vm={vm.topBar} actions={controller} />, [vm.topBar, controller]);
  const toasts = useMemo(() => <Toasts toasts={vm.toasts} />, [vm.toasts]);
  const banner = useMemo(() => <Banner banner={vm.banner} />, [vm.banner]);
  const selection = useMemo(() => <SelectionPanel vm={vm.selection} actions={controller} />, [vm.selection, controller]);
  const card = useMemo(() => <CommandCard vm={vm.commandCard} actions={controller} registry={registry} />, [vm.commandCard, controller, registry]);
  return (
    <IconContext.Provider value={resolveIcon}>
      <div class="hud ui-root" data-testid="hud">
        {topBar}
        {toasts}
        {banner}
        {vm.placing !== null && (
          <div class="placing-hint" data-testid="placing-hint">
            Click to place, Shift to keep placing, Esc to cancel
          </div>
        )}
        {vm.placing === null && targetMode !== null && (
          <div class="placing-hint mode-hint" data-testid="mode-hint" data-mode={targetMode}>
            {MODE_HINT_TEXT[targetMode]}
          </div>
        )}
        <div class="bottom">
          <div class="minimap-frame panel">
            {/* WP10 mounts the minimap into this empty container. */}
            <div id="minimap-slot" data-testid="minimap-slot" />
          </div>
          {selection}
          {card}
        </div>
        {vm.menuOpen && (
          <GameMenu
            storage={storage}
            sim={sim}
            resignConfirmOpen={vm.resignConfirmOpen}
            onResign={() => controller.requestResign()}
            onResignYes={() => controller.confirmResign()}
            onResignNo={() => controller.cancelResign()}
            onResume={() => controller.setMenuOpen(false)}
            onRestart={onRestart}
            onQuit={onQuit}
            onLoaded={onLoaded}
          />
        )}
      </div>
    </IconContext.Provider>
  );
}
