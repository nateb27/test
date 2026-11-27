"""Siege animations. Wheels: one full turn per walk cycle (so `cycle` is the wheel's circumference). The ram's crew
take four steps per wheel turn."""
import math

from anim import Anim, P, keyed
from siege import WHEEL_R

ARM_SIGN = 1   # bone-space sign that swings the trebuchet's long arm up from forward-horizontal


def wheels(p):
    a = -360.0 * p
    return {'w0': (0, a, 0), 'w1': (0, -a, 0), 'w2': (0, a, 0), 'w3': (0, -a, 0)}


def cycle_tiles():
    from humans import SCALE
    return 2 * math.pi * WHEEL_R * SCALE


def ram_walk(i):
    p = i / 8
    r = wheels(p)
    for k in range(4):
        s = math.sin(2 * math.pi * (2 * p + k * 0.25))
        r['c%d.L' % k] = (-28 * s, 0, 0)
        r['c%d.R' % k] = (28 * s, 0, 0)
    r['s_ram'] = (3 * math.sin(2 * math.pi * p), 0, 0)
    r['s_flag'] = (0, 0, 6 * math.sin(2 * math.pi * p))
    return r, {'s_body': (0, 0.015 * abs(math.sin(4 * math.pi * p)), 0)}


def ram_idle(i):
    r = {'s_ram': (2 * i, 0, 0), 's_flag': (0, 0, 8 * i)}
    for k in range(4):
        r['c%d.L' % k] = (-4, 0, 0)
        r['c%d.R' % k] = (4, 0, 0)
    return r, {}


def ram_attack():
    def p(sw, shake):
        r = {'s_ram': (sw, 0, 0), 's_roof': (0, 0, shake)}
        for k in range(4):
            r['c%d.L' % k] = (-14 + 0.4 * sw, 0, 0)
            r['c%d.R' % k] = (10 - 0.3 * sw, 0, 0)
        return P(r)
    keys = [(0.0, p(0, 0)), (0.35, p(26, 0)), (0.5, p(30, 0)), (0.62, p(-24, 1.5)), (0.72, p(-20, -1.0)), (1.0, p(0, 0))]
    return keyed(keys, 8, loop=True)


def ram_death():
    def p(roll, drop, roof, sink, legs):
        r = {'s_body': (0, 0, roll), 's_roof': (roof, 0, roll * 0.6), 's_ram': (30 * sink, 0, 0), 'w1': (40 * sink, 0, 0), 'w3': (-30 * sink, 0, 0)}
        for k in range(4):
            r['c%d.L' % k] = (legs, 0, 0)
            r['c%d.R' % k] = (-legs, 0, 0)
        return P(r, {'s_body': (0, -drop, 0), 's_roof': (0, -roof * 0.02, 0)})
    keys = [(0.0, p(0, 0, 0, 0, 0)), (0.17, p(3, 0.05, 4, 0.2, 30)), (0.33, p(8, 0.15, 10, 0.5, 60)), (0.5, p(14, 0.3, 24, 0.8, 80)),
            (0.67, p(18, 0.42, 34, 1.0, 85)), (0.83, p(19, 0.45, 36, 1.0, 85)), (1.0, p(19, 0.46, 37, 1.0, 85))]
    return keyed(keys, 7, loop=False)


def arm_pose(angle, flag=0.0):
    """Long arm at `angle` degrees above forward-horizontal; counterweight and sling hang plumb."""
    a = ARM_SIGN * angle
    return {'s_arm': (a, 0, 0), 's_cw': (-a, 0, 0), 's_sling': (-a, 0, 0), 's_flag': (0, 0, flag)}


REST = 92


def treb_idle(i):
    return arm_pose(REST + 2 * i, 6 * i), {}


def treb_walk(i):
    p = i / 8
    r = wheels(p)
    r.update(arm_pose(REST + 3 * math.sin(2 * math.pi * p), 8 * math.sin(2 * math.pi * p)))
    return r, {}


def treb_attack():
    """Cocked (long arm down at the back), release, swing over the top, throw, settle, haul back down."""
    angles = [212, 196, 150, 82, 40, 70, 150, 205]
    def f(i):
        a = angles[i]
        r = arm_pose(a, (-10, -6, 0, 8, 10, 6, 0, -6)[i])
        # The sling trails the arm: lagging while it swings, thrown forward at release.
        lag = (0, 20, 60, 120, 200, 140, 40, 10)[i]
        r['s_sling'] = (r['s_sling'][0] + ARM_SIGN * lag, 0, 0)
        return r, {'s_body': (0, 0, 0.03 * (1 if i in (3, 4) else 0))}
    return f


def treb_death():
    def p(arm, roll, drop):
        r = arm_pose(arm)
        r['s_body'] = (0, 0, roll)
        r['w0'] = (30 * drop, 0, 0)
        return P(r, {'s_body': (0, -drop * 0.4, 0)})
    keys = [(0.0, p(REST, 0, 0)), (0.2, p(REST + 15, 3, 0.1)), (0.4, p(REST + 50, 7, 0.4)), (0.6, p(REST + 95, 12, 0.8)),
            (0.8, p(REST + 112, 15, 1.0)), (1.0, p(REST + 116, 15, 1.0))]
    return keyed(keys, 7, loop=False)


def siege_anims(kind):
    if kind == 'batteringRam':
        return [Anim('idle', 2, ram_idle, frame_ms=700), Anim('walk', 8, ram_walk, cycle=cycle_tiles()),
                Anim('attack', 8, ram_attack(), frame_ms=120), Anim('death', 7, ram_death(), loop=False, frame_ms=130)]
    return [Anim('idle', 2, treb_idle, frame_ms=800), Anim('walk', 8, treb_walk, cycle=cycle_tiles()),
            Anim('attack', 8, treb_attack(), frame_ms=130), Anim('death', 7, treb_death(), loop=False, frame_ms=140)]
