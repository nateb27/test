"""Registry of everything the pipeline renders: one Subject per unit sheet (and the trees). A subject builds its
rig into the current Blender scene and lists its animations."""
import core


class Subject:
    def __init__(self, name, frame, build, anims, props=(), unit=True, samples=20, exposure=1.0, shadow_mul=1.0, icon_zoom=0, icon_facing=1):
        self.name = name
        self.frame = frame          # sub-frame (w, h, ax, ay) at 1x; (ax, ay) is the ground anchor
        self._build = build
        self._anims = anims
        self.props = set(props)
        self.unit = unit
        self.samples = samples
        self.exposure = exposure
        self.shadow_mul = shadow_mul
        self.icon_zoom = icon_zoom      # >0: also render a larger single-frame HUD portrait ('icon')
        self.icon_facing = icon_facing

    def build(self):
        return self._build()

    def anims(self):
        out = list(self._anims())
        if self.icon_zoom:
            from anim import Anim
            idle = out[0]
            out.append(Anim('icon', 1, idle.pose, idle.props, facings=[self.icon_facing], loop=False, zoom=self.icon_zoom))
        return out


def _human(kind):
    import humans as H
    from human_anims import FIRE, human_anims

    props_by_kind = {
        'villager': {'axe': H.prop_axe, 'pick': H.prop_pick, 'hoe': H.prop_hoe, 'hammer': H.prop_hammer, 'basket': H.prop_basket,
                     'logs': H.prop_logs, 'sack': H.prop_sack_food, 'goldbasket': H.prop_gold, 'stone': H.prop_stone},
        'spearman': {'spear': H.prop_spear, 'shield': H.prop_round_shield},
        'swordsman': {'sword': H.prop_sword, 'kite': H.prop_kite_shield, 'scabbard': H.prop_scabbard},
        'archer': {'bow': H.prop_bow, 'bowdrawn': lambda M: H.prop_bow(M, drawn=True), 'arrow': H.prop_arrow, 'quiver': H.prop_quiver},
        'siphonarios': {'siphon': H.prop_siphon, **{'fire%d' % int(v * 100): (lambda s: lambda M: H.prop_fire(M, s))(v) for v in set(FIRE) if v > 0}},
    }[kind]

    def build():
        M = H.Mats(kind)
        arm = core.make_armature('rig', H.bones_human())
        body = H.build_body(kind, M).build('body')
        core.skin(body, arm)
        for nm, fn in props_by_kind.items():
            ob = fn(M).build(nm)
            core.skin(ob, arm)
            if nm.startswith('fire'):
                ob.visible_shadow = False
        arm.scale = (H.SCALE, H.SCALE, H.SCALE)
        return {'arm': arm}

    return Subject(kind, HUMAN_FRAME, build, lambda: human_anims(kind), props=props_by_kind.keys(), icon_zoom=2.4, icon_facing=1)


HUMAN_FRAME = (64, 64, 26, 46)
CAV_FRAME = (128, 104, 56, 72)


def _cavalry(kind):
    import horses as HS
    import humans as H
    from horse_anims import cavalry_anims
    rp = HS.rider_props(kind)

    def build():
        M = H.Mats(kind)
        arm = core.make_armature('rig', HS.bones_horse() + HS.bones_rider())
        horse = HS.build_horse(kind, M).build('horse')
        core.skin(horse, arm)
        rider = HS.build_rider(kind, M).build('rider')
        core.skin(rider, arm)
        for nm, fn in rp.items():
            ob = fn(M).build(nm)
            core.skin(ob, arm)
        arm.scale = (H.SCALE, H.SCALE, H.SCALE)
        return {'arm': arm}

    return Subject(kind, CAV_FRAME, build, lambda: cavalry_anims(kind), props=rp.keys(), icon_zoom=1.5, icon_facing=0)

RAM_FRAME = (144, 112, 66, 72)
TREB_FRAME = (176, 160, 84, 118)


def _siege(kind):
    import humans as H
    import siege as SG
    from siege_anims import siege_anims

    def build():
        M = H.Mats(kind)
        bones = SG.bones_ram() if kind == 'batteringRam' else SG.bones_treb()
        arm = core.make_armature('rig', bones)
        ob = (SG.build_ram(M) if kind == 'batteringRam' else SG.build_treb(M)).build('engine', smooth=False)
        core.skin(ob, arm)
        arm.scale = (H.SCALE, H.SCALE, H.SCALE)
        return {'arm': arm}

    return Subject(kind, RAM_FRAME if kind == 'batteringRam' else TREB_FRAME, build, lambda: siege_anims(kind), unit=True, icon_zoom=0.9, icon_facing=0)


TREE_FRAME = (176, 136, 60, 118)
BUSH_FRAME = (80, 56, 32, 38)
TREE_VARIANTS = {'oak1': ('oak', 11), 'oak2': ('oak2', 23), 'cypress': ('cypress', 5), 'olive': ('olive', 8), 'pine1': ('pine', 4), 'pine2': ('pine', 9)}


def _vegetation(name):
    from anim import Anim
    import trees as T

    def build():
        arm = core.make_armature('rig', [('root', (0, 0, 0), (0, 0, 0.3), None)])
        if name.startswith('berry'):
            obs = T.build_berry_bush(3 if name == 'berry1' else 17)
        else:
            spec, seed = TREE_VARIANTS[name]
            obs = (T.build_tree(T.SPECS[spec], seed),)
        for ob in obs:
            core.skin(ob, arm)
        return {'arm': arm}

    frame = BUSH_FRAME if name.startswith('berry') else TREE_FRAME
    # Slightly brighter than a straight render, with full-strength ground shadows, to sit with the voxel buildings.
    return Subject(name, frame, build, lambda: [Anim('default', 1, lambda i: ({}, {}), facings=[0], loop=False)],
                   unit=False, samples=48, exposure=1.1, shadow_mul=1.1)


FACTORIES = {
    'villager': lambda: _human('villager'),
    'spearman': lambda: _human('spearman'),
    'swordsman': lambda: _human('swordsman'),
    'archer': lambda: _human('archer'),
    'siphonarios': lambda: _human('siphonarios'),
    'horseman': lambda: _cavalry('horseman'),
    'lancer': lambda: _cavalry('lancer'),
    'cataphract': lambda: _cavalry('cataphract'),
    'batteringRam': lambda: _siege('batteringRam'),
    'trebuchet': lambda: _siege('trebuchet'),
    **{n: (lambda n: lambda: _vegetation(n))(n) for n in ('oak1', 'oak2', 'cypress', 'olive', 'pine1', 'pine2', 'berry1', 'berry2')},
}
ALL = list(FACTORIES)


def get(name):
    return FACTORIES[name]()
