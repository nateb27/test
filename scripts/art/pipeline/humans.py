"""Foot figures (villager, spearman, swordsman, archer, siphonarios) and the rider: procedural low-poly meshes in real
metres facing Blender -Y, skinned to one armature. Medieval Eastern Roman dress: knee-length tunics with woven hem
bands, hose and leg wraps, conical and domed helmets with mail aventails, lamellar klivania, padded kavadia.

Team colour: every surface made with `team=True` (tunic body, cloak, shield face, ...) writes the 'team' AOV and is
re-coloured per player at runtime; it is rendered in the shared reference cloth albedo so its shading maps onto the
16-step ramp.
"""
import math

from mathutils import Matrix, Vector

import core
from core import MB, make_mat

H_REAL = 1.72
UNIT_H = 0.6
SCALE = UNIT_H / H_REAL

C = dict(
    wool=(0.47, 0.38, 0.28), wool_dk=(0.36, 0.29, 0.22), hose=(0.37, 0.32, 0.26), leather=(0.34, 0.23, 0.15),
    leather_lt=(0.50, 0.36, 0.22), skin=(0.74, 0.54, 0.40), hair=(0.23, 0.16, 0.11), wood=(0.55, 0.42, 0.27),
    wood_dk=(0.40, 0.29, 0.18), iron=(0.48, 0.48, 0.50), steel=(0.66, 0.67, 0.69), bronze=(0.72, 0.52, 0.26),
    bark=(0.36, 0.28, 0.21), logend=(0.74, 0.60, 0.40), linen=(0.78, 0.72, 0.60), lamellar=(0.50, 0.48, 0.46),
    wraps=(0.56, 0.50, 0.40), trim=(0.72, 0.58, 0.30), white=(0.86, 0.84, 0.78), gold=(0.86, 0.68, 0.26),
    felt=(0.50, 0.40, 0.30), red=(0.62, 0.20, 0.14), straw=(0.80, 0.68, 0.40), stone=(0.66, 0.64, 0.60),
    stone_dk=(0.50, 0.49, 0.47), berry=(0.62, 0.10, 0.16), grain=(0.86, 0.72, 0.36), sack=(0.70, 0.60, 0.44),
    goldore=(0.95, 0.76, 0.22),
)
TEAM_ALBEDO = tuple(core.TEAM['clothAlbedo'])


def bones_human():
    b = [
        ('root', (0, 0, 0), (0, 0, 0.1), None),
        ('hips', (0, 0, 0.92), (0, 0, 1.05), 'root'),
        ('spine', (0, 0, 1.05), (0, 0, 1.28), 'hips'),
        ('chest', (0, 0, 1.28), (0, 0, 1.46), 'spine'),
        ('head', (0, 0, 1.49), (0, 0, 1.72), 'chest'),
    ]
    for s, sx in (('L', 1), ('R', -1)):
        b += [
            ('upper_arm.' + s, (0.19 * sx, 0.0, 1.41), (0.21 * sx, 0.01, 1.125), 'chest'),
            ('fore_arm.' + s, (0.21 * sx, 0.01, 1.125), (0.22 * sx, -0.02, 0.88), 'upper_arm.' + s),
            ('hand.' + s, (0.22 * sx, -0.02, 0.88), (0.22 * sx, -0.03, 0.79), 'fore_arm.' + s),
            ('thigh.' + s, (0.095 * sx, 0.0, 0.92), (0.10 * sx, 0.0, 0.50), 'hips'),
            ('shin.' + s, (0.10 * sx, 0.0, 0.50), (0.10 * sx, 0.02, 0.09), 'thigh.' + s),
            ('foot.' + s, (0.10 * sx, 0.02, 0.09), (0.10 * sx, -0.12, 0.03), 'shin.' + s),
        ]
    return b


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def torso_w(p):
    z = p[2]
    if z < 1.06:
        return {'hips': 1 - smooth(0.98, 1.06, z), 'spine': smooth(0.98, 1.06, z)}
    k = smooth(1.22, 1.34, z)
    return {'spine': 1 - k, 'chest': k}


def skirt_w(z0, z1):
    def f(p):
        t = min(1.0, max(0.0, (z0 - p[2]) / (z0 - z1)))
        b = 0.75 * t ** 1.3
        sL = smooth(-0.13, 0.13, p[0])
        return {'hips': 1 - b, 'thigh.L': b * sL, 'thigh.R': b * (1 - sL)}
    return f


class Mats:
    """Per-figure material cache (names must be unique per Blender file)."""

    def __init__(self, tag):
        self.tag = tag
        self.cache = {}

    def __call__(self, key, col=None, **kw):
        k = key
        if k not in self.cache:
            self.cache[k] = make_mat('%s_%s' % (self.tag, key), col if col is not None else C[key.split(':')[0]], **kw)
        return self.cache[k]

    def team(self, key='team', **kw):
        kw.setdefault('var', 0.2)
        kw.setdefault('nscale', 90)
        return self(key, TEAM_ALBEDO, team=True, **kw)


def ellipsoid_cut(mb, c, r, m, w, keep, nu=12, nv=9):
    """Ellipsoid whose faces are kept only where keep(face_centre) is true (hood with a face opening)."""
    c = Vector(c)
    rs = []
    for j in range(0, nv + 1):
        ph = math.pi * j / nv
        rs.append([c + Vector((math.sin(ph) * math.cos(2 * math.pi * i / nu) * r[0], math.sin(ph) * math.sin(2 * math.pi * i / nu) * r[1], math.cos(ph) * r[2])) for i in range(nu)])
    idx = {}

    def vid(j, i):
        if (j, i) not in idx:
            idx[(j, i)] = mb.add_v(rs[j][i], w)
        return idx[(j, i)]
    for j in range(nv):
        for i in range(nu):
            k = (i + 1) % nu
            q = [rs[j][i], rs[j][k], rs[j + 1][k], rs[j + 1][i]]
            if keep(sum(q, Vector()) / 4):
                mb.face([vid(j, i), vid(j + 1, i), vid(j + 1, k), vid(j, k)], m)


def lathe_cut(mb, prof, n, m, w, keep):
    rs = [[Vector((rx * math.cos(2 * math.pi * i / n), ry * math.sin(2 * math.pi * i / n), z)) for i in range(n)] for z, rx, ry in prof]
    idx = {}

    def vid(j, i):
        if (j, i) not in idx:
            idx[(j, i)] = mb.add_v(rs[j][i], w)
        return idx[(j, i)]
    for j in range(len(rs) - 1):
        for i in range(n):
            k = (i + 1) % n
            cc = (rs[j][i] + rs[j][k] + rs[j + 1][i] + rs[j + 1][k]) / 4
            if keep(cc):
                mb.face([vid(j, i), vid(j, k), vid(j + 1, k), vid(j + 1, i)], m)


def folds(th, t, p):
    a = 0.006 + 0.024 * t
    r = a * (math.sin(9 * th) + 0.6 * math.sin(5 * th + 1.3))
    d = Vector((p.x, p.y, 0))
    l = d.length or 1
    q = p + d / l * r
    q.z += 0.012 * t * math.sin(3 * th + 0.5)
    return q


def build_body(kind, M, mounted=False):
    """The figure for `kind` in villager | spearman | swordsman | archer | siphonarios | rider | lancer_rider |
    cataphract_rider. Returns an MB."""
    mb = MB()
    soldier = kind != 'villager'
    heavy = kind in ('swordsman', 'cataphract_rider', 'lancer_rider')
    team = M.team(dirt=0.3, dirt_h=0.8, col2=None)
    wool = M('wool', var=0.25, nscale=110, dirt=0.2, dirt_h=1.2)
    hose = M('hose', var=0.2, nscale=80, dirt=0.45, dirt_h=0.45)
    leather = M('leather', var=0.25, nscale=70, dirt=0.3, dirt_h=0.15, rough=0.75)
    skin = M('skin', var=0.08, nscale=40, rough=0.7)
    hair = M('hair', var=0.2, nscale=120)
    trim = M('trim', var=0.25, nscale=150, dirt=0.3, dirt_h=0.7)
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    wraps = M('wraps', var=0.25, nscale=150, dirt=0.4, dirt_h=0.3)
    lam = M('lamellar', rough=0.5, metal=0.55, var=0.3, nscale=160)
    linen = M('linen', var=0.22, nscale=120, dirt=0.25, dirt_h=1.0)
    # Feet and legs.
    for s, sx in (('L', 1), ('R', -1)):
        def shoe(p):
            return Vector((p.x, p.y, max(p.z, -0.035)))
        boot = heavy or kind in ('archer', 'rider')
        mb.ellipsoid((0.10 * sx, -0.035, 0.05), (0.05, 0.125, 0.058), leather, 'foot.' + s, 8, 6, disp=shoe)
        if boot:
            mb.tube((0.10 * sx, 0.02, 0.05), (0.10 * sx, 0.0, 0.44), 0.058, 0.068, 7, leather, 'shin.' + s, segs=2)
        else:
            mb.tube((0.10 * sx, 0.02, 0.07), (0.10 * sx, 0.0, 0.53), 0.05, 0.064, 7, wraps if soldier else hose, 'shin.' + s, segs=2,
                    bend=lambda t: Vector((0, 0.012 * math.sin(math.pi * t), 0)))
        mb.tube((0.10 * sx, 0.0, 0.50), (0.095 * sx, 0.0, 0.93), 0.06, 0.082, 7, hose, 'thigh.' + s)
    # Tunic skirt with folds (team colour), knee length; hem band.
    hem = 0.49 if kind == 'villager' else 0.55 if not mounted else 0.62
    flare = 1.0 if not mounted else 1.25
    prof = [(1.03, 0.16, 0.125), (0.92, 0.185 * flare, 0.145), (0.75, 0.215 * flare, 0.175), (0.6, 0.23 * flare, 0.19), (hem + 0.045, 0.24 * flare, 0.2)]
    if kind in ('swordsman', 'cataphract_rider', 'lancer_rider'):
        # Leather pteruges over a team skirt: strips hang from the waist.
        mb.lathe(prof, 18, team, skirt_w(1.03, hem), disp=folds, cap0=False, cap1=False)
        for i in range(14):
            a = 2 * math.pi * i / 14
            cx, cy = math.cos(a), math.sin(a)
            p0 = Vector((cx * 0.18, cy * 0.15, 0.99))
            p1 = Vector((cx * 0.235 * flare, cy * 0.2, 0.74))
            mb.tube(p0, p1, 0.03, 0.032, 4, leather, skirt_w(1.03, hem), sq=0.4)
    else:
        mb.lathe(prof, 18, team, skirt_w(1.03, hem), disp=folds, cap0=False, cap1=False)
    def folds2(th, t, p):
        return folds(th, 0.85 + 0.15 * t, p)
    mb.lathe([(hem + 0.045, 0.24 * flare, 0.2), (hem, 0.245 * flare, 0.205)], 18, trim, skirt_w(1.03, hem), disp=folds2, cap0=False, cap1=True)
    # Torso.
    def tf(th, t, p):
        q = p.copy()
        q.x += 0.004 * math.sin(7 * th) * (1 - t)
        return q
    torso = [(0.99, 0.16, 0.124), (1.06, 0.175, 0.134), (1.15, 0.176, 0.133), (1.27, 0.186, 0.138), (1.37, 0.194, 0.131), (1.43, 0.163, 0.108), (1.475, 0.07, 0.065)]
    mb.lathe(torso, 14, team, torso_w, disp=tf)
    if kind == 'spearman':
        # Padded kavadion (quilted linen coat) over the tunic, to mid-thigh.
        def qf(th, t, p):
            d = Vector((p.x, p.y, 0))
            l = d.length or 1
            return p + d / l * (0.006 * abs(math.sin(p.z * 70)))
        mb.lathe([(0.80, 0.215, 0.18), (0.95, 0.2, 0.16), (1.06, 0.19, 0.148), (1.2, 0.193, 0.15), (1.32, 0.2, 0.146), (1.42, 0.172, 0.122), (1.47, 0.09, 0.08)],
                 16, M.team('quilt', var=0.3, nscale=60, dirt=0.3, dirt_h=0.8), lambda p: torso_w(p) if p[2] > 1.0 else skirt_w(1.03, 0.6)(p), disp=qf, cap0=False)
    if heavy:
        # Lamellar klivanion: horizontal rows of plates.
        def lf(th, t, p):
            d = Vector((p.x, p.y, 0))
            l = d.length or 1
            return p + d / l * (0.007 * abs(math.sin(p.z * 150)))
        mb.lathe([(0.97, 0.18, 0.146), (1.05, 0.192, 0.152), (1.2, 0.194, 0.152), (1.32, 0.204, 0.15), (1.42, 0.176, 0.124), (1.47, 0.09, 0.08)], 16, lam,
                 torso_w, disp=lf, cap0=True)
        # Shoulder guards.
        for s, sx in (('L', 1), ('R', -1)):
            mb.ellipsoid((0.2 * sx, 0.0, 1.39), (0.085, 0.09, 0.06), lam, 'upper_arm.' + s, 8, 5)
    if kind == 'archer':
        # Quiver strap across the chest.
        mb.tube((0.17, -0.12, 1.4), (-0.17, -0.13, 1.02), 0.022, 0.022, 4, leather, torso_w, sq=0.4)
        mb.tube((0.17, 0.12, 1.4), (-0.17, 0.13, 1.02), 0.022, 0.022, 4, leather, torso_w, sq=0.4)
    # Belt.
    mb.lathe([(0.995, 0.168, 0.132), (1.04, 0.168, 0.132)] if not heavy else [(0.995, 0.2, 0.158), (1.04, 0.2, 0.158)], 14, leather, {'hips': 0.5, 'spine': 0.5}, cap0=False, cap1=False)
    if kind == 'villager':
        mb.box((0.13, -0.08, 0.96), (0.07, 0.04, 0.08), leather, 'hips', rot=Matrix.Rotation(0.5, 3, 'Z'))
    # Arms (team sleeves; forearms bare wool for villagers, bracers for soldiers).
    for s, sx in (('L', 1), ('R', -1)):
        mb.tube((0.19 * sx, 0.0, 1.43), (0.21 * sx, 0.01, 1.11), 0.064, 0.054, 7, team, 'upper_arm.' + s)
        fa = wool if kind == 'villager' else leather if kind in ('archer', 'siphonarios', 'swordsman') or heavy else team
        mb.tube((0.21 * sx, 0.01, 1.14), (0.22 * sx, -0.02, 0.90), 0.052, 0.042, 7, fa, 'fore_arm.' + s)
        mb.ellipsoid((0.22 * sx, -0.025, 0.85), (0.036, 0.044, 0.06), skin if not heavy else leather, 'hand.' + s, 7, 5)
    # Neck, head, nose, beard.
    mb.tube((0, 0.0, 1.44), (0, 0.005, 1.55), 0.052, 0.047, 7, skin, 'head')
    def headf(p):
        return Vector((p.x, p.y + (0.012 if p.z < 0 else 0) * (1 if p.y > 0 else 0), p.z))
    mb.ellipsoid((0, 0.0, 1.625), (0.083, 0.095, 0.11), skin, 'head', 10, 8, disp=headf)
    mb.box((0, -0.096, 1.615), (0.024, 0.032, 0.042), skin, 'head', rot=Matrix.Rotation(-0.25, 3, 'X'))
    mb.ellipsoid((0, -0.045, 1.555), (0.072, 0.057, 0.055), hair, 'head', 8, 5)
    mb.ellipsoid((0, -0.077, 1.585), (0.052, 0.026, 0.013), hair, 'head', 6, 3)
    if kind == 'villager':
        ellipsoid_cut(mb, (0, 0.012, 1.645), (0.105, 0.116, 0.128), wool, 'head',
                      keep=lambda c: not (c.y < -0.035 and abs(c.x) < 0.075 and 1.53 < c.z < 1.715))
        def cf(th, t, p):
            d = Vector((p.x, p.y, 0))
            l = d.length or 1
            return p + d / l * (0.012 * t * math.sin(8 * th + 0.4))
        mb.lathe([(1.545, 0.09, 0.09), (1.49, 0.155, 0.135), (1.40, 0.24, 0.195), (1.30, 0.255, 0.21)], 16, wool, 'chest', disp=cf, cap0=False, cap1=False)
        mb.tube((0, 0.10, 1.66), (0, 0.17, 1.48), 0.03, 0.012, 5, wool, 'head')
    elif kind == 'spearman':
        # Conical helmet with brim band, mail aventail.
        mb.lathe([(1.635, 0.1, 0.108), (1.668, 0.1, 0.108), (1.725, 0.084, 0.09), (1.79, 0.046, 0.049), (1.85, 0.008, 0.008)], 12, steel, 'head', cap0=False)
        lathe_cut(mb, [(1.645, 0.105, 0.114), (1.56, 0.117, 0.124), (1.48, 0.135, 0.135)], 14, iron, 'head', keep=lambda c: not (c.y < -0.05 and abs(c.x) < 0.07))
    elif kind in ('swordsman', 'cataphract_rider', 'lancer_rider'):
        # Domed helmet with nasal, mail aventail covering the neck; a horsehair crest for the swordsman.
        mb.lathe([(1.63, 0.103, 0.111), (1.69, 0.1, 0.108), (1.75, 0.083, 0.088), (1.8, 0.05, 0.052), (1.825, 0.0, 0.0)], 12, steel, 'head', cap0=False)
        mb.box((0, -0.11, 1.6), (0.022, 0.016, 0.07), steel, 'head')
        lathe_cut(mb, [(1.64, 0.108, 0.117), (1.55, 0.122, 0.13), (1.46, 0.15, 0.145)], 14, iron,
                  'head', keep=lambda c: not (c.y < -0.05 and abs(c.x) < 0.065 and c.z > 1.53))
        if kind == 'swordsman':
            red = M('red', var=0.25, nscale=120)
            mb.tube((0, -0.05, 1.83), (0, 0.10, 1.86), 0.03, 0.025, 6, red, 'head')
            mb.tube((0, 0.10, 1.86), (0, 0.17, 1.66), 0.028, 0.012, 6, red, 'head')
        if kind == 'cataphract_rider':
            # Mail face veil leaves only the eyes.
            mb.ellipsoid((0, -0.06, 1.575), (0.085, 0.06, 0.07), iron, 'head', 8, 5)
    elif kind == 'archer':
        # Felt cap with a turned-up brim.
        felt = M('felt', var=0.25, nscale=120)
        mb.lathe([(1.66, 0.098, 0.106), (1.69, 0.104, 0.112), (1.74, 0.09, 0.096), (1.79, 0.05, 0.05), (1.81, 0.0, 0.0)], 12, felt, 'head', cap0=False)
        mb.lathe([(1.655, 0.112, 0.12), (1.685, 0.112, 0.12)], 12, M('wool_dk', var=0.2, nscale=80), 'head', cap0=False, cap1=False)
    elif kind == 'siphonarios':
        # Leather cap with neck flap.
        lc = M('leather_lt', var=0.3, nscale=90, dirt=0.3, dirt_h=0.8)
        mb.lathe([(1.62, 0.102, 0.11), (1.7, 0.1, 0.108), (1.76, 0.07, 0.076), (1.79, 0.0, 0.0)], 12, lc, 'head', cap0=False)
        lathe_cut(mb, [(1.63, 0.106, 0.115), (1.53, 0.12, 0.125)], 12, lc, 'head', keep=lambda c: c.y > 0.0)
    elif kind == 'rider':
        # Light horseman: spangenhelm-ish cap and a team cloak.
        mb.lathe([(1.63, 0.1, 0.108), (1.7, 0.098, 0.105), (1.77, 0.07, 0.074), (1.82, 0.02, 0.02)], 12, steel, 'head', cap0=False)
    # Cloaks (team colour, big flat area that tells the owner from any side).
    if kind in ('swordsman', 'rider', 'lancer_rider'):
        def clw(p):
            k = smooth(0.8, 1.4, p[2])
            return {'chest': k, 'hips': 1 - k}
        lo = 0.72 if kind == 'swordsman' else 0.95
        cl = []
        n = 9
        for j, z in enumerate((1.47, 1.3, 1.1, 0.9, lo)):
            t = j / 4
            row = []
            for i in range(n):
                a = math.pi * (0.1 + 0.8 * i / (n - 1))
                rr = 0.19 + 0.09 * t
                ww = 1.0 + 0.04 * math.sin(i * 1.7 + j)
                row.append(mb.add_v((math.cos(a) * rr * 1.2 * ww, 0.07 + math.sin(a) * (0.12 + 0.06 * t), z), clw))
            cl.append(row)
        for a, b in zip(cl[:-1], cl[1:]):
            for i in range(n - 1):
                mb.face((a[i], b[i], b[i + 1], a[i + 1]), team)
                mb.face((a[i + 1], b[i + 1], b[i], a[i]), team)
    return mb


# ---------------------------------------------------------------- props (rigid, weighted to one bone)
G_R = (-0.222, -0.03, 0.835)   # right-hand grip
G_L = (0.222, -0.03, 0.835)


def prop_axe(M):
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    g = G_R
    mb.tube((g[0], g[1] + 0.08, g[2]), (g[0], g[1] - 0.78, g[2] + 0.02), 0.036, 0.032, 6, wood, 'hand.R')
    hx = g[1] - 0.72
    mb.box((g[0], hx, g[2] - 0.07), (0.06, 0.09, 0.2), iron, 'hand.R')
    mb.box((g[0], hx - 0.02, g[2] - 0.19), (0.05, 0.16, 0.1), iron, 'hand.R')
    return mb


def prop_pick(M):
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    g = G_R
    mb.tube((g[0], g[1] + 0.08, g[2]), (g[0], g[1] - 0.8, g[2] + 0.02), 0.036, 0.032, 6, wood, 'hand.R')
    hx = g[1] - 0.74
    mb.tube((g[0], hx, g[2] + 0.34), (g[0], hx, g[2] - 0.34), 0.042, 0.042, 5, iron, 'hand.R', bend=lambda t: Vector((0, -0.05 * math.sin(math.pi * t), 0)))
    mb.tube((g[0], hx, g[2] + 0.30), (g[0], hx - 0.04, g[2] + 0.36), 0.03, 0.005, 5, iron, 'hand.R')
    mb.tube((g[0], hx, g[2] - 0.30), (g[0], hx - 0.04, g[2] - 0.36), 0.03, 0.005, 5, iron, 'hand.R')
    return mb


def prop_hoe(M):
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    g = G_R
    mb.tube((g[0], g[1] + 0.2, g[2]), (g[0], g[1] - 1.05, g[2] + 0.02), 0.035, 0.032, 6, wood, 'hand.R')
    hx = g[1] - 1.03
    mb.box((g[0], hx - 0.02, g[2] - 0.13), (0.2, 0.05, 0.26), iron, 'hand.R', rot=Matrix.Rotation(0.3, 3, 'X'))
    return mb


def prop_hammer(M):
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    g = G_R
    mb.tube((g[0], g[1] + 0.06, g[2]), (g[0], g[1] - 0.55, g[2] + 0.01), 0.036, 0.032, 6, wood, 'hand.R')
    hx = g[1] - 0.5
    mb.box((g[0], hx, g[2]), (0.11, 0.1, 0.26), iron, 'hand.R')
    return mb


def prop_basket(M, bone='hand.L', full=True):
    """Forage basket held at the left hip."""
    mb = MB()
    straw = M('straw', var=0.3, nscale=160)
    c = Vector((0.26, -0.08, 0.86))
    mb.lathe([(c.z - 0.16, 0.09, 0.09), (c.z - 0.02, 0.15, 0.15), (c.z + 0.02, 0.155, 0.155)], 12, straw, bone, center=(c.x, c.y), cap1=False)
    if full:
        berry = M('berry', var=0.3, nscale=200, rough=0.4)
        for i in range(9):
            a = i * 2.4
            r = 0.04 + 0.07 * ((i * 37) % 10) / 10
            mb.ellipsoid((c.x + math.cos(a) * r, c.y + math.sin(a) * r, c.z + 0.01 + 0.02 * (i % 3)), (0.04, 0.04, 0.04), berry, bone, 6, 4)
    return mb


def prop_logs(M):
    """Three big logs on the right shoulder."""
    mb = MB()
    bark = M('bark', var=0.3, nscale=160, streak=True)
    end = M('logend', var=0.2, nscale=300)
    for dx, dz, r in ((-0.22, 1.50, 0.068), (-0.10, 1.53, 0.066), (-0.16, 1.63, 0.064)):
        R = Matrix.Rotation(math.radians(-30), 3, 'Z')
        c0 = Vector((-0.17, 0.0, 0.0))
        a = c0 + R @ Vector((dx + 0.17, 0.55, 0)) + Vector((0, 0, dz + 0.03))
        b = c0 + R @ Vector((dx + 0.17, -0.52, 0)) + Vector((0, 0, dz - 0.07))
        mb.tube(a, b, r, r * 0.95, 8, bark, 'chest', cap0=False, cap1=False)
        for p, rr in ((a, r), (b, r * 0.95)):
            d = (b - a).normalized()
            u = d.cross(Vector((0, 0, 1))).normalized()
            v = d.cross(u)
            ring = [mb.add_v(p + u * (rr * math.cos(t * 2 * math.pi / 8)) + v * (rr * math.sin(t * 2 * math.pi / 8)), 'chest') for t in range(8)]
            mb.face(ring if p is b else list(reversed(ring)), end)
    return mb


def prop_sack_food(M):
    """A big grain sack over the shoulder with a bundle of wheat sheaves on top (food)."""
    mb = MB()
    sack = M('sack', var=0.3, nscale=140, dirt=0.15, dirt_h=1.6)
    grain = M('grain', var=0.3, nscale=220)
    mb.ellipsoid((-0.14, 0.06, 1.55), (0.2, 0.17, 0.24), sack, 'chest', 10, 7)
    mb.tube((-0.14, 0.06, 1.77), (-0.14, 0.06, 1.84), 0.06, 0.035, 6, sack, 'chest')
    for i in range(7):
        a = i * 0.9
        mb.tube((-0.14 + 0.05 * math.cos(a), 0.06 + 0.05 * math.sin(a), 1.80), (-0.14 + 0.12 * math.cos(a), 0.06 + 0.12 * math.sin(a), 1.98), 0.022, 0.035, 4, grain, 'chest')
    return mb


def prop_gold(M):
    """An open basket of gold ore carried in front with both arms."""
    mb = MB()
    wood = M('wood_dk', var=0.25, nscale=160)
    ore = M('goldore', rough=0.35, metal=0.8, var=0.35, nscale=90, emit=0.15)
    stone = M('stone_dk', var=0.35, nscale=90)
    c = Vector((0.0, -0.3, 1.02))
    mb.lathe([(c.z - 0.12, 0.17, 0.13), (c.z + 0.07, 0.22, 0.17), (c.z + 0.1, 0.225, 0.175)], 12, wood, 'chest', center=(c.x, c.y), cap1=False)
    for i in range(11):
        a = i * 2.2
        r = 0.05 + 0.12 * ((i * 53) % 10) / 10
        m = ore if i % 4 != 3 else stone
        mb.ellipsoid((c.x + math.cos(a) * r, c.y + math.sin(a) * r * 0.75, c.z + 0.1 + 0.03 * (i % 3)), (0.06, 0.055, 0.05), m, 'chest', 6, 4,
                     rot=Matrix.Rotation(a, 3, 'Z'))
    return mb


def prop_stone(M):
    """A big squared stone block on the right shoulder."""
    mb = MB()
    stone = M('stone', var=0.35, nscale=70, col2=C['stone_dk'])
    mb.box((-0.16, 0.0, 1.6), (0.3, 0.42, 0.26), stone, 'chest', rot=Matrix.Rotation(0.25, 3, 'Y') @ Matrix.Rotation(0.2, 3, 'Z'))
    return mb


def prop_spear(M, length=2.55):
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    g = G_R
    # Along the hand bone's axis (down), so the grip pose decides where it points.
    mb.tube((g[0], g[1], g[2] + 0.75), (g[0], g[1], g[2] - length + 0.75), 0.034, 0.03, 6, wood, 'hand.R')
    tip = g[2] - length + 0.75
    mb.lathe([(tip + 0.01, 0.04, 0.04), (tip - 0.08, 0.06, 0.03), (tip - 0.26, 0.0, 0.0)], 4, steel, 'hand.R', center=(g[0], g[1]))
    return mb


def prop_round_shield(M):
    mb = MB()
    paint = M.team('shieldface', var=0.3, nscale=50, dirt=0.2, dirt_h=1.2)
    rim = M('white', var=0.25, nscale=90)
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    sc = Vector((0.27, -0.2, 1.06))
    nrm = Vector((0.55, -1.0, 0.0)).normalized()
    mb.disc(sc, nrm, 0.40, 0.05, paint, rim, 'fore_arm.L', n=22, dome=0.02, m_back=M('wood_dk', var=0.2, nscale=120))
    mb.ellipsoid(sc + nrm * 0.05, (0.075, 0.075, 0.075), steel, 'fore_arm.L', 8, 5)
    return mb


def prop_kite_shield(M):
    """Tall kite shield on the left forearm: team face, light rim, a white cross."""
    mb = MB()
    paint = M.team('kiteface', var=0.3, nscale=50, dirt=0.2, dirt_h=1.2)
    rim = M('white', var=0.25, nscale=90)
    back = M('wood_dk', var=0.2, nscale=120)
    c = Vector((0.27, -0.2, 1.02))
    nrm = Vector((0.5, -1.0, 0.0)).normalized()
    u = Vector((0, 0, 1))
    v = nrm.cross(u).normalized()
    pts = []
    n = 16
    for i in range(n):
        t = i / n
        a = 2 * math.pi * t
        # Rounded top, pointed bottom.
        x = math.sin(a) * 0.24 * (1 - 0.65 * max(0.0, -math.cos(a)) ** 1.5)
        y = math.cos(a) * 0.27 + (0.0 if math.cos(a) > 0 else math.cos(a) * 0.30)
        pts.append((x, y))
    def ring(off, sc_, bulge=0.0):
        return [mb.add_v(c + nrm * (off + bulge * (1 - (x / 0.24) ** 2)) + v * (x * sc_) + u * (y * sc_ + 0.0), 'fore_arm.L') for x, y in pts]
    front = ring(0.035, 0.93, 0.03)
    rimf = ring(0.02, 1.0)
    bk = ring(-0.02, 1.0)
    ctr = mb.add_v(c + nrm * 0.07 + u * 0.02, 'fore_arm.L')
    for i in range(n):
        j = (i + 1) % n
        mb.face((ctr, front[i], front[j]), paint)
        mb.face((front[i], rimf[i], rimf[j], front[j]), rim)
        mb.face((rimf[i], bk[i], bk[j], rimf[j]), rim)
    mb.face(list(reversed(bk)), back)
    # Cross.
    mb.box(c + nrm * 0.068 + u * 0.03, (0.012, 0.06, 0.40), rim, 'fore_arm.L', rot=nrm.to_track_quat('X', 'Z').to_matrix())
    mb.box(c + nrm * 0.068 + u * 0.10, (0.012, 0.30, 0.06), rim, 'fore_arm.L', rot=nrm.to_track_quat('X', 'Z').to_matrix())
    return mb


def prop_sword(M):
    mb = MB()
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    leather = M('leather', var=0.25, nscale=70, rough=0.75)
    gold = M('gold', rough=0.35, metal=0.8, var=0.2, nscale=150)
    g = G_R
    mb.tube((g[0], g[1], g[2] + 0.07), (g[0], g[1], g[2] - 0.06), 0.022, 0.022, 5, leather, 'hand.R')
    mb.box((g[0], g[1], g[2] - 0.07), (0.05, 0.2, 0.03), gold, 'hand.R')
    mb.box((g[0], g[1], g[2] - 0.47), (0.026, 0.075, 0.78), steel, 'hand.R')
    mb.ellipsoid((g[0], g[1], g[2] + 0.085), (0.03, 0.03, 0.03), gold, 'hand.R', 6, 4)
    return mb


def prop_scabbard(M):
    mb = MB()
    leather = M('leather', var=0.25, nscale=70, rough=0.75)
    mb.tube((0.2, 0.02, 1.0), (0.24, 0.3, 0.42), 0.035, 0.03, 5, leather, 'hips', sq=0.5)
    return mb


def prop_bow(M, drawn=False):
    """Composite recurve bow in the left hand. The drawn variant's string meets at the right hand (its middle is
    weighted to hand.R), so drawing is just a pose of the right arm."""
    mb = MB()
    horn = M('horn', (0.70, 0.52, 0.30), var=0.2, nscale=200)
    string = M('white', var=0.1, nscale=200)
    g = G_L
    pts = []
    n = 10
    for i in range(n + 1):
        t = i / n * 2 - 1
        z = t * 0.72
        y = -0.12 * (1 - t * t) + 0.08 * max(0.0, abs(t) - 0.75) / 0.25
        pts.append(Vector((g[0], g[1] + y, g[2] + z)))
    for a, b in zip(pts[:-1], pts[1:]):
        mb.tube(a, b, 0.042, 0.042, 5, horn, "hand.L")
    top, bot = pts[-1], pts[0]
    if drawn:
        mid = Vector(G_R)
        near = lambda p: {'hand.R': 1.0} if (Vector(p) - mid).length < 0.05 else {'hand.L': 1.0}
        mb.tube(top, mid, 0.013, 0.013, 3, string, near)
        mb.tube(mid, bot, 0.013, 0.013, 3, string, near)
    else:
        mid = Vector((g[0], g[1] + 0.03, g[2]))
        mb.tube(top, mid, 0.013, 0.013, 3, string, 'hand.L')
        mb.tube(mid, bot, 0.013, 0.013, 3, string, 'hand.L')
    return mb


def prop_arrow(M):
    """Arrow on the drawn string: from the right hand (nock) to the bow hand."""
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    a = Vector(G_R)
    b = Vector(G_L)
    near = lambda p: {'hand.R': 1.0} if (Vector(p) - a).length < 0.05 else {'hand.L': 1.0}
    mb.tube(a, b, 0.022, 0.022, 4, wood, near)
    return mb


def prop_quiver(M):
    mb = MB()
    leather = M('leather_lt', var=0.3, nscale=90, dirt=0.3, dirt_h=0.8)
    white = M('white', var=0.2, nscale=90)
    mb.tube((-0.14, 0.17, 0.88), (-0.2, 0.2, 1.42), 0.07, 0.08, 7, leather, torso_w)
    for i in range(4):
        a = i * 1.6
        mb.tube((-0.2 + 0.03 * math.cos(a), 0.2 + 0.03 * math.sin(a), 1.4), (-0.21 + 0.035 * math.cos(a), 0.21 + 0.035 * math.sin(a), 1.55), 0.022, 0.03, 3, white, torso_w)
    return mb


def prop_siphon(M):
    """Cheirosiphon: a bronze tank on the back with a pump handle, a leather hose to a long bronze nozzle held in
    both hands at the right hip."""
    mb = MB()
    bronze = M('bronze', rough=0.35, metal=0.85, var=0.3, nscale=120)
    leather = M('leather', var=0.25, nscale=70, rough=0.75)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    # Tank on the back (chest bone).
    mb.lathe([(0.98, 0.0, 0.0), (1.0, 0.17, 0.15), (1.58, 0.17, 0.15), (1.66, 0.12, 0.1), (1.74, 0.05, 0.05), (1.78, 0.05, 0.05)], 14, bronze, "chest", center=(0.0, 0.27))
    mb.lathe([(1.1, 0.175, 0.155), (1.14, 0.175, 0.155)], 14, iron, 'chest', center=(0.0, 0.27), cap0=False, cap1=False)
    mb.lathe([(1.42, 0.175, 0.155), (1.46, 0.175, 0.155)], 14, iron, 'chest', center=(0.0, 0.27), cap0=False, cap1=False)
    # Straps.
    for sx in (1, -1):
        mb.tube((0.12 * sx, 0.2, 1.45), (0.14 * sx, -0.12, 1.36), 0.022, 0.022, 4, leather, 'chest', sq=0.4)
    # Nozzle: in the right hand, pointing forward along the hand (the hand bone points down: build along -z of
    # the hand, i.e. aligned with the spear convention, then the grip pose levels it).
    g = G_R
    mb.tube((g[0], g[1], g[2] + 0.3), (g[0], g[1], g[2] - 0.5), 0.068, 0.06, 8, bronze, 'hand.R')
    mb.lathe([(g[2] - 0.5, 0.05, 0.05), (g[2] - 0.58, 0.085, 0.085), (g[2] - 0.62, 0.085, 0.085)], 8, bronze, 'hand.R', center=(g[0], g[1]), cap0=False)
    mb.ellipsoid((g[0], g[1], g[2] + 0.31), (0.065, 0.065, 0.065), bronze, 'hand.R', 7, 5)
    # Hose from the tank to the nozzle's back end (follows the chest).
    mb.tube((0.0, 0.14, 1.06), (-0.2, 0.05, 0.98), 0.03, 0.03, 5, leather, {'chest': 0.6, 'hips': 0.4}, segs=2, bend=lambda t: Vector((0, 0, -0.08 * math.sin(math.pi * t))))
    return mb


def prop_fire(M, strength):
    """Liquid-fire jet from the nozzle (child of the right hand), `strength` 0..1 sets its length."""
    mb = MB()
    if strength <= 0:
        return mb
    hot = make_mat('%s_fire_hot_%d' % (M.tag, int(strength * 100)), (1.0, 0.80, 0.40), emit=3.0, var=0.3, nscale=30)
    warm = make_mat('%s_fire_warm_%d' % (M.tag, int(strength * 100)), (1.0, 0.45, 0.12), emit=2.2, var=0.4, nscale=24)
    smoke = make_mat('%s_smoke_%d' % (M.tag, int(strength * 100)), (0.24, 0.21, 0.19), var=0.3, nscale=20)
    g = G_R
    z0 = g[2] - 0.62
    L = 0.4 + 1.3 * strength
    segs = 6
    for i in range(segs):
        t0, t1 = i / segs, (i + 1) / segs
        r0 = 0.05 + 0.22 * t0 * strength
        r1 = 0.05 + 0.22 * t1 * strength
        wob = lambda t: Vector((0.03 * math.sin(t * 9 + strength * 5), 0.03 * math.cos(t * 7 + strength * 3), 0))
        a = Vector((g[0], g[1], z0 - L * t0)) + wob(t0)
        b = Vector((g[0], g[1], z0 - L * t1)) + wob(t1)
        mb.tube(a, b, r0, r1, 7, warm if i > 1 else hot, 'hand.R')
        mb.tube(a, b, r0 * 0.55, r1 * 0.55, 6, hot, 'hand.R')
    tip = Vector((g[0], g[1], z0 - L))
    mb.ellipsoid(tip + Vector((0, 0, -0.06)), (0.22 * strength + 0.06, 0.22 * strength + 0.06, 0.16 * strength + 0.06), warm, 'hand.R', 8, 5)
    if strength > 0.5:
        mb.ellipsoid(tip + Vector((0.0, 0.15, 0.12)), (0.14, 0.14, 0.12), smoke, 'hand.R', 7, 5)
    return mb


def prop_javelin(M):
    return prop_spear(M, length=1.7)


def prop_lance(M):
    """Long lance with a team pennant near the head."""
    mb = MB()
    wood = M('wood', var=0.2, nscale=200, streak=True)
    steel = M('steel', rough=0.42, metal=0.75, var=0.25, nscale=200)
    pen = M.team('pennant', var=0.2, nscale=60)
    g = G_R
    L = 3.6
    mb.tube((g[0], g[1], g[2] + 0.9), (g[0], g[1], g[2] - L + 0.9), 0.038, 0.032, 6, wood, 'hand.R')
    tip = g[2] - L + 0.9
    mb.lathe([(tip + 0.01, 0.045, 0.045), (tip - 0.1, 0.065, 0.03), (tip - 0.32, 0.0, 0.0)], 4, steel, 'hand.R', center=(g[0], g[1]))
    # Pennant: a two-tailed flag hanging from the shaft below the head.
    z = tip + 0.55
    for k, (dz, dl) in enumerate(((0.0, 0.42), (0.13, 0.36))):
        a = mb.add_v((g[0], g[1], z + dz), 'hand.R')
        b = mb.add_v((g[0], g[1], z + dz + 0.12), 'hand.R')
        c = mb.add_v((g[0] + 0.03, g[1] + dl, z + dz + 0.1), 'hand.R')
        d = mb.add_v((g[0] + 0.03, g[1] + dl, z + dz + 0.02), 'hand.R')
        mb.face((a, b, c, d), pen)
        mb.face((d, c, b, a), pen)
    return mb


def prop_mace(M):
    mb = MB()
    wood = M('wood_dk', var=0.2, nscale=200)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    g = G_R
    mb.tube((g[0], g[1], g[2] + 0.08), (g[0], g[1], g[2] - 0.78), 0.036, 0.036, 6, wood, 'hand.R')
    for i in range(6):
        a = i * math.pi / 3
        mb.box((g[0] + 0.07 * math.cos(a), g[1] + 0.07 * math.sin(a), g[2] - 0.76), (0.07, 0.07, 0.22), iron, 'hand.R', rot=Matrix.Rotation(a, 3, 'Z'))
    return mb
