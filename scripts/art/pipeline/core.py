"""Blender scene, camera, light, materials, mesh builder, armature and render-to-numpy for the sprite pipeline.

Axis convention. Game world: +x screen down-right, +y screen down-left, z up (left-handed on screen). Blender is
right-handed, so game (x, y, z) maps to Blender (y, x, z). The orthographic camera looks from Blender direction
(1, 1, K) with K = sqrt(2/3) (30 degree elevation), which gives screenX = (x - y) * 32, screenY = (x + y) * 16 and
32 * sqrt(1.5) px per unit of height: the game's projection exactly (checked: a 1x1x1 cube is 64 px wide, 71 tall).

Light and tone map constants come from src/client/art/rendered/artConstants.json, shared with the in-browser
voxel renderer.
"""
import json
import math
import os

import numpy as np
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CONST_PATH = os.path.join(REPO, 'src', 'client', 'art', 'rendered', 'artConstants.json')
CONST = json.load(open(CONST_PATH))
LIGHT = CONST['light']
TEAM = CONST['team']

CACHE = os.environ.get('ART_CACHE', os.path.join(REPO, 'scripts', 'art', '.cache'))
WORK = os.path.join(CACHE, 'exr')
os.makedirs(WORK, exist_ok=True)

PX_PER_UNIT = 32 * math.sqrt(2)      # along the camera's right / up axes, at 1x
K = math.sqrt(2.0 / 3.0)
SS = int(os.environ.get('ART_SS', 3))   # supersampling factor


def game_to_blender(v):
    return Vector((v[1], v[0], v[2]))


def sun_dir_blender():
    az, el = math.radians(LIGHT['sunAz']), math.radians(LIGHT['sunEl'])
    L = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))  # towards the sun, game axes
    return game_to_blender(L).normalized()


def facing_rot_z(f):
    """Rotation (radians) for a model built facing Blender -Y so it faces game facing f (0=+x SE ... clockwise)."""
    return math.radians(180.0 - 45.0 * f)


# ---------------------------------------------------------------- scene
def reset_scene(samples=40):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 4
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.seed = 7
    sc.render.film_transparent = True
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = int(os.environ.get('ART_THREADS', os.cpu_count() or 4))
    s = sc.render.image_settings
    try:
        s.media_type = 'MULTI_LAYER_IMAGE'
    except (AttributeError, TypeError):
        pass
    try:
        s.file_format = 'OPEN_EXR_MULTILAYER'
    except TypeError:
        s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    s.exr_codec = 'ZIP'
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    vl = sc.view_layers[0]
    vl.cycles.use_pass_shadow_catcher = True
    aov = vl.aovs.add()
    aov.name = 'team'
    aov.type = 'VALUE'
    # World: sky above the horizon, warm bounce below.
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.05
    mr.inputs['From Max'].default_value = 0.15
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.30, 0.27, 0.20, 1)
    mix.inputs['B'].default_value = (*LIGHT['skyCol'], 1)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs[0])
    # Sun. Cycles' diffuse is albedo * E / pi while the voxel renderer uses albedo * E: scale by pi.
    sun = LIGHT['sunCol']
    ld = bpy.data.lights.new('Sun', 'SUN')
    m = max(sun)
    ld.color = tuple(c / m for c in sun)
    ld.energy = m * math.pi
    ld.angle = math.radians(4.0)
    lo = bpy.data.objects.new('Sun', ld)
    sc.collection.objects.link(lo)
    lo.rotation_euler = sun_dir_blender().to_track_quat('Z', 'Y').to_euler()
    # Camera.
    cd = bpy.data.cameras.new('Cam')
    cd.type = 'ORTHO'
    co = bpy.data.objects.new('Cam', cd)
    sc.collection.objects.link(co)
    sc.camera = co
    vd = Vector((1, 1, K)).normalized()
    co.location = vd * 30.0
    co.rotation_euler = (-vd).to_track_quat('-Z', 'Y').to_euler()
    cd.clip_start = 0.1
    cd.clip_end = 100
    return sc


def ground_plane(size=8.0):
    """Shadow catcher: receives shadows and contact occlusion, bounces light, never shows itself."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = 'Ground'
    g.data.materials.append(make_mat('ground', (0.34, 0.37, 0.17), rough=1.0, var=0.0))
    g.is_shadow_catcher = True
    return g


def set_frame(w1, h1, ax, ay, zoom=1.0):
    """Render target: w1 x h1 px, world origin projected to (ax, ay) px from top-left, `zoom` px per game px."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = int(round(w1 * SS)), int(round(h1 * SS))
    cd = sc.camera.data
    md = max(w1, h1)
    cd.ortho_scale = md / (PX_PER_UNIT * zoom)
    cd.shift_x = (w1 / 2 - ax) / md
    cd.shift_y = (ay - h1 / 2) / md


def _read_exr(path):
    import OpenEXR
    # Blender writes one EXR part per pass.
    with OpenEXR.File(path, separate_channels=True) as f:
        ch = {}
        for part in f.parts:
            for k, v in part.channels.items():
                ch[k] = v
        def find(suffix_list):
            for k in ch:
                for s in suffix_list:
                    if k.endswith(s):
                        return np.asarray(ch[k].pixels, np.float32)
            return None
        rgba = np.stack([find(['Combined.R']), find(['Combined.G']), find(['Combined.B']), find(['Combined.A'])], -1)
        cr, cg, cb = find(['.Shadow Catcher.R']), find(['.Shadow Catcher.G']), find(['.Shadow Catcher.B'])
        catcher = None if cr is None else 0.3 * cr + 0.59 * cg + 0.11 * cb
        team = find(['.team.X', '.team.V'])
    return rgba, catcher, team


def render(tag):
    """Render the scene. Returns (premultiplied linear RGBA, shadow catcher (H, W) where 1 = unshadowed,
    team coverage (H, W)), all at SS x resolution, rows top to bottom."""
    sc = bpy.context.scene
    path = os.path.join(WORK, tag + '.exr')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=False)
    bpy.data.images['Render Result'].save_render(path)
    rgba, catcher, team = _read_exr(path)
    os.remove(path)
    H, W = rgba.shape[:2]
    if catcher is None:
        catcher = np.ones((H, W), np.float32)
    if team is None:
        team = np.zeros((H, W), np.float32)
    return rgba, catcher, team


# ---------------------------------------------------------------- materials
def _lin(c):
    return tuple(max(0.0, v) ** 2 for v in c)   # voxel renderer albedo convention: display-ish value squared


def make_mat(name, col, rough=0.85, var=0.18, nscale=60.0, dirt=0.0, dirt_h=0.25, metal=0.0,
             attr=False, transl=0.0, streak=False, col2=None, spec=0.25, team=False, emit=0.0):
    """Matte procedural material. col in the voxel renderer's display-ish space (squared to linear).
    var: noise brightness variation; dirt: brown darkening towards z=0 (object coordinates); attr: multiply by
    the 'Col' corner attribute; transl: diffuse/translucent mix for leaves; team: writes the 'team' AOV (the
    pixels are re-coloured per player at runtime)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    Lk = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    noise = N.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = nscale
    noise.inputs['Detail'].default_value = 4.0
    noise.inputs['Roughness'].default_value = 0.6
    if streak:
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0, 1.0, 0.15)
        Lk.new(tc.outputs['Object'], mp.inputs[0])
        Lk.new(mp.outputs[0], noise.inputs['Vector'])
    else:
        Lk.new(tc.outputs['Object'], noise.inputs['Vector'])
    mr = N.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.3
    mr.inputs['From Max'].default_value = 0.7
    mr.inputs['To Min'].default_value = 1.0 - var
    mr.inputs['To Max'].default_value = 1.0 + var * 0.6
    Lk.new(noise.outputs['Fac'], mr.inputs['Value'])
    base = N.new('ShaderNodeRGB')
    base.outputs[0].default_value = (*_lin(col), 1)
    cur = base.outputs[0]
    if col2 is not None:
        n2 = N.new('ShaderNodeTexNoise')
        n2.inputs['Scale'].default_value = nscale * 0.25
        Lk.new(tc.outputs['Object'], n2.inputs['Vector'])
        c2 = N.new('ShaderNodeRGB')
        c2.outputs[0].default_value = (*_lin(col2), 1)
        mx = N.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        Lk.new(n2.outputs['Fac'], mx.inputs['Factor'])
        Lk.new(cur, mx.inputs['A'])
        Lk.new(c2.outputs[0], mx.inputs['B'])
        cur = mx.outputs['Result']
    mul = N.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    Lk.new(cur, mul.inputs['A'])
    cv = N.new('ShaderNodeCombineXYZ')
    for k in 'XYZ':
        Lk.new(mr.outputs['Result'], cv.inputs[k])
    Lk.new(cv.outputs[0], mul.inputs['B'])
    cur = mul.outputs['Result']
    if attr:
        at = N.new('ShaderNodeAttribute')
        at.attribute_name = 'Col'
        m2 = N.new('ShaderNodeMix')
        m2.data_type = 'RGBA'
        m2.blend_type = 'MULTIPLY'
        m2.inputs['Factor'].default_value = 1.0
        Lk.new(cur, m2.inputs['A'])
        Lk.new(at.outputs['Color'], m2.inputs['B'])
        cur = m2.outputs['Result']
    if dirt > 0:
        sep = N.new('ShaderNodeSeparateXYZ')
        Lk.new(tc.outputs['Object'], sep.inputs[0])
        dm = N.new('ShaderNodeMapRange')
        dm.inputs['From Min'].default_value = 0.0
        dm.inputs['From Max'].default_value = dirt_h
        dm.inputs['To Min'].default_value = dirt
        dm.inputs['To Max'].default_value = 0.0
        Lk.new(sep.outputs['Z'], dm.inputs['Value'])
        dc = N.new('ShaderNodeRGB')
        dc.outputs[0].default_value = (*_lin((0.30, 0.24, 0.17)), 1)
        m3 = N.new('ShaderNodeMix')
        m3.data_type = 'RGBA'
        Lk.new(dm.outputs['Result'], m3.inputs['Factor'])
        Lk.new(cur, m3.inputs['A'])
        Lk.new(dc.outputs[0], m3.inputs['B'])
        cur = m3.outputs['Result']
    if transl > 0:
        dif = N.new('ShaderNodeBsdfDiffuse')
        tr = N.new('ShaderNodeBsdfTranslucent')
        Lk.new(cur, dif.inputs['Color'])
        tm = N.new('ShaderNodeMix')
        tm.data_type = 'RGBA'
        tm.blend_type = 'MULTIPLY'
        tm.inputs['Factor'].default_value = 1.0
        Lk.new(cur, tm.inputs['A'])
        tm.inputs['B'].default_value = (1.0, 1.1, 0.55, 1)
        Lk.new(tm.outputs['Result'], tr.inputs['Color'])
        ms = N.new('ShaderNodeMixShader')
        ms.inputs['Fac'].default_value = transl
        Lk.new(dif.outputs[0], ms.inputs[1])
        Lk.new(tr.outputs[0], ms.inputs[2])
        Lk.new(ms.outputs[0], out.inputs['Surface'])
    else:
        p = N.new('ShaderNodeBsdfPrincipled')
        Lk.new(cur, p.inputs['Base Color'])
        p.inputs['Roughness'].default_value = rough
        p.inputs['Metallic'].default_value = metal
        p.inputs['Specular IOR Level'].default_value = spec
        if emit > 0:
            Lk.new(cur, p.inputs['Emission Color'])
            p.inputs['Emission Strength'].default_value = emit
        Lk.new(p.outputs[0], out.inputs['Surface'])
    if team:
        ao = N.new('ShaderNodeOutputAOV')
        ao.aov_name = 'team'
        ao.inputs['Value'].default_value = 1.0
    return m


# ---------------------------------------------------------------- mesh builder
class MB:
    """Accumulates verts/faces with per-face material and per-vertex group weights; one skinned mesh."""

    def __init__(self):
        self.v = []
        self.f = []
        self.fm = []
        self.fc = []
        self.vg = []
        self.mats = []
        self.matidx = {}

    def mat(self, m):
        if m.name not in self.matidx:
            self.matidx[m.name] = len(self.mats)
            self.mats.append(m)
        return self.matidx[m.name]

    def add_v(self, p, w):
        self.v.append(tuple(p))
        if isinstance(w, str):
            w = {w: 1.0}
        elif callable(w):
            w = w(p)
        self.vg.append(w or {})
        return len(self.v) - 1

    def face(self, idx, m, col=(1, 1, 1)):
        self.f.append(tuple(idx))
        self.fm.append(self.mat(m))
        self.fc.append(col)

    def rings(self, rings, m, cap0=True, cap1=True, col=(1, 1, 1)):
        n = len(rings[0])
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.face((a[i], a[j], b[j], b[i]), m, col)
        if cap0:
            self.face(list(reversed(rings[0])), m, col)
        if cap1:
            self.face(rings[-1], m, col)

    def lathe(self, prof, n, m, w, center=(0, 0), disp=None, cap0=True, cap1=True, phase=0.0):
        """prof: list of (z, rx, ry[, dx, dy]); ring in the xy plane. disp(theta, t, p) -> p for folds."""
        rs = []
        for k, pr in enumerate(prof):
            z, rx, ry = pr[0], pr[1], pr[2]
            dx = pr[3] if len(pr) > 3 else 0.0
            dy = pr[4] if len(pr) > 4 else 0.0
            ring = []
            for i in range(n):
                th = 2 * math.pi * i / n + phase
                p = Vector((center[0] + dx + rx * math.cos(th), center[1] + dy + ry * math.sin(th), z))
                if disp:
                    p = disp(th, k / max(1, len(prof) - 1), p)
                ring.append(self.add_v(p, w))
            rs.append(ring)
        self.rings(rs, m, cap0, cap1)
        return rs

    def tube(self, a, b, r0, r1, n, m, w, sq=1.0, segs=1, cap0=True, cap1=True, bend=None, up=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        ax = d.normalized()
        if up is None:
            up = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        u = ax.cross(Vector(up)).normalized()
        v = ax.cross(u).normalized()
        rs = []
        for s in range(segs + 1):
            t = s / segs
            c = a + d * t
            r = r0 + (r1 - r0) * t
            if bend:
                c = c + bend(t)
            ring = []
            for i in range(n):
                th = 2 * math.pi * i / n
                ring.append(self.add_v(c + u * (r * math.cos(th)) + v * (r * sq * math.sin(th)), w))
            rs.append(ring)
        self.rings(rs, m, cap0, cap1)

    def ellipsoid(self, c, r, m, w, nu=10, nv=7, disp=None, col=(1, 1, 1), rot=None):
        c = Vector(c)
        rs = []
        for j in range(1, nv):
            ph = math.pi * j / nv
            ring = []
            for i in range(nu):
                th = 2 * math.pi * i / nu
                p = Vector((math.sin(ph) * math.cos(th) * r[0], math.sin(ph) * math.sin(th) * r[1], math.cos(ph) * r[2]))
                if disp:
                    p = disp(p)
                if rot:
                    p = rot @ p
                ring.append(self.add_v(c + p, w))
            rs.append(ring)
        pt = Vector((0, 0, r[2]))
        pb = Vector((0, 0, -r[2]))
        if disp:
            pt = disp(pt)
            pb = disp(pb)
        if rot:
            pt = rot @ pt
            pb = rot @ pb
        top = self.add_v(c + pt, w)
        bot = self.add_v(c + pb, w)
        self.rings(rs, m, False, False, col)
        for i in range(nu):
            j = (i + 1) % nu
            self.face((top, rs[0][i], rs[0][j]), m, col)
            self.face((bot, rs[-1][j], rs[-1][i]), m, col)

    def box(self, c, s, m, w, rot=None):
        c = Vector(c)
        idx = []
        for k in range(8):
            p = Vector(((k & 1) * 2 - 1, ((k >> 1) & 1) * 2 - 1, ((k >> 2) & 1) * 2 - 1))
            p = Vector((p.x * s[0] / 2, p.y * s[1] / 2, p.z * s[2] / 2))
            if rot:
                p = rot @ p
            idx.append(self.add_v(c + p, w))
        for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.face([idx[i] for i in q], m)

    def disc(self, c, nrm, r, thick, m_face, m_rim, w, n=20, dome=0.0, m_back=None):
        """A flat round plate (shield face) facing `nrm`, `thick` deep, optional dome in the middle."""
        c = Vector(c)
        nrm = Vector(nrm).normalized()
        u = nrm.cross(Vector((0, 0, 1)))
        if u.length < 1e-4:
            u = nrm.cross(Vector((1, 0, 0)))
        u.normalize()
        v = nrm.cross(u).normalized()
        def ring(off, rr):
            return [self.add_v(c + nrm * off + u * (rr * math.cos(2 * math.pi * i / n)) + v * (rr * math.sin(2 * math.pi * i / n)), w) for i in range(n)]
        front = ring(thick * 0.5, r * 0.9)
        rimf = ring(thick * 0.3, r)
        back = ring(-thick * 0.5, r)
        ctr = self.add_v(c + nrm * (thick * 0.5 + dome), w)
        for i in range(n):
            j = (i + 1) % n
            self.face((ctr, front[i], front[j]), m_face)
            self.face((front[i], rimf[i], rimf[j], front[j]), m_rim)
            self.face((rimf[i], back[i], back[j], rimf[j]), m_rim)
        self.face(list(reversed(back)), m_back or m_rim)

    def build(self, name, smooth=True, attr=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for mt in self.mats:
            me.materials.append(mt)
        me.polygons.foreach_set('material_index', self.fm)
        me.polygons.foreach_set('use_smooth', [smooth] * len(self.f))
        if attr:
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
            cols = []
            for poly, c in zip(me.polygons, self.fc):
                for _ in range(poly.loop_total):
                    cols.extend((c[0], c[1], c[2], 1.0))
            ca.data.foreach_set('color', cols)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        groups = {}
        for i, wd in enumerate(self.vg):
            for g, wt in wd.items():
                if g not in groups:
                    groups[g] = ob.vertex_groups.new(name=g)
                if wt > 0:
                    groups[g].add([i], wt, 'REPLACE')
        return ob


# ---------------------------------------------------------------- armature
def make_armature(name, bones):
    """bones: list of (name, head, tail, parent). Returns the armature object in rest pose."""
    ad = bpy.data.armatures.new(name)
    ao = bpy.data.objects.new(name, ad)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bn, h, t, par in bones:
        b = ad.edit_bones.new(bn)
        b.head = h
        b.tail = t
        b.roll = 0.0
        if par:
            b.parent = eb[par]
            b.use_connect = False
        eb[bn] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ao.pose.bones:
        pb.rotation_mode = 'ZYX' if pb.name.startswith('upper_arm') else 'XYZ'
    return ao


def skin(mesh_obj, arm_obj):
    mesh_obj.parent = arm_obj
    md = mesh_obj.modifiers.new('Arm', 'ARMATURE')
    md.object = arm_obj


def pose(arm, rot, loc=None):
    for pb in arm.pose.bones:
        r = rot.get(pb.name, (0, 0, 0))
        pb.rotation_euler = Euler([math.radians(x) for x in r], pb.rotation_mode)
        pb.location = (0, 0, 0)
    if loc:
        for k, v in loc.items():
            if k in arm.pose.bones:
                arm.pose.bones[k].location = v
    bpy.context.view_layer.update()
