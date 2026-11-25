import { useEffect, useState } from 'preact/hooks';
import type { DataRegistry } from '../../../data/schema';
import type { Sim } from '../../../sim/types';
import type { SaveStorage } from '../../platform';
import type { HudController } from '../hudController';
import type { HudViewModel } from '../viewModel';
import { CommandCard } from './CommandCard';
import { GameMenu } from './GameMenu';
import { IconContext, type IconResolver } from './Icon';
import { Banner, Toasts } from './Notifications';
import { SelectionPanel } from './SelectionPanel';
import { TopBar } from './TopBar';
import '../hud.css';

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
  controller: Pick<HudController, 'vm' | 'subscribe' | 'clickSlot' | 'narrowSelection' | 'cancelQueueItem' | 'cycleIdleVillager' | 'setSpeed' | 'togglePause' | 'setMenuOpen'>;
  iconUrl: IconResolver;
  storage: SaveStorage;
  /** The running sim (for saving). */
  sim: Sim;
  registry?: DataRegistry;
  onRestart(): void;
  onQuit(): void;
  onLoaded(sim: Sim): void;
}

/**
 * The in-match HUD. The root never captures pointer events; only its panels do,
 * so the canvas stays clickable everywhere else.
 */
export function Hud({ controller, iconUrl, storage, sim, registry, onRestart, onQuit, onLoaded }: HudProps) {
  const vm = useViewModel(controller);
  return (
    <IconContext.Provider value={iconUrl}>
      <div class="hud ui-root" data-testid="hud">
        <TopBar vm={vm.topBar} actions={controller} />
        <Toasts toasts={vm.toasts} />
        <Banner banner={vm.banner} />
        {vm.placing !== null && (
          <div class="placing-hint" data-testid="placing-hint">
            Click to place, Shift to keep placing, Esc to cancel
          </div>
        )}
        <div class="bottom">
          <div class="minimap-frame panel">
            {/* WP10 mounts the minimap into this empty container. */}
            <div id="minimap-slot" data-testid="minimap-slot" />
          </div>
          <SelectionPanel vm={vm.selection} actions={controller} />
          <CommandCard vm={vm.commandCard} actions={controller} registry={registry} />
        </div>
        {vm.menuOpen && (
          <GameMenu
            storage={storage}
            sim={sim}
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
