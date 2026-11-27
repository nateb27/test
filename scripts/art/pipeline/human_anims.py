"""Poses and animations of the foot figures. Bone rotation conventions (degrees, measured on the rig):
thigh / upper_arm: -X swings forward; shin: +X bends the knee; fore_arm: -X bends the elbow; spine/chest: +X leans
forward; upper_arm.L: -Z lifts the arm out sideways, upper_arm.R: +Z; hand: X tilts the held item, and X rotations
along the arm add up (a prop built pointing down from the grip points forward at a total of -90, up at -180).
Root location is in bone space: y is up, z is backward... (bone-local z = world -Y = forward)."""
import math

from anim import Anim, P, keyed, merge

STRIDE_A = 30      # thigh swing, degrees
KNEE = 46


def legs_walk(p, A=STRIDE_A, knee=KNEE):
    s, c = math.sin(2 * math.pi * p), math.cos(2 * math.pi * p)
    tl, tr = -A * s, A * s
    kl = 6 + knee * max(0.0, c) ** 1.5
    kr = 6 + knee * max(0.0, -c) ** 1.5
    r = {'thigh.L': (tl, 0, -1), 'thigh.R': (tr, 0, 1), 'shin.L': (kl, 0, 0), 'shin.R': (kr, 0, 0),
         'foot.L': (-(tl + kl) * 0.8, 0, 0), 'foot.R': (-(tr + kr) * 0.8, 0, 0)}
    bob = 0.04 * (1 - abs(s)) - 0.025
    return r, s, bob


def stride_m(A=STRIDE_A):
    """Ground covered per full cycle (two steps), metres: each step moves the body by the distance between the feet
    at full swing (leg length 0.84 m)."""
    return 2 * 2 * 0.84 * math.sin(math.radians(A)) * 0.92


# ------------------------------------------------------------------ per-unit holds (arms, while idle / walking)
def hold(kind, s=0.0):
    """Arm pose for `kind`, s = walk swing phase (-1..1)."""
    if kind == 'villager':
        return {'upper_arm.L': (22 * s, 0, -5), 'upper_arm.R': (-22 * s, 0, 5),
                'fore_arm.L': (-16 - 16 * max(0, -s), 0, 0), 'fore_arm.R': (-16 - 16 * max(0, s), 0, 0)}
    if kind == 'spearman':
        return {'upper_arm.R': (-14 - 4 * s, 0, 12), 'fore_arm.R': (-76, 0, 0), 'hand.R': (-90, 0, 0),
                'upper_arm.L': (-24 + 3 * s, 0, -6), 'fore_arm.L': (-62, 0, 0)}
    if kind == 'swordsman':
        return {'upper_arm.R': (-10 - 10 * s, 0, 14), 'fore_arm.R': (-40, 0, 0), 'hand.R': (-20, 0, 0),
                'upper_arm.L': (-26 + 3 * s, 0, -8), 'fore_arm.L': (-64, 0, 0)}
    if kind == 'archer':
        return {'upper_arm.L': (-16 + 8 * s, 0, -10), 'fore_arm.L': (-50, 0, 0), 'hand.L': (55, 0, 0),
                'upper_arm.R': (-20 * s, 0, 6), 'fore_arm.R': (-18 - 14 * max(0, s), 0, 0)}
    if kind == 'siphonarios':
        return {'upper_arm.R': (-22 - 3 * s, 0, 14), 'fore_arm.R': (-58, 0, 0), 'hand.R': (-10, 0, 0),
                'upper_arm.L': (-48 - 3 * s, 0, -24), 'fore_arm.L': (-58, 0, 30)}
    return {}


def pose_idle(kind, i):
    br = 1.5 * i   # breathing: frame 1 lifts the chest a touch
    r = {'thigh.L': (-2, 0, -3), 'thigh.R': (2, 0, 3), 'shin.L': (3, 0, 0), 'shin.R': (3, 0, 0),
         'spine': (2 - br, 0, 0), 'chest': (-br * 0.5, 0, 0), 'head': (3, 0, 0)}
    r.update({'upper_arm.L': (4, 0, -6), 'upper_arm.R': (4, 0, 6), 'fore_arm.L': (-14 - 3 * i, 0, 0), 'fore_arm.R': (-14 - 3 * i, 0, 0)})
    if kind != 'villager':
        r.update(hold(kind, 0.0))
    return r, {'root': (0, 0.004 * i, 0)}


def pose_walk(kind, p, carry=None):
    r, s, bob = legs_walk(p)
    r.update({'spine': (6, 5 * s, 0), 'chest': (0, -3 * s, 0), 'head': (-3, -2 * s, 0)})
    r.update(hold(kind, s))
    if carry == 'wood' or carry == 'stone':
        r.update({'upper_arm.R': (-160, 0, 18), 'fore_arm.R': (-60, 0, 0), 'hand.R': (0, 0, 0), 'spine': (9, 3 * s, 0), 'chest': (0, -2 * s, -5), 'head': (-5, 0, 5)})
    elif carry == 'food':
        r.update({'upper_arm.R': (-165, 0, 12), 'fore_arm.R': (-55, 0, 0), 'spine': (10, 3 * s, 0), 'head': (-6, 0, 4)})
    elif carry == 'gold':
        r.update({'upper_arm.L': (-38, 0, -18), 'fore_arm.L': (-62, 0, 20), 'upper_arm.R': (-38, 0, 18), 'fore_arm.R': (-62, 0, -20),
                  'spine': (-4, 3 * s, 0), 'chest': (-4, 0, 0), 'head': (4, 0, 0)})
    return r, {'root': (0, bob, 0)}


# ------------------------------------------------------------------ villager work
def stance(wide=1.0):
    return {'thigh.L': (-14 * wide, 0, -7), 'thigh.R': (12 * wide, 0, 7), 'shin.L': (14, 0, 0), 'shin.R': (10, 0, 0),
            'foot.L': (2, 0, 0), 'foot.R': (-18, 0, 0)}


def swing_keys(up, down, spine_up=-8, spine_down=22, twist=-8, both=True):
    """Overhead two-handed swing (axe / pick / hoe): wind-up, strike, recover."""
    def arms(a, fa, h, sp):
        r = dict(stance())
        r.update({'upper_arm.R': (a, 0, -14), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0),
                  'spine': (sp, twist, 0), 'chest': (sp * 0.4, -6, 0), 'head': (-sp * 0.5, 6, 0)})
        if both:
            r.update({'upper_arm.L': (a + 8, 0, 22), 'fore_arm.L': (fa, 0, 0), 'hand.L': (h, 0, 0)})
        else:
            r.update({'upper_arm.L': (-30, 0, -10), 'fore_arm.L': (-50, 0, 0)})
        return r
    return [
        (0.0, P(arms(*up, spine_up))),
        (0.35, P(arms(up[0] - 22, up[1] - 8, up[2] - 10, spine_up - 4))),
        (0.55, P(arms(*down, spine_down))),
        (0.68, P(arms(down[0] - 6, down[1] - 4, down[2] - 4, spine_down - 2))),
        (1.0, P(arms(*up, spine_up))),
    ]


def villager_work(kind):
    if kind == 'chop':
        return keyed(swing_keys((-140, -50, 0), (-62, -8, 45)), 8, loop=True), {'axe'}
    if kind == 'mine':
        return keyed(swing_keys((-160, -40, -10), (-70, -10, 30), spine_down=26), 8, loop=True), {'pick'}
    if kind == 'farm':
        return keyed(swing_keys((-120, -40, 10), (-45, -10, 85), spine_up=0, spine_down=28), 8, loop=True), {'hoe'}
    if kind == 'build':
        # One-handed hammering at a low beam: kneeling on one knee.
        def b(a, fa, sp):
            return P({'thigh.L': (-80, 0, -10), 'shin.L': (85, 0, 0), 'foot.L': (-5, 0, 0), 'thigh.R': (-10, 0, 8), 'shin.R': (100, 0, 0), 'foot.R': (-20, 0, 0),
                      'upper_arm.R': (a, 0, 10), 'fore_arm.R': (fa, 0, 0), 'hand.R': (10, 0, 0),
                      'upper_arm.L': (-50, 0, -12), 'fore_arm.L': (-30, 0, 0), 'spine': (sp, 0, 0), 'head': (8, 0, 0)},
                     {'root': (0, -0.36, 0)})
        return keyed([(0.0, b(-120, -70, 16)), (0.35, b(-135, -80, 12)), (0.55, b(-50, -20, 26)), (0.7, b(-55, -25, 25)), (1.0, b(-120, -70, 16))], 8, loop=True), {'hammer'}
    if kind == 'forage':
        # Bend, pick from the bush with the right hand, drop into the basket on the left arm.
        def f(a, fa, sp, kn):
            return P({'thigh.L': (-30 - kn, 0, -6), 'thigh.R': (-10 - kn, 0, 6), 'shin.L': (30 + kn * 1.6, 0, 0), 'shin.R': (14 + kn * 1.6, 0, 0),
                      'foot.L': (-kn * 0.6, 0, 0), 'foot.R': (-kn * 0.6, 0, 0),
                      'upper_arm.R': (a, 0, 10), 'fore_arm.R': (fa, 0, 0),
                      'upper_arm.L': (-30, 0, -20), 'fore_arm.L': (-70, 0, 0), 'spine': (sp, 0, 0), 'chest': (sp * 0.3, 0, 0), 'head': (-sp * 0.3, 0, 0)},
                     {'root': (0, -0.05 - kn * 0.003, 0)})
        return keyed([(0.0, f(-40, -30, 30, 10)), (0.3, f(-75, -10, 40, 16)), (0.5, f(-70, -20, 38, 16)), (0.75, f(-20, -80, 18, 6)), (1.0, f(-40, -30, 30, 10))], 8, loop=True), {'basket'}
    raise KeyError(kind)


# ------------------------------------------------------------------ attacks
def spear_attack():
    def p(ua, fa, h, sp, lunge, ual=-30, fal=-62):
        r = {'thigh.L': (-20 - lunge * 18, 0, -6), 'thigh.R': (14 + lunge * 10, 0, 6), 'shin.L': (16 + lunge * 10, 0, 0), 'shin.R': (6, 0, 0),
             'foot.L': (4, 0, 0), 'foot.R': (-18, 0, 0),
             'upper_arm.R': (ua, 0, 16), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0),
             'upper_arm.L': (ual, 0, -6), 'fore_arm.L': (fal, 0, 0), 'spine': (sp, -10 * lunge, 0), 'chest': (sp * 0.3, -6 * lunge, 0)}
        return P(r, {'root': (0, -0.03 - 0.02 * lunge, -0.05 * lunge)})
    keys = [(0.0, p(-30, -60, -10, 4, 0.0)), (0.25, p(-10, -95, 15, -6, -0.2)), (0.42, p(-30, -80, 0, -4, -0.1)),
            (0.58, p(-95, -5, -12, 20, 1.0, -40, -40)), (0.72, p(-90, -10, -12, 18, 0.9, -40, -40)), (1.0, p(-30, -60, -10, 4, 0.0))]
    return keyed(keys, 8, loop=True)


def sword_attack():
    def p(ua, fa, h, sp, tw, lunge):
        r = dict(stance(0.8 + lunge * 0.4))
        r.update({'upper_arm.R': (ua, 0, 20), 'fore_arm.R': (fa, 0, 0), 'hand.R': (h, 0, 0),
                  'upper_arm.L': (-40, 0, -14), 'fore_arm.L': (-66, 0, 0), 'spine': (sp, tw, 0), 'chest': (sp * 0.3, tw * 0.6, 0)})
        return P(r, {'root': (0, -0.03, -0.04 * lunge)})
    keys = [(0.0, p(-10, -40, -20, 2, 0, 0)), (0.3, p(-175, -70, -30, -8, 12, 0.1)), (0.42, p(-185, -60, -40, -10, 16, 0.2)),
            (0.58, p(-70, -10, -60, 22, -18, 1.0)), (0.72, p(-50, -20, -50, 18, -14, 0.8)), (1.0, p(-10, -40, -20, 2, 0, 0))]
    return keyed(keys, 8, loop=True)


def bow_attack():
    """Reach to the quiver, nock, draw to the cheek, loose, recover. Props per frame: arrow while nocked/drawn,
    the drawn bow (string to the right hand) while drawing."""
    def p(ual, ur, fr, hr, sp, tw):
        r = dict(stance(0.7))
        r.update({'upper_arm.L': (ual, 0, -8), 'fore_arm.L': (-6 if ual < -60 else -30, 0, 0), 'hand.L': (-ual - 6 if ual < -60 else 40, 0, 0),
                  'upper_arm.R': ur, 'fore_arm.R': (fr, 0, 0), 'hand.R': (hr, 0, 0), 'spine': (sp, tw, 0), 'chest': (0, tw * 0.5, 0), 'head': (0, -tw * 0.8, 0)})
        return P(r)
    keys = [
        (0.0, p(-12, (-20, 0, 6), -20, 0, 2, 0)),           # rest
        (0.14, p(-40, (-150, 0, 40), -110, 0, 0, -6)),      # reach over the shoulder to the quiver
        (0.3, p(-88, (-80, 0, 10), -90, 0, 2, -20)),        # nock: bow arm up
        (0.5, p(-90, (-80, 0, 40), -130, 0, 2, -30)),       # full draw
        (0.6, p(-90, (-80, 0, 40), -132, 0, 2, -30)),       # hold
        (0.68, p(-90, (-60, 0, 60), -40, 0, 4, -30)),       # loose: hand flies back
        (1.0, p(-12, (-20, 0, 6), -20, 0, 2, 0)),
    ]
    f = keyed(keys, 8, loop=True)

    def props(i):
        if 2 <= i <= 4:
            return {'bowdrawn', 'arrow', 'quiver'}
        return {'bow', 'quiver'}
    return f, props


def siphon_attack():
    def p(ua, fa, sp, kn):
        r = dict(stance(1.0))
        r.update({'upper_arm.R': (ua, 0, 14), 'fore_arm.R': (fa, 0, 0), 'hand.R': (-10, 0, 0),
                  'upper_arm.L': (ua - 26, 0, -24), 'fore_arm.L': (fa, 0, 30), 'spine': (sp, 0, 0)})
        r['thigh.L'] = (-18 - kn, 0, -7)
        r['shin.L'] = (16 + kn, 0, 0)
        return P(r, {'root': (0, -0.03 - kn * 0.002, 0)})
    keys = [(0.0, p(-22, -58, 4, 0)), (0.25, p(-16, -70, -2, 0)), (0.4, p(-30, -55, 12, 6)), (0.85, p(-32, -52, 14, 8)), (1.0, p(-22, -58, 4, 0))]
    f = keyed(keys, 8, loop=True)
    return f


FIRE = [0, 0, 0.35, 0.75, 1.0, 1.0, 0.7, 0.25]


# ------------------------------------------------------------------ death
def death(kind, forward=False):
    """Hit, buckle, fall (backwards or forwards), land, settle. 7 frames, the last one is the ground pose."""
    sgn = 1 if forward else -1
    def p(tilt, drop, kneel, arms, extra=None):
        r = {'root': (tilt * sgn, 0, 0), 'thigh.L': (-kneel, 0, -6), 'thigh.R': (-kneel * 0.6, 0, 8), 'shin.L': (kneel * 1.6, 0, 0), 'shin.R': (kneel * 1.2, 0, 0),
             'spine': (-10 * sgn * min(1, tilt / 40), 0, 0), 'head': (-14 * sgn * min(1, tilt / 60), 0, 0),
             'upper_arm.L': (arms, 0, -30), 'upper_arm.R': (arms * 0.7, 0, 34), 'fore_arm.L': (-20, 0, 0), 'fore_arm.R': (-30, 0, 0)}
        if extra:
            r.update(extra)
        return P(r, {'root': (0, drop, 0)})
    keys = [(0.0, p(0, 0, 0, -20)), (0.17, p(-8, -0.03, 18, -50)), (0.33, p(14, -0.12, 44, -90)), (0.5, p(48, -0.1, 34, -120)),
            (0.67, p(80, 0.06, 14, -150)), (0.83, p(90, 0.12, 6, -160)), (1.0, p(90, 0.12, 4, -165, {'head': (-4 * sgn, 20, 0)}))]
    return keyed(keys, 7, loop=False)


def human_anims(kind):
    """Every animation of a foot unit, in the order they appear in the sheet."""
    from humans import SCALE
    cyc = stride_m() * SCALE / 1.0   # metres scaled into game units (1 game unit = 1 tile)
    holdprops = {'villager': set(), 'spearman': {'spear', 'shield'}, 'swordsman': {'sword', 'kite', 'scabbard'},
                 'archer': {'bow', 'quiver'}, 'siphonarios': {'siphon'}}[kind]
    anims = [
        Anim('idle', 2, lambda i: pose_idle(kind, i), holdprops, frame_ms=650),
        Anim('walk', 8, lambda i: pose_walk(kind, i / 8), holdprops, cycle=cyc),
    ]
    if kind == 'villager':
        for job in ('chop', 'mine', 'farm', 'forage', 'build'):
            f, pr = villager_work(job)
            anims.append(Anim(job, 8, f, pr, frame_ms=110 if job != 'forage' else 140))
        for res, prop in (('wood', 'logs'), ('food', 'sack'), ('gold', 'goldbasket'), ('stone', 'stone')):
            anims.append(Anim('carry_' + res, 8, (lambda r: lambda i: pose_walk('villager', i / 8, carry=r))(res), {prop}, cycle=cyc * 0.92))
        # Villagers fight with the axe.
        anims.append(Anim('attack', 8, keyed(swing_keys((-150, -50, 0), (-50, -10, 40), twist=-14), 8, loop=True), {'axe'}, frame_ms=95))
    elif kind == 'spearman':
        anims.append(Anim('attack', 8, spear_attack(), holdprops, frame_ms=95))
    elif kind == 'swordsman':
        anims.append(Anim('attack', 8, sword_attack(), holdprops, frame_ms=90))
    elif kind == 'archer':
        f, pr = bow_attack()
        anims.append(Anim('attack', 8, f, pr, frame_ms=120))
    elif kind == 'siphonarios':
        f = siphon_attack()
        anims.append(Anim('attack', 8, f, lambda i: {'siphon', 'fire%d' % int(FIRE[i] * 100)} if FIRE[i] > 0 else {'siphon'}, frame_ms=100))
    dropped = holdprops - {'spear', 'sword', 'bow'}
    anims.append(Anim('death', 7, death(kind, forward=kind in ('archer', 'villager')), lambda i: holdprops if i < 4 else dropped, loop=False, frame_ms=110))
    return anims
