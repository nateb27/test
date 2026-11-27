"""Pack cached frames into indexed PNG sheets + JSON metadata (numpy/Pillow only, no bpy).

python pack.py [--hist-only]

Per sheet the palette is: 0 transparent, then shadow levels (black with alpha, drawn on the ground layer), outline
levels (black with alpha, drawn with the figure), 16 team-ramp levels (re-coloured per player at runtime) and the
colours of the shared 240-colour palette (src/client/art/rendered/palette.json) the sheet uses. Figures are dithered
to the shared palette exactly like the voxel renderer does (serpentine Floyd-Steinberg, masked).

Also writes scripts/art/sheet-histogram.json (colours of every figure before quantisation) for `npm run art:palette`.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import post  # noqa: E402
import sheets_spec as SPEC  # noqa: E402

REPO = post.REPO
CACHE = os.environ.get('ART_CACHE', os.path.join(REPO, 'scripts', 'art', '.cache'))
FRAMES = os.path.join(CACHE, 'frames')
OUT = os.path.join(REPO, 'src', 'client', 'art', 'sheets')
HIST = os.path.join(REPO, 'scripts', 'art', 'sheet-histogram.json')
PAL = json.load(open(os.path.join(REPO, 'src', 'client', 'art', 'rendered', 'palette.json')))['shared']
CONST = post.CONST
CW = CONST['palette']['channelWeights']
DITHER = CONST['palette']['dither']
TEAM_LEVELS = CONST['team']['levels']
SH_LEVELS = 12                 # shadow alpha k / 12
OUTLINE_MIN = 6                # outline alpha from 6 / 12 up
PAGE_W = 1024
PAGE_H_MAX = 2048


class Quantizer:
    def __init__(self, pal):
        self.pal = np.asarray(pal, np.float64).reshape(-1, 3)
        g = (np.arange(64) * 4 + 2).astype(np.float64)
        r, gg, b = np.meshgrid(g, g, g, indexing='ij')
        q = np.stack([r.ravel(), gg.ravel(), b.ravel()], 1)
        lut = np.empty(len(q), np.int32)
        for s in range(0, len(q), 16384):
            d = q[s:s + 16384, None, :] - self.pal[None]
            dd = d[..., 0] ** 2 * CW[0] + d[..., 1] ** 2 * CW[1] + d[..., 2] ** 2 * CW[2]
            lut[s:s + 16384] = dd.argmin(1)
        self.lut = lut.tolist()
        self.pl = self.pal.tolist()

    def dither(self, rgb, mask):
        """Port of quantize.ts ditherMasked. Returns palette index per pixel (-1 outside the mask)."""
        H, W = mask.shape
        e = np.asarray(rgb, np.float64).tolist()
        m = mask.tolist()
        idx = np.full((H, W), -1, np.int32)
        lut, pl, amt = self.lut, self.pl, DITHER
        for y in range(H):
            rev = y & 1
            sd = -1 if rev else 1
            row = e[y]
            mrow = m[y]
            nrow = e[y + 1] if y + 1 < H else None
            nm = m[y + 1] if y + 1 < H else None
            for xx in range(W):
                x = W - 1 - xx if rev else xx
                if not mrow[x]:
                    continue
                r, g, b = row[x]
                ri = min(255, max(0, int(r))) >> 2
                gi = min(255, max(0, int(g))) >> 2
                bi = min(255, max(0, int(b))) >> 2
                c = lut[(ri << 12) | (gi << 6) | bi]
                p = pl[c]
                idx[y, x] = c
                er, eg, eb = (r - p[0]) * amt, (g - p[1]) * amt, (b - p[2]) * amt
                x1 = x + sd
                if 0 <= x1 < W and mrow[x1]:
                    q = row[x1]
                    q[0] += er * 0.4375
                    q[1] += eg * 0.4375
                    q[2] += eb * 0.4375
                if nrow is not None:
                    for xq, wq in ((x - sd, 0.1875), (x, 0.3125), (x + sd, 0.0625)):
                        if 0 <= xq < W and nm[xq]:
                            q = nrow[xq]
                            q[0] += er * wq
                            q[1] += eg * wq
                            q[2] += eb * wq
        return idx


def team_ramp_preview():
    """Reference-blue ramp stored in the PNG palette so the raw sheets look right in an image viewer. The game never
    reads these colours: it re-colours the team indices with quantize.ts teamRamp(player colour)."""
    ref = CONST['team']['referenceColor']
    pr, pg, pb = (ref >> 16) & 255, (ref >> 8) & 255, ref & 255
    out = []
    for i in range(TEAM_LEVELS):
        t = (i + 0.5) / TEAM_LEVELS
        k = 0.12 + t * 1.25
        base = min(k, 1)
        hi = max(0, k - 1) * 0.55
        out.append([int(max(0, min(255, round(v * base + (255 - v * base) * hi)))) for v in (pr, pg, pb)])
    return out


def load_anim(subject, anim):
    p = os.path.join(FRAMES, subject, anim + '.npz')
    if not os.path.exists(p):
        return None
    d = np.load(p)
    return {k: d[k] for k in d.files}


def corpse_of(d):
    """Last death frame, darkened and desaturated (the body left on the field)."""
    out = {k: v[-1:].copy() for k, v in d.items()}
    rgb = out['rgb'].astype(np.float32)
    l = (0.3 * rgb[..., 0] + 0.59 * rgb[..., 1] + 0.11 * rgb[..., 2])[..., None]
    rgb = (l + (rgb - l) * 0.55) * 0.62
    out['rgb'] = rgb.astype(np.float16)
    t = out['team'].astype(np.int16)
    out['team'] = np.where(t >= 0, np.maximum(0, t - 5), -1).astype(np.int8)
    return out


def frame_layers(d, fi, ci):
    return {k: np.asarray(d[k][fi, ci]) for k in ('rgb', 'mask', 'team', 'shadow', 'outline')}


def build_sheet(spec, q, hist):
    """spec: dict(name, subject(s), states). Returns (meta, pages as index arrays, used colours)."""
    entries = []   # (state, facing, frame, layers, frame_geom)
    states_meta = {}
    for st in spec['states']:
        subj = st['subject']
        d = load_anim(subj, st['anim'])
        if d is None:
            print('  missing frames %s/%s' % (subj, st['anim']))
            return None
        if st.get('corpse'):
            d = corpse_of(d)
        geom = json.load(open(os.path.join(FRAMES, subj, st['anim'] + '.json')))['frame']
        nf, nfc = d['mask'].shape[:2]
        for c in range(nfc):
            for f in range(nf):
                entries.append((st['name'], c, f, frame_layers(d, f, c), geom))
        sm = {'frames': nf, 'facings': nfc, 'ms': st.get('ms', 120), 'loop': st.get('loop', True)}
        if st.get('cycle'):
            sm['cycle'] = round(st['cycle'], 4)
        states_meta[st['name']] = sm
    ic = spec.get('icon')
    if ic is not None:
        d = load_anim(ic['subject'], ic['anim'])
        if d is not None:
            geom = json.load(open(os.path.join(FRAMES, ic['subject'], ic['anim'] + '.json')))['frame']
            entries.append(('icon', 0, 0, frame_layers(d, 0, 0), geom))
    # Quantise every frame.
    items = []
    for name, c, f, L, geom in entries:
        mask = L['mask']
        team = L['team'].astype(np.int16)
        nonteam = mask & (team < 0)
        rgb = L['rgb'].astype(np.float64)
        if hist is not None:
            px = np.clip(rgb[nonteam], 0, 255).astype(np.int32) >> 3
            np.add.at(hist, (px[:, 0] << 10) | (px[:, 1] << 5) | px[:, 2], 1)
        cidx = q.dither(rgb, nonteam)
        sh = np.round(np.asarray(L['shadow'], np.float64) * SH_LEVELS).astype(np.int16)
        ol = np.asarray(L['outline'], np.float64) > 0
        items.append((name, c, f, cidx, team, mask, sh, ol, geom))
    return states_meta, items


def assemble(spec, states_meta, items, used_total):
    """Remap to the sheet palette, trim, shelf-pack, write PNG pages and JSON."""
    # Colour slots.
    counts = np.zeros(len(PAL) // 3, np.int64)
    for it in items:
        ci = it[3]
        v = ci[ci >= 0]
        counts += np.bincount(v, minlength=len(counts))
    n_sh = SH_LEVELS
    n_ol = SH_LEVELS - OUTLINE_MIN + 1
    sh0 = 1
    ol0 = sh0 + n_sh
    team0 = ol0 + n_ol
    col0 = team0 + TEAM_LEVELS
    room = 256 - col0
    used = list(np.nonzero(counts)[0])
    pal = np.asarray(PAL, np.float64).reshape(-1, 3)
    remap = {}
    if len(used) > room:
        keep = sorted(used, key=lambda i: -counts[i])[:room]
        ks = np.array(keep)
        for i in used:
            if i in keep:
                continue
            d = ((pal[ks] - pal[i]) ** 2 * np.array(CW)).sum(1)
            remap[i] = int(ks[d.argmin()])
        used = sorted(keep)
    slot = {int(c): col0 + k for k, c in enumerate(used)}
    for i, j in remap.items():
        slot[int(i)] = slot[j]
    used_total.update(int(c) for c in used)
    # Per frame index images, trimmed.
    frames = []
    for name, c, f, cidx, team, mask, sh, ol, geom in items:
        H, W = mask.shape
        ind = np.zeros((H, W), np.uint8)
        shv = np.clip(sh, 0, SH_LEVELS)
        sm = (~mask) & (~ol) & (shv > 0)
        ind[sm] = (sh0 + shv[sm] - 1).astype(np.uint8)
        olv = np.clip(np.maximum(shv, OUTLINE_MIN), OUTLINE_MIN, SH_LEVELS)
        om = (~mask) & ol
        ind[om] = (ol0 + olv[om] - OUTLINE_MIN).astype(np.uint8)
        tm = mask & (team >= 0)
        ind[tm] = (team0 + team[tm]).astype(np.uint8)
        cm = mask & (team < 0)
        lut = np.zeros(len(PAL) // 3, np.uint8)
        for k, v in slot.items():
            lut[k] = v
        ind[cm] = lut[cidx[cm]]
        ys, xs = np.nonzero(ind)
        if len(ys) == 0:
            ys, xs = np.array([0]), np.array([0])
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        my, mx = np.nonzero(mask)
        body = [int(mx.min()), int(my.min()), int(mx.max()) + 1, int(my.max()) + 1] if len(my) else [0, 0, 1, 1]
        frames.append((name, c, f, ind[y0:y1, x0:x1], (x0, y0), body, geom))
    # Shelf pack into pages (state by state, facing rows).
    pages = []
    cur = []
    x = y = rowh = 0
    placed = []
    for fr in frames:
        im = fr[3]
        h, w = im.shape
        if x + w > PAGE_W:
            x = 0
            y += rowh + 1
            rowh = 0
        if y + h > PAGE_H_MAX:
            pages.append((cur, y + rowh))
            cur = []
            x = y = rowh = 0
        cur.append((fr, x, y))
        placed.append((fr, len(pages), x, y))
        x += w + 1
        rowh = max(rowh, h)
    pages.append((cur, y + rowh))
    plte = np.zeros((256, 3), np.uint8)
    trns = np.zeros(256, np.uint8)
    for k in range(n_sh):
        trns[sh0 + k] = round((k + 1) / SH_LEVELS * 255)
    for k in range(n_ol):
        trns[ol0 + k] = round((OUTLINE_MIN + k) / SH_LEVELS * 255)
    tr = team_ramp_preview()
    for k in range(TEAM_LEVELS):
        plte[team0 + k] = tr[k]
        trns[team0 + k] = 255
    for c, s in slot.items():
        if c in remap:
            continue
        plte[s] = np.clip(np.round(pal[c]), 0, 255)
        trns[s] = 255
    page_files = []
    for pi, (lst, ph) in enumerate(pages):
        sheet = np.zeros((max(1, ph), PAGE_W), np.uint8)
        for fr, px, py in lst:
            im = fr[3]
            sheet[py:py + im.shape[0], px:px + im.shape[1]] = im
        img = Image.fromarray(sheet, 'P')
        img.putpalette(plte.reshape(-1).tolist())
        fn = '%s-%d.png' % (spec['name'], pi)
        img.save(os.path.join(OUT, fn), optimize=True, transparency=bytes(trns.tolist()))
        page_files.append(fn)
    st_frames = {k: [None] * (v['frames'] * v['facings']) for k, v in states_meta.items()}
    icon = None
    for (name, c, f, im, off, body, geom), pi, px, py in placed:
        if name == 'icon':
            icon = [pi, px, py, im.shape[1], im.shape[0]]
            continue
        w_, h_, ax, ay = geom
        nf = states_meta[name]['frames']
        # [page, x, y, w, h, offX, offY, bodyX0, bodyY0, bodyX1, bodyY1]; offsets and body box relative to the
        # sub-frame's top-left (the frame is `size`, the ground anchor `anchor`).
        st_frames[name][c * nf + f] = [pi, px, py, im.shape[1], im.shape[0], off[0], off[1], *body]
    geom0 = items[0][8]
    meta = {
        'version': 1,
        'name': spec['name'],
        'size': [geom0[0], geom0[1]],
        'anchor': [geom0[2], geom0[3]],
        'pages': page_files,
        'shadow': [sh0, n_sh],
        'outline': [ol0, n_ol],
        'team': [team0, TEAM_LEVELS],
        'states': {k: dict(v, f=st_frames[k]) for k, v in states_meta.items()},
    }
    if 'variants' in spec:
        meta['variants'] = spec['variants']
    if icon is not None:
        # HUD portrait (rendered larger): [page, x, y, w, h], figure layer only.
        meta['icon'] = icon
    with open(os.path.join(OUT, spec['name'] + '.json'), 'w') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in page_files)
    print('  %-12s %4d frames, %d colours, %d page(s), %6.1f KB' % (spec['name'], len(frames), len(used), len(page_files), size / 1024), flush=True)
    return size


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    only = [a for a in argv if not a.startswith('--')]
    q = Quantizer(PAL)
    hist = np.zeros(32768, np.int64)
    total = 0
    used_total = set()
    for spec in SPEC.sheets():
        if only and spec['name'] not in only:
            continue
        r = build_sheet(spec, q, hist)
        if r is None:
            continue
        states_meta, items = r
        total += assemble(spec, states_meta, items, used_total)
    if not only:
        nz = np.nonzero(hist)[0]
        json.dump({'weight': 0.6, 'bins': [[int(b), int(hist[b])] for b in nz]}, open(HIST, 'w'), separators=(',', ':'))
    print('total %.1f KB, %d shared colours used' % (total / 1024, len(used_total)))


if __name__ == '__main__':
    main(sys.argv[1:])
