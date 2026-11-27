"""Cavalry: horse + rider on one armature (real metres, facing Blender -Y, scaled with humans.SCALE).

horseman: light cavalry on a bay horse, team cloak and saddle cloth, javelin and small round shield.
lancer: armoured rider (lamellar, domed helmet) on a grey with a team caparison, couched lance with a team pennant.
cataphract: rider and horse fully armoured: lamellar barding over neck, chest and flanks with a team hem band, a
metal chamfron, the rider with a mail face veil and a flanged mace; the showpiece.
"""
import math

from mathutils import Matrix, Vector

import core
import humans as H
from core import MB

SEAT_Z = 1.42
RIDER_OFF = Vector((0, 0.04, SEAT_Z - 0.92))

COATS = {'horseman': (0.50, 0.31, 0.18), 'lancer': (0.64, 0.62, 0.58), 'cataphract': (0.30, 0.22, 0.17)}
MANES = {'horseman': (0.16, 0.11, 0.08), 'lancer': (0.42, 0.40, 0.38), 'cataphract': (0.13, 0.10, 0.08)}


def bones_horse():
    b = [
        ('h_root', (0, 0, 0), (0, 0, 0.2), None),
        ('h_pelvis', (0, 0.55, 1.22), (0, 0.15, 1.24), 'h_root'),
        ('h_torso', (0, 0.15, 1.24), (0, -0.5, 1.28), 'h_pelvis'),
        ('h_neck', (0, -0.55, 1.34), (0, -0.85, 1.78), 'h_torso'),
        ('h_head', (0, -0.85, 1.78), (0, -1.2, 1.48), 'h_neck'),
        ('h_tail', (0, 0.78, 1.32), (0, 0.98, 0.82), 'h_pelvis'),
        ('h_saddle', (0, 0.04, 1.42), (0, 0.04, 1.55), 'h_torso'),
    ]
    for s, sx in (('L', 1), ('R', -1)):
        b += [
            ('fl_up.' + s, (0.15 * sx, -0.52, 1.02), (0.15 * sx, -0.55, 0.56), 'h_torso'),
            ('fl_lo.' + s, (0.15 * sx, -0.55, 0.56), (0.15 * sx, -0.55, 0.13), 'fl_up.' + s),
            ('fl_hoof.' + s, (0.15 * sx, -0.55, 0.13), (0.15 * sx, -0.6, 0.0), 'fl_lo.' + s),
            ('hl_up.' + s, (0.16 * sx, 0.58, 1.08), (0.16 * sx, 0.74, 0.52), 'h_pelvis'),
            ('hl_lo.' + s, (0.16 * sx, 0.74, 0.52), (0.16 * sx, 0.68, 0.13), 'hl_up.' + s),
            ('hl_hoof.' + s, (0.16 * sx, 0.68, 0.13), (0.16 * sx, 0.64, 0.0), 'hl_lo.' + s),
        ]
    return b


def bones_rider():
    out = []
    for n, h, t, p in H.bones_human():
        h = Vector(h) + RIDER_OFF
        t = Vector(t) + RIDER_OFF
        out.append((n, tuple(h), tuple(t), 'h_saddle' if p is None else p))
    return out


def body_w(p):
    y = p[1]
    k = H.smooth(-0.1, 0.35, y)
    return {'h_torso': 1 - k, 'h_pelvis': k}


def neck_w(p):
    k = H.smooth(1.4, 1.62, p[2]) * H.smooth(-0.5, -0.75, p[1])
    return {'h_neck': k, 'h_torso': 1 - k}


def build_horse(kind, M):
    mb = MB()
    coat = M('coat', COATS[kind], var=0.15, nscale=70, rough=0.6, dirt=0.35, dirt_h=0.5)
    mane = M('mane', MANES[kind], var=0.3, nscale=160)
    hoof = M('hoof', (0.18, 0.15, 0.12), var=0.2, nscale=100)
    leather = M('leather', var=0.25, nscale=70, rough=0.75)
    dark = M('eye', (0.06, 0.05, 0.04), var=0.0)
    team = M.team('cloth', var=0.25, nscale=70, dirt=0.25, dirt_h=1.2)
    trim = M('trim', var=0.25, nscale=150)
    armoured = kind == 'cataphract'
    # Barrel, chest and rump: rings along y.
    prof = [(0.82, 0.0, 0.0), (0.79, 0.17, 0.19), (0.64, 0.27, 0.3), (0.32, 0.3, 0.34), (-0.05, 0.29, 0.36), (-0.4, 0.28, 0.35), (-0.62, 0.24, 0.31), (-0.74, 0.13, 0.18), (-0.78, 0.0, 0.0)]
    rs = []
    for y, rx, rz in prof:
        ring = []
        for i in range(14):
            a = 2 * math.pi * i / 14
            z = 1.2 + rz * math.sin(a) + (0.04 if y > 0.4 else 0) * max(0, math.sin(a))
            ring.append(mb.add_v((rx * math.cos(a), y, z), body_w))
        rs.append(ring)
    mb.rings(rs, coat, cap0=False, cap1=False)
    # Neck (tapered, arched), head, ears, mane.
    def nk(t):
        return Vector((0, -0.5 - 0.38 * t, 1.3 + 0.5 * t - 0.06 * t * t))
    neck_rings = []
    for k in range(6):
        t = k / 5
        c = nk(t)
        rx = 0.15 - 0.055 * t
        ry = 0.24 - 0.11 * t
        ring = []
        for i in range(10):
            a = 2 * math.pi * i / 10
            ring.append(mb.add_v((c.x + rx * math.cos(a), c.y + ry * math.sin(a), c.z + 0.04 * math.sin(a)), neck_w))
        neck_rings.append(ring)
    mb.rings(neck_rings, coat, cap0=False, cap1=False)
    mb.tube((0, -0.86, 1.8), (0, -1.26, 1.5), 0.105, 0.07, 8, coat, 'h_head', sq=1.25, segs=2)
    mb.ellipsoid((0, -0.86, 1.79), (0.1, 0.12, 0.11), coat, 'h_head', 8, 6)
    mb.ellipsoid((0, -1.27, 1.48), (0.075, 0.08, 0.075), coat, 'h_head', 8, 5)
    for sx in (1, -1):
        mb.tube((0.06 * sx, -0.82, 1.88), (0.07 * sx, -0.8, 2.0), 0.03, 0.008, 5, coat, 'h_head')
        mb.ellipsoid((0.085 * sx, -0.98, 1.74), (0.02, 0.025, 0.02), dark, 'h_head', 5, 3)
    for k in range(7):
        t = k / 6
        c = nk(t)
        mb.box((0, c.y + 0.16 - 0.06 * t, c.z + 0.05), (0.05, 0.1, 0.14), mane, neck_w)
    # Bridle.
    mb.tube((0.075, -1.2, 1.56), (0.075, -0.9, 1.78), 0.014, 0.014, 4, leather, 'h_head')
    mb.tube((-0.075, -1.2, 1.56), (-0.075, -0.9, 1.78), 0.014, 0.014, 4, leather, 'h_head')
    # Legs.
    for s, sx in (('L', 1), ('R', -1)):
        x = 0.15 * sx
        mb.tube((x, -0.5, 1.12), (x, -0.55, 0.56), 0.1, 0.06, 7, coat, 'fl_up.' + s)
        mb.tube((x, -0.55, 0.58), (x, -0.55, 0.13), 0.048, 0.04, 6, coat, 'fl_lo.' + s)
        mb.tube((x, -0.56, 0.14), (x, -0.59, 0.0), 0.05, 0.062, 6, hoof, 'fl_hoof.' + s)
        x = 0.16 * sx
        mb.tube((x, 0.5, 1.15), (x, 0.74, 0.52), 0.14, 0.06, 7, coat, 'hl_up.' + s)
        mb.tube((x, 0.74, 0.54), (x, 0.68, 0.13), 0.05, 0.04, 6, coat, 'hl_lo.' + s)
        mb.tube((x, 0.68, 0.14), (x, 0.65, 0.0), 0.05, 0.062, 6, hoof, 'hl_hoof.' + s)
    # Tail.
    mb.tube((0, 0.78, 1.34), (0, 0.98, 0.78), 0.07, 0.04, 6, mane, 'h_tail', segs=3, bend=lambda t: Vector((0, 0.06 * math.sin(math.pi * t), 0)))
    # Saddle and saddle cloth (team colour).
    if not armoured:
        drop = 0.42 if kind == 'lancer' else 0.32
        long_ = 0.42 if kind == 'lancer' else 0.3
        for side in (1, -1):
            rows = []
            for j, z in enumerate((1.5, 1.3, 1.5 - drop)):
                r = 0.33 + 0.02 * j
                rows.append([mb.add_v((side * (r if j else 0.2), y, z), body_w) for y in (-long_, -0.1, 0.12, long_)])
            for a, b in zip(rows[:-1], rows[1:]):
                for i in range(3):
                    if side > 0:
                        mb.face((a[i], a[i + 1], b[i + 1], b[i]), team)
                    else:
                        mb.face((a[i + 1], a[i], b[i], b[i + 1]), team)
            # Hem.
            hr = [mb.add_v((side * 0.355, y, 1.5 - drop - 0.001), body_w) for y in (-long_, long_)]
            hr2 = [mb.add_v((side * 0.36, y, 1.5 - drop + 0.06), body_w) for y in (-long_, long_)]
            mb.face((hr[0], hr[1], hr2[1], hr2[0]) if side > 0 else (hr[1], hr[0], hr2[0], hr2[1]), trim)
        mb.lathe([(1.5, 0.2, 0.26), (1.56, 0.19, 0.25)], 10, leather, 'h_saddle', center=(0, 0.04), cap0=False)
    else:
        # Lamellar barding over the neck, chest and flanks, down to the knees, with a team hem band.
        lam = M('barding', (0.44, 0.40, 0.34), rough=0.55, metal=0.45, var=0.35, nscale=160)
        steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
        def scales(th, t, p):
            d = Vector((p.x, 0, p.z - 1.2))
            l = d.length or 1
            return p + Vector((d.x / l, 0, d.z / l)) * (0.012 * abs(math.sin(p.z * 70 + p.y * 9)))
        prof = [(0.86, 0.12, 0.2), (0.8, 0.33, 0.38), (0.55, 0.36, 0.42), (0.2, 0.37, 0.44), (-0.15, 0.36, 0.45), (-0.5, 0.34, 0.44), (-0.7, 0.3, 0.42), (-0.8, 0.2, 0.34)]
        rs = []
        nseg = 16
        for y, rx, rz in prof:
            ring = []
            for i in range(nseg + 1):
                a = math.pi * (-0.32 + 1.64 * i / nseg)   # from below one flank, over the back, to the other
                ring.append(mb.add_v(scales(0, 0, Vector((rx * math.cos(a), y, 1.22 + rz * math.sin(a)))), body_w))
            rs.append(ring)
        for a, b in zip(rs[:-1], rs[1:]):
            for i in range(nseg):
                mb.face((a[i], a[i + 1], b[i + 1], b[i]), lam)
        # Skirt hanging from the lower edge to the knees, team band at the hem.
        for edge in (0, nseg):
            lo = []
            hi = [rs[k][edge] for k in range(len(rs))]
            for k, (y, rx, rz) in enumerate(prof):
                a = math.pi * (-0.32 + 1.64 * edge / nseg)
                x = rx * math.cos(a) * 1.04
                lo.append((mb.add_v((x, y, 0.86), body_w), mb.add_v((x * 1.03, y, 0.6), body_w)))
            for k in range(len(prof) - 1):
                f = (hi[k], hi[k + 1], lo[k + 1][0], lo[k][0])
                mb.face(f if edge == 0 else tuple(reversed(f)), lam)
                g = (lo[k][0], lo[k + 1][0], lo[k + 1][1], lo[k][1])
                mb.face(g if edge == 0 else tuple(reversed(g)), team)
        # Neck armour.
        neck_l = []
        for k in range(5):
            t = k / 4
            c = nk(t * 0.9)
            rx = 0.17 - 0.05 * t
            ry = 0.26 - 0.1 * t
            neck_l.append([mb.add_v(scales(0, 0, Vector((c.x + rx * math.cos(a), c.y + ry * math.sin(a), c.z))), neck_w)
                           for a in [2 * math.pi * i / 10 for i in range(10)]])
        mb.rings(neck_l, lam, cap0=False, cap1=False)
        # Chamfron.
        mb.tube((0, -0.88, 1.84), (0, -1.24, 1.54), 0.115, 0.085, 8, steel, 'h_head', sq=1.2)
        mb.lathe([(1.5, 0.21, 0.27), (1.57, 0.2, 0.26)], 10, leather, 'h_saddle', center=(0, 0.04), cap0=False)
    return mb


def build_rider(kind, M):
    rk = {'horseman': 'rider', 'lancer': 'lancer_rider', 'cataphract': 'cataphract_rider'}[kind]
    mb = H.build_body(rk, M, mounted=True)
    mb.v = [tuple(Vector(v) + RIDER_OFF) for v in mb.v]
    return mb


def _shift(mb):
    mb.v = [tuple(Vector(v) + RIDER_OFF) for v in mb.v]
    return mb


def prop_small_shield(M):
    """Small round shield slung on the rider's left arm."""
    mb = MB()
    paint = M.team('shieldface', var=0.3, nscale=50, dirt=0.2, dirt_h=1.2)
    rim = M('white', var=0.25, nscale=90)
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    sc = Vector((0.29, -0.06, 1.1))
    nrm = Vector((1.0, -0.25, 0.0)).normalized()
    mb.disc(sc, nrm, 0.3, 0.045, paint, rim, 'fore_arm.L', n=18, dome=0.02, m_back=M('wood_dk', var=0.2, nscale=120))
    mb.ellipsoid(sc + nrm * 0.045, (0.06, 0.06, 0.06), steel, 'fore_arm.L', 8, 5)
    return _shift(mb)


def rider_props(kind):
    if kind == 'horseman':
        return {'javelin': lambda M: _shift(H.prop_javelin(M)), 'rshield': prop_small_shield}
    if kind == 'lancer':
        return {'lance': lambda M: _shift(H.prop_lance(M)), 'kite': lambda M: _shift(H.prop_kite_shield(M))}
    return {'mace': lambda M: _shift(H.prop_mace(M)), 'kite': lambda M: _shift(H.prop_kite_shield(M))}
