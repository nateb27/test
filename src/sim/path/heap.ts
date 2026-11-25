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
    const fs = this.f;
    const hs = this.h;
    const ns = this.node;
    let i = this.count++;
    // Sift up by moving parents down into the hole (no swaps).
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pf = fs[parent]!;
      if (pf < f || (pf === f && (hs[parent]! < h || (hs[parent] === h && ns[parent]! < node)))) break;
      fs[i] = pf;
      hs[i] = hs[parent]!;
      ns[i] = ns[parent]!;
      i = parent;
    }
    fs[i] = f;
    hs[i] = h;
    ns[i] = node;
  }

  /** Remove and return the minimum entry's node. The heap must not be empty. */
  pop(): number {
    const fs = this.f;
    const hs = this.h;
    const ns = this.node;
    const top = ns[0]!;
    const last = --this.count;
    if (last > 0) {
      // Re-insert the last entry from the root, moving the smaller child up into the hole.
      const f = fs[last]!;
      const h = hs[last]!;
      const node = ns[last]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= last) break;
        const r = c + 1;
        if (r < last) {
          const fc = fs[c]!;
          const fr = fs[r]!;
          if (fr < fc || (fr === fc && (hs[r]! < hs[c]! || (hs[r] === hs[c] && ns[r]! < ns[c]!)))) c = r;
        }
        const cf = fs[c]!;
        if (cf > f || (cf === f && (hs[c]! > h || (hs[c] === h && ns[c]! > node)))) break;
        fs[i] = cf;
        hs[i] = hs[c]!;
        ns[i] = ns[c]!;
        i = c;
      }
      fs[i] = f;
      hs[i] = h;
      ns[i] = node;
    }
    return top;
  }
}
