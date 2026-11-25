import { type Container, Sprite, type Texture } from 'pixi.js';

/** A growing pool of sprites reused every frame: `begin()`, `next()` per item, `end()` hides the rest. */
export class SpritePool {
  private readonly items: Sprite[] = [];
  private used = 0;
  private shown = 0;

  constructor(private readonly parent: Container) {}

  /** Sprites handed out since the last `begin()`. */
  get count(): number {
    return this.used;
  }

  begin(): void {
    this.used = 0;
  }

  /** The next sprite, reset to defaults (anchor centre, no tint, opaque, unrotated, unit scale). */
  next(texture: Texture): Sprite {
    let s = this.items[this.used];
    if (s === undefined) {
      s = new Sprite(texture);
      this.parent.addChild(s);
      this.items.push(s);
    } else if (s.texture !== texture) {
      s.texture = texture;
    }
    this.used++;
    s.visible = true;
    s.anchor.set(0.5);
    s.scale.set(1);
    s.rotation = 0;
    s.alpha = 1;
    s.tint = 0xffffff;
    return s;
  }

  end(): void {
    for (let i = this.used; i < this.shown; i++) this.items[i]!.visible = false;
    this.shown = this.used;
  }

  destroy(): void {
    for (const s of this.items) s.destroy();
    this.items.length = 0;
  }
}
