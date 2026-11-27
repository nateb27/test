"""Which cached animations go into which sheet, under which game state name (src/client/art/manifest.ts
UnitAnimState). Timing (ms per frame, loop, ground cycle) comes from each animation's cache record."""
import json
import os

import post

CACHE = os.environ.get('ART_CACHE', os.path.join(post.REPO, 'scripts', 'art', '.cache'))
FRAMES = os.path.join(CACHE, 'frames')

UNITS = ['villager', 'spearman', 'swordsman', 'archer', 'siphonarios', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet']
VILLAGER_EXTRA = [('chop', 'chop'), ('mine', 'mine'), ('farm', 'farm'), ('forage', 'forage'), ('build', 'build'),
                  ('carryWood', 'carry_wood'), ('carryFood', 'carry_food'), ('carryGold', 'carry_gold'), ('carryStone', 'carry_stone')]

TREES = ['oak1', 'oak2', 'cypress', 'olive', 'pine1', 'pine2']
BUSHES = ['berry1', 'berry2']


def timing(subject, anim):
    p = os.path.join(FRAMES, subject, anim + '.json')
    if not os.path.exists(p):
        return {}
    j = json.load(open(p))
    out = {}
    if j.get('ms'):
        out['ms'] = j['ms']
    if j.get('cycle'):
        out['cycle'] = j['cycle']
    if 'loop' in j:
        out['loop'] = j['loop']
    return out


def st(name, subject, anim, **kw):
    d = dict(name=name, subject=subject, anim=anim)
    d.update(timing(subject, anim))
    d.update(kw)
    return d


def sheets():
    out = []
    for u in UNITS:
        states = [st('idle', u, 'idle'), st('walk', u, 'walk')]
        if u == 'villager':
            states += [st(n, u, a) for n, a in VILLAGER_EXTRA]
        states += [st('attack', u, 'attack'), st('death', u, 'death', loop=False), st('corpse', u, 'death', corpse=True, loop=False, ms=0)]
        out.append(dict(name=u, states=states, icon=dict(subject=u, anim='icon')))
    out.append(dict(name='tree', states=[st('v%d' % i, t, 'default', loop=False, ms=0) for i, t in enumerate(TREES)], variants=len(TREES)))
    out.append(dict(name='berryBush', states=[st('v%d' % i, t, 'default', loop=False, ms=0) for i, t in enumerate(BUSHES)], variants=len(BUSHES)))
    return out
