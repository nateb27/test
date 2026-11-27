"""Render driver: renders every frame of one animation of one subject (all 8 facings) in a single Cycles render by
laying out copies of the posed rig on a grid (one sub-frame per facing and frame), then cuts the image into sprite
layers (post.to_layers) and caches them per animation under .cache/frames/<subject>/<anim>.npz.

Incremental: before rendering, a digest of everything that reaches the image (evaluated geometry of every copy,
materials, light, camera, render settings, post settings) is compared with the cached one; an unchanged animation
is skipped.

Usage (venv python): python render.py <subject>[:<anim>,<anim>] ... [--force] [--list]
"""
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import bpy  # noqa: E402
import core  # noqa: E402
import post  # noqa: E402
from core import SS, facing_rot_z, game_to_blender  # noqa: E402

FRAMES_DIR = os.path.join(core.CACHE, 'frames')
MAX_COPIES = 64
VERSION = 3   # bump to invalidate every cached animation


def screen_to_game(dx, dy):
    """World offset (tiles, z = 0) that moves a model by (dx, dy) screen px at 1x."""
    return ((dx / 32 + dy / 16) / 2, (dy / 16 - dx / 32) / 2)


def duplicate_rig(arm):
    """A copy of an armature object and its child meshes (mesh and armature data shared, own pose)."""
    sc = bpy.context.scene
    na = arm.copy()
    sc.collection.objects.link(na)
    kids = {}
    for ch in arm.children:
        c = ch.copy()
        sc.collection.objects.link(c)
        c.parent = na
        for md in c.modifiers:
            if md.type == 'ARMATURE':
                md.object = na
        kids[ch.name] = c
    return na, kids


def _mat_digest(h, m):
    h.update(m.name.encode())
    if not m.node_tree:
        return
    for n in m.node_tree.nodes:
        h.update(n.bl_idname.encode())
        for k in ('blend_type', 'data_type', 'aov_name', 'attribute_name'):
            if hasattr(n, k):
                h.update(str(getattr(n, k)).encode())
        for i in n.inputs:
            if hasattr(i, 'default_value'):
                v = i.default_value
                try:
                    h.update(np.round(np.array(v, np.float64), 6).tobytes())
                except (TypeError, ValueError):
                    h.update(str(v).encode())
        for o in n.outputs:
            if hasattr(o, 'default_value'):
                try:
                    h.update(np.round(np.array(o.default_value, np.float64), 6).tobytes())
                except (TypeError, ValueError):
                    pass
    for l in m.node_tree.links:
        h.update((l.from_node.name + l.from_socket.identifier + l.to_node.name + l.to_socket.identifier).encode())


def scene_digest(extra):
    h = hashlib.sha1()
    h.update(json.dumps(extra, sort_keys=True).encode())
    h.update(open(core.CONST_PATH, 'rb').read())
    for f in ('post.py',):
        h.update(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f), 'rb').read())
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    mats = set()
    for ob in sorted(sc.objects, key=lambda o: o.name):
        if ob.hide_render:
            continue
        h.update(ob.name.encode())
        h.update(np.round(np.array(ob.matrix_world, np.float64), 5).tobytes())
        if ob.type == 'MESH':
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get('co', co)
            h.update(np.round(co, 4).tobytes())
            h.update(str(ob.is_shadow_catcher).encode())
            for s in ob.material_slots:
                if s.material:
                    mats.add(s.material)
            ev.to_mesh_clear()
        elif ob.type == 'LIGHT':
            d = ob.data
            h.update(np.array([*d.color, d.energy, getattr(d, 'angle', 0)], np.float64).round(6).tobytes())
        elif ob.type == 'CAMERA':
            d = ob.data
            h.update(np.array([d.ortho_scale, d.shift_x, d.shift_y], np.float64).round(7).tobytes())
    for m in sorted(mats, key=lambda m: m.name):
        _mat_digest(h, m)
    if sc.world and sc.world.node_tree:
        for n in sc.world.node_tree.nodes:
            for i in n.inputs:
                if hasattr(i, 'default_value'):
                    try:
                        h.update(np.round(np.array(i.default_value, np.float64), 6).tobytes())
                    except (TypeError, ValueError):
                        pass
    c = sc.cycles
    h.update(json.dumps([c.samples, c.adaptive_threshold, c.use_denoising, c.max_bounces, sc.render.resolution_x, sc.render.resolution_y, VERSION]).encode())
    return h.hexdigest()


def render_anim(subject, anim, force=False):
    """Render all frames x 8 facings of `anim` for `subject` (see subjects.py). Returns the cache path."""
    w, h, ax, ay = subject.frame
    z = anim.zoom
    if z != 1.0:
        w, h, ax, ay = int(round(w * z)), int(round(h * z)), ax * z, ay * z
    out_dir = os.path.join(FRAMES_DIR, subject.name)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, anim.name + '.npz')
    meta_path = os.path.join(out_dir, anim.name + '.json')
    facings = anim.facings
    nf = anim.frames
    core.reset_scene(subject.samples)
    core.ground_plane(60)
    rig = subject.build()
    arm = rig['arm']
    # Copies on a grid: columns = facings, rows = frames; batches of at most MAX_COPIES.
    rows_per_batch = max(1, MAX_COPIES // len(facings))
    copies = []
    for r in range(min(nf, rows_per_batch)):
        for c in range(len(facings)):
            if r == 0 and c == 0:
                copies.append((arm, {ch.name: ch for ch in arm.children}))
            else:
                copies.append(duplicate_rig(arm))
    results = [[None] * len(facings) for _ in range(nf)]
    digests = []
    cached = json.load(open(meta_path)) if (os.path.exists(meta_path) and os.path.exists(path) and not force) else None
    batches = [list(range(s, min(nf, s + rows_per_batch))) for s in range(0, nf, rows_per_batch)]
    renders = []
    for bi, frames in enumerate(batches):
        rows = len(frames)
        core.set_frame(w * len(facings), h * rows, ax, ay, z)
        for k, (ca, kids) in enumerate(copies):
            r, c = divmod(k, len(facings))
            if r >= rows:
                ca.hide_render = True
                for o in kids.values():
                    o.hide_render = True
                continue
            ca.hide_render = False
            fi = frames[r]
            gx, gy = screen_to_game(c * w, r * h)
            ca.location = game_to_blender((gx, gy, 0))
            ca.rotation_euler = (0, 0, facing_rot_z(facings[c]))
            rot, loc = anim.pose(fi)
            core.pose(ca, rot, loc)
            show = anim.props(fi) if callable(anim.props) else anim.props
            for nm, o in kids.items():
                base = nm.split('.')[0]
                o.hide_render = base in subject.props and base not in show
            if anim.extra is not None:
                anim.extra(fi, ca, kids)
        bpy.context.view_layer.update()
        dig = scene_digest({'subject': subject.name, 'anim': anim.name, 'batch': bi, 'frames': frames, 'frame': [w, h, ax, ay],
                            'facings': facings, 'unit': subject.unit, 'exp': subject.exposure, 'sh': subject.shadow_mul})
        digests.append(dig)
        renders.append((frames, rows, dig))
    timing = {'ms': anim.frame_ms, 'loop': anim.loop, 'cycle': anim.cycle}
    if cached is not None and cached.get('digests') == digests:
        cached.update(timing)
        json.dump(cached, open(meta_path, 'w'))
        print('  skip %s/%s (unchanged)' % (subject.name, anim.name), flush=True)
        return path, False
    t0 = time.time()
    for frames, rows, dig in renders:
        # Re-apply this batch's poses (the digest pass above posed the last batch).
        core.set_frame(w * len(facings), h * rows, ax, ay, z)
        for k, (ca, kids) in enumerate(copies):
            r, c = divmod(k, len(facings))
            if r >= rows:
                ca.hide_render = True
                for o in kids.values():
                    o.hide_render = True
                continue
            ca.hide_render = False
            fi = frames[r]
            rot, loc = anim.pose(fi)
            core.pose(ca, rot, loc)
            show = anim.props(fi) if callable(anim.props) else anim.props
            for nm, o in kids.items():
                base = nm.split('.')[0]
                o.hide_render = base in subject.props and base not in show
            if anim.extra is not None:
                anim.extra(fi, ca, kids)
        bpy.context.view_layer.update()
        rgba, catcher, team = core.render('%s_%s' % (subject.name, anim.name))
        for r, fi in enumerate(frames):
            for c in range(len(facings)):
                sl = (slice(r * h * SS, (r + 1) * h * SS), slice(c * w * SS, (c + 1) * w * SS))
                results[fi][c] = post.to_layers(rgba[sl], catcher[sl], team[sl], SS, unit=subject.unit,
                                                exposure_mul=subject.exposure, shadow_mul=subject.shadow_mul)
    dt = time.time() - t0
    stack = lambda k, dt_: np.stack([np.stack([results[f][c][k] for c in range(len(facings))]) for f in range(nf)]).astype(dt_)
    np.savez_compressed(path, rgb=stack('rgb', np.float16), mask=stack('mask', bool), team=stack('team', np.int8),
                        shadow=stack('shadow', np.float16), outline=stack('outline', np.float16))
    json.dump({'digests': digests, 'frame': [w, h, ax, ay], 'facings': facings, 'frames': nf, 'seconds': round(dt, 1), **timing}, open(meta_path, 'w'))
    print('  rendered %s/%s: %d frames in %.1fs (%.2fs/frame)' % (subject.name, anim.name, nf * len(facings), dt, dt / (nf * len(facings))), flush=True)
    return path, True


def main(argv):
    import subjects
    force = '--force' in argv
    args = [a for a in argv if not a.startswith('--')]
    if '--list' in argv:
        for s in subjects.ALL:
            print(s, ' '.join(a.name for a in subjects.get(s).anims()))
        return
    names = args or list(subjects.ALL)
    t = time.time()
    n = 0
    for spec in names:
        nm, _, only = spec.partition(':')
        sub = subjects.get(nm)
        wanted = set(only.split(',')) if only else None
        for anim in sub.anims():
            if wanted is not None and anim.name not in wanted:
                continue
            _, did = render_anim(sub, anim, force)
            n += did
    print('done: %d animations rendered in %.0fs' % (n, time.time() - t), flush=True)


if __name__ == '__main__':
    main(sys.argv[1:])
