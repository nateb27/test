import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { sceneSignature } from '../../../src/client/render/redraw';

function scene(): { root: Container; a: Sprite; b: Sprite; g: Graphics } {
  const root = new Container();
  const a = new Sprite(Texture.WHITE);
  const b = new Sprite(Texture.WHITE);
  const g = new Graphics();
  root.addChild(a, b, g);
  a.position.set(10, 20);
  b.position.set(30, 40);
  return { root, a, b, g };
}

describe('sceneSignature (draw only changed frames)', () => {
  it('is stable for an unchanged scene, including a pooled sprite reset and set back to the same values', () => {
    const { root, a } = scene();
    const s0 = sceneSignature(root, 800, 600);
    expect(sceneSignature(root, 800, 600)).toBe(s0);
    // What SpritePool.next does every frame: reset to defaults, then the caller sets the real values again.
    a.anchor.set(0.5);
    a.tint = 0xffffff;
    a.anchor.set(0);
    expect(sceneSignature(root, 800, 600)).toBe(s0);
  });

  it('changes when anything drawn changes: position, texture, tint, visibility, children, graphics, screen size', () => {
    const { root, a, b, g } = scene();
    const s0 = sceneSignature(root, 800, 600);
    const changed = (f: () => void): void => {
      const before = sceneSignature(root, 800, 600);
      f();
      expect(sceneSignature(root, 800, 600)).not.toBe(before);
    };
    changed(() => a.position.set(10.25, 20));
    changed(() => (b.texture = Texture.EMPTY));
    changed(() => (b.tint = 0xff0000));
    changed(() => (a.visible = false));
    changed(() => root.addChild(new Sprite(Texture.WHITE)));
    changed(() => g.rect(0, 0, 4, 4).fill(0xffffff));
    expect(sceneSignature(root, 1024, 600)).not.toBe(sceneSignature(root, 800, 600));
    expect(s0).not.toBe(sceneSignature(root, 800, 600));
  });
});
