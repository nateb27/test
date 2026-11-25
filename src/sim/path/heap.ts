/**
 * Binary min-heap of A* open-list entries (plan 4.3). Owned by WP2.
 *
 * Entries are ordered by (f, h, node) ascending: lowest total cost first,
 * then the one closer to the goal, then the lowest tile index. The ordering
 * is total, so the search is fully deterministic. Scratch only, never state.
 */
export class NodeHeap {
  private f: Int32Array;
  private h: Int32Array;
  private node: Int32Array;
  private count = 0;

  constructor(capacity = 1024) {
    this.f = new Int32Array(capacity);
    this.h = new Int32Array(capacity);
    this.node = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a]!;
    const fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!;
    const hb = this.h[b]!;
    if (ha !== hb) return ha < hb;
    return this.node[a]! < this.node[b]!;
  }

  private swap(a: number, b: number): void {
    const f = this.f[a]!;
    const h = this.h[a]!;
    const n = this.node[a]!;
    this.f[a] = this.f[b]!;
    this.h[a] = this.h[b]!;
    this.node[a] = this.node[b]!;
    this.f[b] = f;
    this.h[b] = h;
    this.node[b] = n;
  }

  private grow(): void {
    const cap = this.f.length * 2;
    const f = new Int32Array(cap);
    const h = new Int32Array(cap);
    const node = new Int32Array(cap);
    f.set(this.f);
    h.set(this.h);
    node.set(this.node);
    this.f = f;
    this.h = h;
    this.node = node;
  }

  push(node: number, f: number, h: number): void {
    if (this.count === this.f.length) this.grow();
    let i = this.count++;
    this.f[i] = f;
    this.h[i] = h;
    this.node[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Remove and return the minimum entry's node. The heap must not be empty. */
  pop(): number {
    const top = this.node[0]!;
    const last = --this.count;
    if (last > 0) {
      this.f[0] = this.f[last]!;
      this.h[0] = this.h[last]!;
      this.node[0] = this.node[last]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
