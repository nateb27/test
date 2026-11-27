"""Procedural trees in game units: space-colonisation branch skeleton, pipe-model radii, tube branches,
thousands of small leaf polygons (needle tufts for the pine) with per-leaf colour variation."""
import math
import numpy as np
from core import MB, make_mat
from mathutils import Matrix, Vector


def envelope_points(rng, n, lobes, inside=None):
    """Sample attractors inside a union of ellipsoid lobes [(cx,cy,cz,rx,ry,rz)]."""
    lo = np.array([[l[0] - l[3], l[1] - l[4], l[2] - l[5]] for l in lobes]).min(0)
    hi = np.array([[l[0] + l[3], l[1] + l[4], l[2] + l[5]] for l in lobes]).max(0)
    pts = []
    while len(pts) < n:
        p = lo + rng.random(3) * (hi - lo)
        ok = any(((p[0] - l[0]) / l[3]) ** 2 + ((p[1] - l[1]) / l[4]) ** 2 + ((p[2] - l[2]) / l[5]) ** 2 < 1 for l in lobes)
        if ok and (inside is None or inside(p)): pts.append(p)
    return np.array(pts)


def colonise(trunk, attr, step, di, dk, iters=120, tropism=(0, 0, 0.0), rng=None, jitter=0.15):
    nodes = [np.array(p, float) for p in trunk]; par = [-1] + list(range(len(trunk) - 1))
    attr = attr.copy(); trop = np.array(tropism, float)
    for it in range(iters):
        if len(attr) == 0: break
        N = np.array(nodes)
        d = np.linalg.norm(attr[:, None, :] - N[None], axis=2)
        near = d.argmin(1); nd = d[np.arange(len(attr)), near]
        act = nd < di
        if not act.any(): break
        grow = {}
        for a_i in np.nonzero(act)[0]:
            v = attr[a_i] - N[near[a_i]]; v /= (np.linalg.norm(v) + 1e-9)
            grow.setdefault(near[a_i], []).append(v)
        for ni, vs in grow.items():
            v = np.sum(vs, 0); v /= (np.linalg.norm(v) + 1e-9)
            v = v + trop + (rng.random(3) - 0.5) * jitter; v /= np.linalg.norm(v)
            nodes.append(N[ni] + v * step); par.append(ni)
        N = np.array(nodes)
        d = np.linalg.norm(attr[:, None, :] - N[None], axis=2).min(1)
        attr = attr[d > dk]
    return np.array(nodes), np.array(par)


def pipe_radii(par, r_tip, expo):
    n = len(par); r = np.zeros(n); ch = [[] for _ in range(n)]
    for i in range(1, n):
        if par[i] >= 0: ch[par[i]].append(i)
    for i in range(n - 1, -1, -1):
        r[i] = r_tip if not ch[i] else sum(r[c] ** expo for c in ch[i]) ** (1 / expo)
    return r, ch


def depth_to_tip(ch):
    n = len(ch); dt = np.zeros(n, int)
    for i in range(n - 1, -1, -1):
        dt[i] = 0 if not ch[i] else 1 + min(dt[c] for c in ch[i])
    return dt


def leaf_poly(mb, c, nrm, L, W, rot, m, col, shape='diamond'):
    nrm = Vector(nrm).normalized()
    t = nrm.cross(Vector((0.3, 0.2, 1))).normalized(); b = nrm.cross(t)
    ax = t * math.cos(rot) + b * math.sin(rot); px = nrm.cross(ax)
    c = Vector(c)
    if shape == 'needle':
        vs = [c, c + ax * L + px * W * 0.5, c + ax * L * 1.05 - px * W * 0.5]
    else:
        vs = [c - ax * L * 0.5, c + px * W * 0.5, c + ax * L * 0.5, c - px * W * 0.5]
    idx = [mb.add_v(v, {}) for v in vs]
    mb.face(idx, m, col)


def build_tree(spec, seed):
    rng = np.random.default_rng(seed)
    bark = make_mat('bark%d' % seed, spec['bark'], var=0.35, nscale=90, streak=True, dirt=0.25, dirt_h=0.25, col2=spec.get('bark2'))
    leafm = make_mat('leaf%d' % seed, (1, 1, 1), var=0.0, attr=True, transl=spec.get('transl', 0.3), rough=0.8)
    # trunk polyline
    trunk = [np.array([0.0, 0.0, 0.0])]
    lean = np.array(spec.get('lean', (0, 0))) * (rng.random(2) * 0.6 + 0.7)
    th = spec['trunk_h']; nseg = max(2, int(th / spec['step']))
    for i in range(1, nseg + 1):
        t = i / nseg
        trunk.append(np.array([lean[0] * t * t + (rng.random() - .5) * 0.01, lean[1] * t * t + (rng.random() - .5) * 0.01, th * t]))
    lobes = spec['lobes'](rng)
    attr = envelope_points(rng, spec['n_attr'], lobes, spec.get('inside'))
    nodes, par = colonise(trunk, attr, spec['step'], spec['di'], spec['dk'], tropism=spec.get('trop', (0, 0, 0)), rng=rng, jitter=spec.get('jitter', 0.2))
    r, ch = pipe_radii(par, spec['r_tip'], spec['expo'])
    r *= spec.get('r_mul', 1.0)
    mb = MB()
    for i in range(1, len(nodes)):
        p = par[i]
        if p < 0: continue
        rr0, rr1 = r[p], r[i]
        if rr1 < 0.0025 and rr0 < 0.0025: continue
        n = 8 if rr0 > 0.03 else 6 if rr0 > 0.012 else 4
        mb.tube(nodes[p], nodes[i] + (nodes[i] - nodes[p]) * 0.08, rr0, rr1, n, bark, {}, cap0=False, cap1=False)
    # root flares
    r0 = r[0]
    for k in range(spec.get('roots', 4)):
        a = k * 2 * math.pi / spec.get('roots', 4) + rng.random() * 0.8
        mb.tube((0, 0, r0 * 1.6), (math.cos(a) * r0 * 2.2, math.sin(a) * r0 * 2.2, -0.005), r0 * 0.6, r0 * 0.2, 5, bark, {}, cap0=False)
    # leaves around twig tips
    dt = depth_to_tip(ch)
    crown_c = np.mean(nodes[len(trunk):], 0) if len(nodes) > len(trunk) else nodes[-1]
    base = np.array(spec['leaf_col']); hi = np.array(spec['leaf_col2'])
    nleaf = 0
    for i in range(len(nodes)):
        if dt[i] > spec.get('leaf_depth', 2) or i < len(trunk): continue
        k = spec['leaves_per'] if dt[i] == 0 else max(1, spec['leaves_per'] // (2 + dt[i]))
        clump = rng.random()
        for _ in range(k):
            if spec.get('shell'):
                dv = rng.normal(size=3); dv /= np.linalg.norm(dv); dv[2] = dv[2] * 0.8 + 0.15
                off = dv * spec['spread'] * (0.35 + 0.65 * rng.random() ** 0.5)
            else:
                dv = None; off = (rng.random(3) - 0.5) * 2 * spec['spread']
            c = nodes[i] + off
            out = c - crown_c; out[2] *= spec.get('flat', 1.0); out /= (np.linalg.norm(out) + 1e-9)
            nrm = out * spec.get('outward', 1.4) + (rng.random(3) - 0.5) * 1.1 + np.array([0, 0, 0.45])
            if dv is not None: nrm = nrm * 0.6 + dv * spec['shell']
            mix = min(1, max(0, 0.55 * clump + 0.45 * rng.random()))
            col = base + (hi - base) * mix
            col = col * (0.82 + 0.3 * rng.random())
            col = tuple(float(x) ** 2 for x in col)   # mockup albedo convention
            L = spec['leaf_L'] * (0.75 + 0.5 * rng.random())
            if spec.get('needles'):
                for q in range(spec['needles']):
                    d = (rng.random(3) - 0.5) * 2; d[2] = abs(d[2]) * 0.8 + 0.55
                    leaf_poly(mb, c, d, L, spec['leaf_W'], rng.random() * 6.28, leafm, col, 'needle')
            else:
                leaf_poly(mb, c, nrm, L, spec['leaf_W'] * (0.8 + 0.4 * rng.random()), rng.random() * 6.28, leafm, col)
            nleaf += 1
    ob = mb.build('tree%d' % seed, smooth=True, attr=True)
    print('tree', seed, 'nodes', len(nodes), 'leaves', nleaf, 'faces', len(mb.f))
    return ob


def oak_lobes(seed_shift):
    def f(rng):
        L = [(0, 0, 1.12, 0.52, 0.52, 0.4)]
        for k in range(7):
            a = rng.random() * 6.28 + seed_shift; rad = 0.36 + rng.random() * 0.14
            L.append((math.cos(a) * rad, math.sin(a) * rad, 0.92 + rng.random() * 0.5, 0.26 + rng.random() * 0.1, 0.26 + rng.random() * 0.1, 0.2 + rng.random() * 0.08))
        L.append((0.05, -0.05, 1.55, 0.32, 0.32, 0.2))
        return L
    return f


SPECS = {
    'oak': dict(shell=1.2, bark=(0.36, 0.30, 0.24), bark2=(0.27, 0.23, 0.19), trunk_h=0.46, lean=(0.06, -0.04), step=0.045, n_attr=1100, di=0.34, dk=0.085,
                lobes=oak_lobes(0.0), r_tip=0.0045, expo=2.3, r_mul=1.45, leaves_per=30, spread=0.085, leaf_depth=1, leaf_L=0.034, leaf_W=0.024,
                leaf_col=(0.25, 0.34, 0.12), leaf_col2=(0.48, 0.52, 0.19), transl=0.35, trop=(0, 0, 0.12), roots=5),
    'oak2': dict(shell=1.2, bark=(0.34, 0.29, 0.24), bark2=(0.25, 0.22, 0.18), trunk_h=0.48, lean=(-0.12, 0.08), step=0.045, n_attr=1000, di=0.36, dk=0.085,
                 lobes=lambda rng: [(-0.12, 0.08, 1.05, 0.45, 0.42, 0.32), (0.25, -0.18, 1.2, 0.34, 0.3, 0.3), (-0.05, 0.0, 1.5, 0.36, 0.34, 0.22),
                                    (-0.42, 0.25, 0.95, 0.2, 0.22, 0.18), (0.1, 0.35, 1.0, 0.24, 0.22, 0.2)],
                 r_tip=0.0045, expo=2.3, r_mul=1.4, leaves_per=30, spread=0.085, leaf_depth=1, leaf_L=0.034, leaf_W=0.024,
                 leaf_col=(0.27, 0.35, 0.13), leaf_col2=(0.50, 0.51, 0.20), transl=0.35, trop=(0, 0, 0.1), roots=4),
    'cypress': dict(bark=(0.34, 0.27, 0.21), trunk_h=0.2, step=0.035, n_attr=1100, di=0.18, dk=0.04,
                    lobes=lambda rng: [(0, 0, 1.2, 0.2, 0.2, 1.05)],
                    inside=lambda p: (p[0] ** 2 + p[1] ** 2) ** 0.5 < 0.19 * (math.sqrt(max(0.0, 1 - ((p[2] - 0.95) / 1.35) ** 2)) if p[2] < 0.95 else max(0.0, (2.3 - p[2]) / 1.35) ** 0.8),
                    r_tip=0.003, expo=2.6, leaves_per=16, spread=0.035, leaf_L=0.026, leaf_W=0.02, outward=1.0,
                    leaf_col=(0.16, 0.25, 0.12), leaf_col2=(0.29, 0.37, 0.16), transl=0.15, trop=(0, 0, 0.5), jitter=0.3, roots=3),
    'olive': dict(shell=1.2, bark=(0.42, 0.39, 0.33), bark2=(0.30, 0.28, 0.24), trunk_h=0.3, lean=(0.1, 0.06), step=0.04, n_attr=950, di=0.34, dk=0.06,
                  lobes=lambda rng: [(0.05, 0.0, 0.82, 0.58, 0.55, 0.3), (-0.3, 0.2, 0.7, 0.28, 0.26, 0.2), (0.3, -0.25, 0.9, 0.26, 0.26, 0.2)],
                  r_tip=0.005, expo=2.0, r_mul=0.95, leaves_per=18, spread=0.06, leaf_L=0.036, leaf_W=0.012, jitter=0.5,
                  leaf_col=(0.29, 0.35, 0.21), leaf_col2=(0.48, 0.52, 0.38), transl=0.2, trop=(0, 0, 0.05), roots=5, leaf_depth=2),
    'pine': dict(bark=(0.44, 0.31, 0.23), bark2=(0.32, 0.24, 0.19), trunk_h=1.28, lean=(0.16, -0.08), step=0.045, n_attr=800, di=0.35, dk=0.06,
                 lobes=lambda rng: [(0.12, -0.06, 1.6, 0.62, 0.62, 0.17), (0.12, -0.06, 1.7, 0.46, 0.46, 0.13)] +
                     [(0.12 + 0.42 * math.cos(a), -0.06 + 0.42 * math.sin(a), 1.66 + 0.04 * math.sin(3 * a), 0.2, 0.2, 0.1) for a in np.linspace(0, 6.28, 7)[:-1] + rng.random()],
                 inside=lambda p: p[2] > 1.48,
                 r_tip=0.004, expo=2.2, leaves_per=12, spread=0.05, leaf_L=0.05, leaf_W=0.007, needles=7, flat=2.0, leaf_depth=3,
                 leaf_col=(0.17, 0.27, 0.14), leaf_col2=(0.30, 0.38, 0.19), transl=0.15, trop=(0, 0, 0.18), roots=4),
}


def build_stump(seed=5):
    rng = np.random.default_rng(seed)
    bark = make_mat('stumpbark', (0.36, 0.30, 0.24), var=0.35, nscale=90, streak=True, dirt=0.3, dirt_h=0.1, col2=(0.27, 0.23, 0.19))
    wood = make_mat('stumpwood', (0.72, 0.58, 0.40), var=0.3, nscale=60, col2=(0.58, 0.44, 0.30))
    mb = MB()
    n = 12; R = 0.075
    prof = [(0.0, R * 1.35), (0.03, R * 1.1), (0.08, R * 1.0), (0.13, R * 0.98)]
    rs = []
    tops = []
    for k, (z, rr) in enumerate(prof):
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n; j = 1 + 0.08 * math.sin(3 * a + 1) + 0.04 * rng.random()
            zz = z + (0.02 * math.sin(a * 2 + 0.3) if k == len(prof) - 1 else 0)
            ring.append(mb.add_v((math.cos(a) * rr * j, math.sin(a) * rr * j, zz), {}))
        rs.append(ring)
    mb.rings(rs, bark, cap0=False, cap1=False)
    ctr = mb.add_v((0, 0, 0.125), {})
    top = rs[-1]
    for i in range(n): mb.face((ctr, top[i], top[(i + 1) % n]), wood)
    for k in range(5):
        a = k * 1.26 + rng.random() * 0.5
        mb.tube((math.cos(a) * R * 0.6, math.sin(a) * R * 0.6, 0.05), (math.cos(a) * R * 2.4, math.sin(a) * R * 2.4, -0.005), R * 0.38, R * 0.12, 5, bark, {}, cap0=False)
    for k in range(6):  # wood chips
        a = rng.random() * 6.28; d = R * (1.8 + rng.random() * 1.8)
        mb.box((math.cos(a) * d, math.sin(a) * d, 0.004), (0.03, 0.014, 0.008), wood, {}, rot=Matrix.Rotation(rng.random() * 3, 3, 'Z'))
    return mb.build('stump', smooth=True)


SPECS['bush'] = dict(shell=1.0, bark=(0.34, 0.27, 0.2), trunk_h=0.04, step=0.03, n_attr=700, di=0.22, dk=0.05,
                     lobes=lambda rng: [(0, 0, 0.2, 0.36, 0.34, 0.2), (0.18, -0.1, 0.18, 0.2, 0.2, 0.16), (-0.16, 0.12, 0.17, 0.2, 0.2, 0.15)],
                     inside=lambda p: p[2] > 0.03, r_tip=0.003, expo=2.2, r_mul=1.0, leaves_per=16, spread=0.05, leaf_depth=2,
                     leaf_L=0.04, leaf_W=0.03, leaf_col=(0.22, 0.33, 0.13), leaf_col2=(0.40, 0.48, 0.18), transl=0.25, trop=(0, 0, 0.3), roots=0)


def build_berry_bush(seed):
    """Low shrub with clusters of red berries on its sunny outside."""
    import math as _m
    rng = np.random.default_rng(seed + 100)
    ob = build_tree(SPECS['bush'], seed)
    berry = make_mat('berry%d' % seed, (0.70, 0.12, 0.16), var=0.25, nscale=200, rough=0.35, spec=0.5)
    mb = MB()
    lobes = SPECS['bush']['lobes'](rng)
    n = 0
    while n < 70:
        l = lobes[rng.integers(len(lobes))]
        th = rng.random() * 2 * _m.pi
        ph = rng.random() * 0.5 * _m.pi
        p = Vector((l[0] + l[3] * _m.cos(th) * _m.cos(ph), l[1] + l[4] * _m.sin(th) * _m.cos(ph), l[2] + l[5] * _m.sin(ph)))
        if p.z < 0.06:
            continue
        for k in range(3):
            q = p + Vector(((rng.random() - .5) * 0.04, (rng.random() - .5) * 0.04, (rng.random() - .5) * 0.03))
            mb.ellipsoid(q, (0.022, 0.022, 0.022), berry, {}, 6, 4)
        n += 1
    return ob, mb.build('berries%d' % seed)
