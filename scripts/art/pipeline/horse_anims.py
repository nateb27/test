"""Cavalry animations: a collected canter for moving (stride matched to the unit's speed through `cycle`), idle,
attacks per rider type and a death where the horse folds onto its side and the rider is thrown."""
import math

from anim import Anim, P, keyed

A_UP = 30     # upper leg swing
SUSP = 1.35   # canter suspension: ground covered per cycle relative to the legs' reach


def seat():
    """Rider sitting: thighs forward and out, shins down along the flanks."""
    return {'thigh.L': (-72, 0, -16), 'thigh.R': (-72, 0, 16), 'shin.L': (78, 0, 0), 'shin.R': (78, 0, 0),
            'foot.L': (-6, 0, 0), 'foot.R': (-6, 0, 0)}


def rider_hold(kind, s=0.0):
    r = seat()
    r.update({'spine': (4 + 3 * s, 0, 0), 'head': (-4, 0, 0)})
    if kind == 'horseman':
        r.update({'upper_arm.R': (-20, 0, 14), 'fore_arm.R': (-70, 0, 0), 'hand.R': (-90, 0, 0),
                  'upper_arm.L': (-30, 0, -10), 'fore_arm.L': (-60, 0, 0)})
    elif kind == 'lancer':
        r.update({'upper_arm.R': (-16, 0, 14), 'fore_arm.R': (-72, 0, 0), 'hand.R': (-92, 0, 0),
                  'upper_arm.L': (-30, 0, -8), 'fore_arm.L': (-62, 0, 0)})
    else:
        r.update({'upper_arm.R': (-30, 0, 16), 'fore_arm.R': (-60, 0, 0), 'hand.R': (-60, 0, 0),
                  'upper_arm.L': (-30, 0, -8), 'fore_arm.L': (-62, 0, 0)})
    return r


def legs_canter(p):
    """Three-beat canter, left lead: hind R, then hind L + fore R together, then fore L, then suspension."""
    def leg(ph):
        # ph 0..1 within the leg's own cycle: stance (0..0.55) sweeps back, swing lifts and reaches forward.
        if ph < 0.55:
            u = ph / 0.55
            return A_UP * (-1 + 2 * u), 0.0
        u = (ph - 0.55) / 0.45
        return A_UP * (1 - 2 * u), math.sin(math.pi * u)
    out = {}
    for name, off, lo_sign in (('hl_up.R', 0.0, -1), ('hl_up.L', 0.12, -1), ('fl_up.R', 0.12, 1), ('fl_up.L', 0.24, 1)):
        sw, lift = leg((p + 1 - off) % 1.0)
        base = name.split('_')[0]
        side = name[-1]
        # Upper: positive = swept back (-X swings forward).
        out[name] = (sw, 0, 0)
        out['%s_lo.%s' % (base, side)] = (lo_sign * (8 + 70 * lift), 0, 0)
        out['%s_hoof.%s' % (base, side)] = (lo_sign * 20 * lift, 0, 0)
    return out


def canter_body(p):
    s = math.sin(2 * math.pi * p)
    c = math.cos(2 * math.pi * p)
    r = {'h_pelvis': (3 * s, 0, 0), 'h_neck': (-6 * c, 0, 0), 'h_head': (6 * c, 0, 0), 'h_tail': (-20 - 8 * s, 0, 0)}
    return r, s, 0.05 * c


def cycle_tiles():
    from humans import SCALE
    reach = 2 * 1.05 * math.sin(math.radians(A_UP))
    return reach * 2 * SUSP * SCALE


def pose_walk(kind, i):
    p = i / 8
    r, s, bob = canter_body(p)
    r.update(legs_canter(p))
    r.update(rider_hold(kind, s))
    return r, {'h_root': (0, bob, 0), 'root': (0, -bob * 0.5, 0)}


def pose_idle(kind, i):
    r = {'h_neck': (6 + 4 * i, 0, 0), 'h_head': (8 - 3 * i, 0, 0), 'h_tail': (-16, 0, 6 - 12 * i),
         'fl_up.L': (-3, 0, 0), 'hl_up.R': (4, 0, 0), 'hl_lo.R': (-6, 0, 0)}
    r.update(rider_hold(kind))
    return r, {}


def attack(kind):
    stand = {'fl_up.L': (-4, 0, 0), 'hl_up.R': (3, 0, 0), 'h_tail': (-18, 0, 0), 'h_neck': (4, 0, 0)}
    if kind == 'horseman':
        def p(ua, fa, h, sp, tw):
            r = dict(stand)
            r.update(rider_hold(kind))
            r.update({'upper_arm.R': (ua, 0, 20), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0), 'spine': (sp, tw, 0)})
            return P(r)
        keys = [(0.0, p(-20, -70, -90, 4, 0)), (0.3, p(-170, -60, -10, -8, 20)), (0.45, p(-180, -50, -10, -10, 24)),
                (0.6, p(-110, -10, -60, 18, -14)), (0.75, p(-60, -20, -70, 12, -8)), (1.0, p(-20, -70, -90, 4, 0))]
        return keyed(keys, 8, loop=True), (lambda i: {'rshield', 'javelin'} if i < 5 or i == 7 else {'rshield'})
    if kind == 'lancer':
        def p(ua, fa, h, sp, lunge):
            r = dict(stand)
            r.update(rider_hold(kind))
            r.update({'upper_arm.R': (ua, 0, 10), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0), 'spine': (sp, 0, 0),
                      'h_pelvis': (-4 * lunge, 0, 0), 'fl_up.L': (-20 * lunge, 0, 0), 'fl_lo.L': (40 * lunge, 0, 0), 'h_neck': (-10 * lunge, 0, 0)})
            return P(r, {'h_root': (0, 0.06 * lunge, -0.1 * lunge)})
        keys = [(0.0, p(-16, -72, -92, 4, 0)), (0.25, p(-30, -60, -60, 0, 0)), (0.42, p(-20, -50, -30, -4, 0.1)),
                (0.58, p(-40, -10, -40, 20, 1.0)), (0.72, p(-36, -14, -40, 18, 0.8)), (1.0, p(-16, -72, -92, 4, 0))]
        return keyed(keys, 8, loop=True), {'lance', 'kite'}
    def p(ua, fa, h, sp, tw):
        r = dict(stand)
        r.update(rider_hold(kind))
        r.update({'upper_arm.R': (ua, 0, 24), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0), 'spine': (sp, tw, 0)})
        return P(r)
    keys = [(0.0, p(-30, -60, -60, 4, 0)), (0.3, p(-175, -70, -30, -8, 14)), (0.45, p(-185, -60, -30, -10, 18)),
            (0.6, p(-60, -10, -60, 22, -16)), (0.75, p(-45, -20, -60, 16, -10)), (1.0, p(-30, -60, -60, 4, 0))]
    return keyed(keys, 8, loop=True), {'mace', 'kite'}


def death(kind):
    def p(roll, lift, fold, rider_t, arms):
        r = rider_hold(kind)
        r.update({'h_root': (0, 0, roll), 'fl_up.L': (-40 * fold, 0, 0), 'fl_lo.L': (100 * fold, 0, 0), 'fl_up.R': (-30 * fold, 0, 0), 'fl_lo.R': (90 * fold, 0, 0),
                  'hl_up.L': (-30 * fold, 0, 0), 'hl_lo.L': (-60 * fold, 0, 0), 'hl_up.R': (-20 * fold, 0, 0), 'hl_lo.R': (-50 * fold, 0, 0),
                  'h_neck': (30 * fold, 0, 0), 'h_head': (-20 * fold, 0, 0), 'h_tail': (-10, 0, 0),
                  'root': (-rider_t, 0, rider_t * 0.4), 'upper_arm.L': (arms, 0, -40), 'upper_arm.R': (arms, 0, 40),
                  'thigh.L': (-72 + 40 * min(1, rider_t / 60), 0, -16), 'thigh.R': (-72 + 40 * min(1, rider_t / 60), 0, 16)})
        return P(r, {'h_root': (0, lift, 0), 'root': (0, 0, 0)})
    keys = [(0.0, p(0, 0, 0, 0, -30)), (0.17, p(4, -0.06, 0.3, 10, -80)), (0.33, p(16, -0.2, 0.8, 25, -120)), (0.5, p(45, -0.1, 1.0, 45, -150)),
            (0.67, p(75, 0.12, 1.0, 70, -160)), (0.83, p(84, 0.22, 1.0, 80, -165)), (1.0, p(86, 0.24, 1.0, 82, -170))]
    return keyed(keys, 7, loop=False)


def cavalry_anims(kind):
    from horses import rider_props
    props = set(rider_props(kind).keys())
    fa, pa = attack(kind)
    dropped = props - {'javelin', 'lance', 'mace'}
    return [
        Anim('idle', 2, lambda i: pose_idle(kind, i), props, frame_ms=700),
        Anim('walk', 8, lambda i: pose_walk(kind, i), props, cycle=cycle_tiles()),
        Anim('attack', 8, fa, pa, frame_ms=100),
        Anim('death', 7, death(kind), lambda i: props if i < 3 else dropped, loop=False, frame_ms=120),
    ]
