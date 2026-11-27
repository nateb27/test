"""Siege engines (real metres, facing Blender -Y, scaled with humans.SCALE), rigid parts on one armature.

batteringRam: a covered ram on four spoked wheels: timber chassis and posts, a gabled roof of overlapping hides
with team-coloured hide panels and a team pennant on the ridge, an iron-capped log hung from the ridge on ropes, the
crew implied by legs walking under the skirt.
trebuchet: a counterweight trebuchet on a wheeled base: two ground beams, braced A-frame uprights, a long throwing
arm with an iron-banded counterweight box and a sling, team pennant on the upright.
"""
import math

from mathutils import Matrix, Vector

import core
import humans as H
from core import MB

WHEEL_R = 0.45


def wheel(mb, c, r, wood, iron, bone, spokes=8):
    """Spoked wheel in the yz plane (axle along x) centred at c."""
    c = Vector(c)
    n = 16
    th = 0.12
    rim_o, rim_i = r, r * 0.82
    def ring(rr, dx):
        return [mb.add_v(c + Vector((dx, rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n))), bone) for i in range(n)]
    oa, ob = ring(rim_o, -th / 2), ring(rim_o, th / 2)
    ia, ib = ring(rim_i, -th / 2), ring(rim_i, th / 2)
    for i in range(n):
        j = (i + 1) % n
        mb.face((oa[i], oa[j], ob[j], ob[i]), iron)
        mb.face((ia[j], ia[i], ib[i], ib[j]), wood)
        mb.face((oa[j], oa[i], ia[i], ia[j]), wood)
        mb.face((ob[i], ob[j], ib[j], ib[i]), wood)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        mb.tube(c, c + Vector((0, math.cos(a) * rim_i, math.sin(a) * rim_i)), 0.04, 0.035, 5, wood, bone)
    mb.tube(c + Vector((-th, 0, 0)), c + Vector((th, 0, 0)), 0.1, 0.1, 8, wood, bone)


def beam(mb, a, b, s, m, bone, rot=0.0):
    """Square timber from a to b, s thick."""
    a, b = Vector(a), Vector(b)
    d = b - a
    q = d.to_track_quat('Z', 'Y').to_matrix() @ Matrix.Rotation(rot, 3, 'Z')
    mb.box((a + b) / 2, (s, s, d.length), m, bone, rot=q)


def bones_ram():
    b = [('s_root', (0, 0, 0), (0, 0, 0.3), None), ('s_body', (0, 0, 0.5), (0, 0, 1.0), 's_root'),
         ('s_roof', (0, 0, 1.0), (0, 0, 1.5), 's_body'), ('s_ram', (0, 0.2, 2.15), (0, 0.2, 1.4), 's_body'),
         ('s_flag', (0, 0.8, 2.45), (0, 0.8, 2.8), 's_roof')]
    for k, (x, y) in enumerate(((1.05, -1.4), (-1.05, -1.4), (1.05, 1.4), (-1.05, 1.4))):
        b.append(('w%d' % k, (x, y, WHEEL_R), (x + 0.3 * (1 if x > 0 else -1), y, WHEEL_R), 's_body'))
    for k, (x, y) in enumerate(((0.45, -0.9), (-0.45, -0.3), (0.45, 0.3), (-0.45, 0.9))):
        b.append(('c%d.L' % k, (x + 0.1, y, 0.9), (x + 0.1, y, 0.45), 's_body'))
        b.append(('c%d.R' % k, (x - 0.1, y, 0.9), (x - 0.1, y, 0.45), 's_body'))
    return b


def build_ram(M):
    mb = MB()
    wood = M('wood', var=0.25, nscale=120, streak=True, dirt=0.3, dirt_h=0.6)
    wood_dk = M('wood_dk', var=0.25, nscale=120, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    hide = M('hide', (0.52, 0.38, 0.24), var=0.3, nscale=40, col2=(0.42, 0.30, 0.2), dirt=0.3, dirt_h=1.2)
    team = M.team('hidepaint', var=0.3, nscale=40, dirt=0.25, dirt_h=1.0)
    rope = M('straw', var=0.2, nscale=200)
    hose = M('hose', var=0.2, nscale=80)
    leather = M('leather', var=0.25, nscale=70)
    # Chassis.
    for x in (0.95, -0.95):
        beam(mb, (x, -2.0, 0.62), (x, 2.0, 0.62), 0.2, wood, 's_body')
    for y in (-1.9, -1.4, 0.0, 1.4, 1.9):
        beam(mb, (-1.0, y, 0.62), (1.0, y, 0.62), 0.16, wood, 's_body')
    for k, (x, y) in enumerate(((1.05, -1.4), (-1.05, -1.4), (1.05, 1.4), (-1.05, 1.4))):
        wheel(mb, (x * 1.12, y, WHEEL_R), WHEEL_R, wood_dk, iron, 'w%d' % k)
    # Posts and ridge.
    for y in (-1.9, -0.6, 0.6, 1.9):
        for x in (0.92, -0.92):
            beam(mb, (x, y, 0.62), (x * 0.25, y, 2.3), 0.14, wood, 's_body')
    beam(mb, (0, -2.1, 2.36), (0, 2.1, 2.36), 0.16, wood, 's_roof')
    # Roof: overlapping hide courses, every third one painted in the team colour.
    courses = 5
    for side in (1, -1):
        for k in range(courses):
            t0, t1 = k / courses, (k + 1.15) / courses
            z0, z1 = 2.38 - 1.55 * t0, 2.38 - 1.55 * t1
            x0, x1 = side * (0.12 + 0.95 * t0), side * (0.12 + 0.95 * t1)
            m = team if k in (1, 3) else hide
            off = 0.015 * k
            a = mb.add_v((x0, -2.2, z0 + off), 's_roof')
            b = mb.add_v((x0, 2.2, z0 + off), 's_roof')
            c = mb.add_v((x1 * 1.04, 2.2, z1 + off), 's_roof')
            d = mb.add_v((x1 * 1.04, -2.2, z1 + off), 's_roof')
            mb.face((a, b, c, d) if side > 0 else (d, c, b, a), m)
            mb.face((d, c, b, a) if side > 0 else (a, b, c, d), m)
    # Gable ends half open (front shows the ram head).
    for y in (2.2,):
        a = mb.add_v((0, y, 2.4), 's_roof')
        b = mb.add_v((1.0, y, 0.85), 's_roof')
        c = mb.add_v((-1.0, y, 0.85), 's_roof')
        mb.face((a, b, c), hide)
        mb.face((c, b, a), hide)
    # Ram log on ropes.
    mb.tube((0, 2.5, 1.35), (0, -2.55, 1.35), 0.17, 0.16, 10, wood_dk, 's_ram')
    mb.tube((0, -2.55, 1.35), (0, -2.85, 1.35), 0.2, 0.16, 10, iron, 's_ram')
    mb.tube((0, -2.85, 1.35), (0, -2.95, 1.35), 0.16, 0.05, 10, iron, 's_ram')
    for y in (-1.2, 1.2):
        mb.tube((0, y + 0.2, 2.3), (0, y, 1.5), 0.03, 0.03, 4, rope, 's_ram')
        mb.tube((0, y, 1.35), (0, y + 0.08, 1.35), 0.19, 0.19, 10, iron, 's_ram')
    # Pennant on the ridge (team colour).
    beam(mb, (0, 0.8, 2.4), (0, 0.8, 3.2), 0.05, wood, 's_flag')
    a = mb.add_v((0, 0.8, 3.18), 's_flag')
    b = mb.add_v((0, 0.8, 2.86), 's_flag')
    c = mb.add_v((0.02, 1.5, 2.98), 's_flag')
    mb.face((a, b, c), team)
    mb.face((c, b, a), team)
    # Crew legs (seen under the skirt).
    for k in range(4):
        for s in ('L', 'R'):
            bn = 'c%d.%s' % (k, s)
            x, y = [(0.45, -0.9), (-0.45, -0.3), (0.45, 0.3), (-0.45, 0.9)][k]
            xx = x + (0.1 if s == 'L' else -0.1)
            mb.tube((xx, y, 0.95), (xx, y, 0.08), 0.06, 0.05, 6, hose, bn)
            mb.ellipsoid((xx, y - 0.05, 0.05), (0.05, 0.11, 0.05), leather, bn, 6, 4)
    return mb


def bones_treb():
    return [('s_root', (0, 0, 0), (0, 0, 0.3), None), ('s_body', (0, 0, 0.5), (0, 0, 1.0), 's_root'),
            ('s_arm', (0, 0.0, 3.1), (0, -1.0, 3.1), 's_body'), ('s_cw', (0, 1.25, 3.1), (0, 1.25, 2.5), 's_arm'),
            ('s_sling', (0, -3.6, 3.1), (0, -3.6, 2.4), 's_arm'), ('s_flag', (0.75, 0.0, 3.4), (0.75, 0, 3.9), 's_body')] + \
        [('w%d' % k, (x, y, WHEEL_R), (x + 0.3 * (1 if x > 0 else -1), y, WHEEL_R), 's_body')
         for k, (x, y) in enumerate(((1.0, -1.7), (-1.0, -1.7), (1.0, 1.7), (-1.0, 1.7)))]


def build_treb(M):
    mb = MB()
    wood = M('wood', var=0.25, nscale=120, streak=True, dirt=0.3, dirt_h=0.6)
    wood_dk = M('wood_dk', var=0.25, nscale=120, streak=True)
    iron = M('iron', rough=0.5, metal=0.6, var=0.3, nscale=220)
    stone = M('stone', var=0.35, nscale=60, col2=H.C['stone_dk'])
    team = M.team('flag', var=0.2, nscale=60)
    rope = M('straw', var=0.2, nscale=200)
    leather = M('leather', var=0.25, nscale=70)
    # Base: two long beams with cross beams, on wheels.
    for x in (0.85, -0.85):
        beam(mb, (x, -2.4, 0.62), (x, 2.4, 0.62), 0.22, wood, 's_body')
    for y in (-2.2, -0.9, 0.9, 2.2):
        beam(mb, (-0.95, y, 0.66), (0.95, y, 0.66), 0.18, wood, 's_body')
    for k, (x, y) in enumerate(((1.0, -1.7), (-1.0, -1.7), (1.0, 1.7), (-1.0, 1.7))):
        wheel(mb, (x * 1.08, y, WHEEL_R), WHEEL_R, wood_dk, iron, 'w%d' % k)
    # A-frame uprights with braces, axle on top.
    for x in (0.62, -0.62):
        beam(mb, (x, -1.3, 0.7), (x, 0.0, 3.15), 0.18, wood, 's_body')
        beam(mb, (x, 1.3, 0.7), (x, 0.0, 3.15), 0.18, wood, 's_body')
        beam(mb, (x, -0.7, 1.8), (x, 0.7, 1.8), 0.12, wood, 's_body')
        beam(mb, (x * 1.3, -2.0, 0.7), (x, -0.55, 2.2), 0.11, wood, 's_body')
    mb.tube((0.75, 0, 3.12), (-0.75, 0, 3.12), 0.09, 0.09, 8, iron, 's_body')
    # Throwing arm (long end towards -Y, i.e. forward when it swings over the top).
    mb.tube((0, 1.35, 3.12), (0, -3.6, 3.12), 0.15, 0.08, 8, wood_dk, 's_arm')
    for y in (0.6, -0.6, -1.6):
        mb.tube((0, y, 3.12), (0, y - 0.1, 3.12), 0.17, 0.15, 8, iron, 's_arm')
    # Counterweight box hanging from the short end.
    beam(mb, (0.3, 1.25, 3.1), (0.3, 1.25, 2.4), 0.07, iron, 's_cw')
    beam(mb, (-0.3, 1.25, 3.1), (-0.3, 1.25, 2.4), 0.07, iron, 's_cw')
    mb.box((0, 1.25, 2.05), (0.8, 0.8, 0.75), wood, 's_cw')
    for k in range(6):
        mb.ellipsoid((0.2 * ((k % 3) - 1), 1.25 + 0.2 * (k // 3) - 0.1, 2.48), (0.16, 0.16, 0.12), stone, 's_cw', 6, 4)
    mb.box((0, 1.25, 1.75), (0.84, 0.84, 0.08), iron, 's_cw')
    mb.box((0, 1.25, 2.35), (0.84, 0.84, 0.08), iron, 's_cw')
    # Sling: two ropes and a pouch with a stone.
    mb.tube((0.05, -3.6, 3.12), (0.05, -3.6, 2.15), 0.03, 0.03, 4, rope, 's_sling')
    mb.tube((-0.05, -3.6, 3.12), (-0.05, -3.6, 2.15), 0.03, 0.03, 4, rope, 's_sling')
    mb.ellipsoid((0, -3.6, 2.08), (0.14, 0.12, 0.1), leather, 's_sling', 7, 5)
    mb.ellipsoid((0, -3.6, 2.14), (0.11, 0.11, 0.11), stone, 's_sling', 7, 5)
    # Pennant.
    beam(mb, (0.75, 0, 3.15), (0.75, 0, 4.0), 0.05, wood, 's_flag')
    a = mb.add_v((0.75, 0, 3.98), 's_flag')
    b = mb.add_v((0.75, 0, 3.62), 's_flag')
    c = mb.add_v((0.77, 0.75, 3.76), 's_flag')
    mb.face((a, b, c), team)
    mb.face((c, b, a), team)
    # A team-painted shield panel on each side of the base.
    for x in (0.97, -0.97):
        mb.disc((x, 0.0, 0.95), (1 if x > 0 else -1, 0, 0), 0.32, 0.05, team, M('white', var=0.25, nscale=90), 's_body', n=18)
    return mb
