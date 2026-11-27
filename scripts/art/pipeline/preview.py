"""Quick contact sheet of a subject's animations for checking poses and models (low samples, not cached).

python preview.py <subject> [anims=a,b] [facings=1,3,6] [scale=3] [out=path.png] [samples=8] [cached]

`cached` draws the cached full-quality frames instead of rendering (all facings by default)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

GRASS = np.array([96, 112, 52], np.float32)
DIRT = np.array([132, 112, 80], np.float32)


def compose(layers, bg=GRASS):
    rgb, mask, team, shadow, outline = layers['rgb'], layers['mask'], layers['team'], layers['shadow'], layers['outline']
    h, w = mask.shape
    out = np.empty((h, w, 3), np.float32)
    out[:] = bg
    # Subtle checker so the frame edge shows.
    out *= 1 - 0.03 * (((np.arange(h)[:, None] // 8) + (np.arange(w)[None] // 8)) % 2)[..., None]
    sa = np.asarray(shadow, np.float32)
    out *= (1 - sa)[..., None]
    oa = np.asarray(outline, np.float32)
    out *= (1 - oa)[..., None]
    col = np.asarray(rgb, np.float32).copy()
    t = np.asarray(team) >= 0
    if t.any():
        # Preview the team ramp in blue.
        lv = np.asarray(team, np.float32)[t] / 15.0
        col[t] = np.stack([20 + 60 * lv, 50 + 110 * lv, 120 + 135 * lv], -1)
    out[mask] = col[mask]
    return out


def save(grid, path, scale):
    img = Image.fromarray(np.clip(grid, 0, 255).astype(np.uint8))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(path)
    print('wrote', path, img.size)


def main(argv):
    opts = dict(a.split('=', 1) for a in argv[1:] if '=' in a)
    name = argv[0]
    scale = int(opts.get('scale', 3))
    out = opts.get('out', os.path.join(os.environ.get('ART_PREVIEW', '/tmp'), 'preview_%s.png' % name))
    bg = DIRT if opts.get('bg') == 'dirt' else GRASS
    import subjects
    sub = subjects.get(name)
    wanted = opts.get('anims')
    wanted = set(wanted.split(',')) if wanted else None
    if 'cached' in argv:
        import render
        rows = []
        for anim in sub.anims():
            if wanted is not None and anim.name not in wanted:
                continue
            p = os.path.join(render.FRAMES_DIR, sub.name, anim.name + '.npz')
            if not os.path.exists(p):
                continue
            d = np.load(p)
            fac = [int(x) for x in opts['facings'].split(',')] if 'facings' in opts else list(range(d['mask'].shape[1]))
            for fi in range(d['mask'].shape[0]):
                row = [compose({k: d[k][fi, c] for k in ('rgb', 'mask', 'team', 'shadow', 'outline')}, bg) for c in fac]
                rows.append(np.concatenate(row, 1))
        w = max(r.shape[1] for r in rows)
        rows = [np.pad(r, ((0, 0), (0, w - r.shape[1]), (0, 0))) for r in rows]
        save(np.concatenate(rows, 0), out, scale)
        return
    import bpy
    import core
    import post
    import render
    facings = [int(x) for x in opts.get('facings', '1,3,6').split(',')]
    samples = int(opts.get('samples', 8))
    core.SS = int(opts.get('ss', 2))
    w, h, ax, ay = sub.frame
    blocks = []
    for anim in sub.anims():
        if wanted is not None and anim.name not in wanted:
            continue
        core.reset_scene(samples)
        core.ground_plane(60)
        rig = sub.build()
        arm = rig['arm']
        nf = anim.frames
        copies = [(arm, {ch.name: ch for ch in arm.children})]
        while len(copies) < nf * len(facings):
            copies.append(render.duplicate_rig(arm))
        core.set_frame(w * nf, h * len(facings), ax, ay)
        for k, (ca, kids) in enumerate(copies):
            r, c = divmod(k, nf)   # rows = facings, columns = frames
            gx, gy = render.screen_to_game(c * w, r * h)
            ca.location = core.game_to_blender((gx, gy, 0))
            ca.rotation_euler = (0, 0, core.facing_rot_z(facings[r]))
            rot, loc = anim.pose(c)
            core.pose(ca, rot, loc)
            show = anim.props(c) if callable(anim.props) else anim.props
            for nm, o in kids.items():
                base = nm.split('.')[0]
                o.hide_render = base in sub.props and base not in show
            if anim.extra is not None:
                anim.extra(c, ca, kids)
        bpy.context.view_layer.update()
        rgba, cat, team = core.render('preview')
        S = core.SS
        img = np.zeros((h * len(facings), w * nf, 3), np.float32)
        for r in range(len(facings)):
            for c in range(nf):
                sl = (slice(r * h * S, (r + 1) * h * S), slice(c * w * S, (c + 1) * w * S))
                lay = post.to_layers(rgba[sl], cat[sl], team[sl], S, unit=sub.unit, exposure_mul=sub.exposure, shadow_mul=sub.shadow_mul)
                img[r * h:(r + 1) * h, c * w:(c + 1) * w] = compose(lay, bg)
        blocks.append(img)
        print('anim', anim.name, flush=True)
    W = max(b.shape[1] for b in blocks)
    blocks = [np.pad(b, ((0, 2), (0, W - b.shape[1]), (0, 0)), constant_values=30) for b in blocks]
    save(np.concatenate(blocks, 0), out, scale)


if __name__ == '__main__':
    main(sys.argv[1:])
