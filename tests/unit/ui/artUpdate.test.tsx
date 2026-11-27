// @vitest-environment happy-dom
/**
 * Portraits drawn before their sprite existed (the rendered art's background pass) used to stay blank: the HUD read
 * the icon URLs once. The "art updated" signal (`art/updates.ts`) gives the icon resolver a new identity, so every
 * icon reads its URL again.
 */
import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyArtUpdate } from '../../../src/client/art/updates';
import { Hud } from '../../../src/client/ui/components/Hud';
import { HudController } from '../../../src/client/ui/hudController';
import { LocalSaveStorage } from '../../../src/client/platform';
import { fakeMatch } from './helpers';

afterEach(cleanup);

describe('HUD icons after late art', () => {
  it('re-reads every icon URL when art arrives after loading', async () => {
    const match = fakeMatch({ age: 2 });
    const controller = new HudController({ match, playerId: 1 });
    controller.start();
    let ready = false;
    const iconUrl = vi.fn((id: string) => (ready ? `data:image/png;base64,${id}` : 'data:image/png;base64,blank'));
    render(
      <Hud
        controller={controller}
        iconUrl={iconUrl}
        storage={new LocalSaveStorage(window.localStorage)}
        sim={{ state: match.fx.state, step: () => [], query: match.sim.query as never }}
        onRestart={vi.fn()}
        onQuit={vi.fn()}
        onLoaded={vi.fn()}
      />,
    );
    match.selection.set([match.fx.townCenter]);
    const portrait = await screen.findByTestId('owner-color');
    const img = (): HTMLImageElement => portrait.querySelector('img')!;
    expect(img().getAttribute('src')).toBe('data:image/png;base64,blank');
    // The background pass finishes: the same selection, no view-model change, and yet the portrait is redrawn.
    ready = true;
    act(() => notifyArtUpdate());
    expect(img().getAttribute('src')).toBe('data:image/png;base64,icon.building.townCenter');
    controller.stop();
  });
});
