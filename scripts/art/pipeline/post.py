"""Post-processing (numpy only, no bpy): supersampled linear render -> 1x sprite layers.

The tone map, team-level mapping and the small-figure readability pass are ports of the in-browser voxel
renderer (src/client/art/rendered/light.ts toDisplay, render.ts team levels and unitPost) and read the same
constants (artConstants.json), so both kinds of sprite look alike.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CONST = json.load(open(os.path.join(REPO, 'src', 'client', 'art', 'rendered', 'artConstants.json')))
LIGHT = CONST['light']
TEAM_LEVELS = CONST['team']['levels']
TEAM_LUM = CONST['team']['lumDivisor']

COVER = 0.5          # a pixel is figure when at least half of it is covered (hard 1-bit alpha, never a fringe)


def box_down(img, ss):
    h, w = img.shape[:2]
    ho, wo = h // ss, w // ss
    x = img[:ho * ss, :wo * ss]
    if x.ndim == 2:
        return x.reshape(ho, ss, wo, ss).mean(axis=(1, 3))
    return x.reshape(ho, ss, wo, ss, x.shape[2]).mean(axis=(1, 3))


def to_display(lin, exposure_mul=1.0):
    """Port of light.ts toDisplay: linear radiance -> display 0..255 (float)."""
    ex = LIGHT['exposure'] * exposure_mul
    v = np.sqrt(1 - np.exp(-np.maximum(lin, 0) * ex))
    l = (0.3 * v[..., 0] + 0.59 * v[..., 1] + 0.11 * v[..., 2])[..., None]
    v = l + (v - l) * LIGHT['sat']
    v = 0.5 + (v - 0.5) * LIGHT['contrast']
    return np.clip(v, 0, 1) * 255


def lum(rgb):
    return 0.3 * rgb[..., 0] + 0.59 * rgb[..., 1] + 0.11 * rgb[..., 2]


def team_levels(rgb, team):
    """Ramp level per team pixel from its display luminance (render.ts), with the same 2x2 ordered dither."""
    h, w = team.shape
    yy, xx = np.mgrid[0:h, 0:w]
    bayer = (((xx & 1) ^ (yy & 1)) * 2 + (yy & 1)) / 4 - 0.375
    lf = np.minimum(0.999, lum(rgb) / TEAM_LUM)
    lv = np.clip(np.floor(lf * TEAM_LEVELS + bayer), 0, TEAM_LEVELS - 1).astype(np.int16)
    return np.where(team, lv, -1)


def unit_post(rgb, alpha, mask, sharpen=0.55, edge=0.8, outline=0.5):
    """Port of render.ts unitPost: unsharp mask on figure pixels, darker inner silhouette edge, soft dark outline."""
    h, w = mask.shape
    m = mask
    pad = np.pad(m, 1)
    nb = [pad[1:-1, 2:], pad[1:-1, :-2], pad[2:, 1:-1], pad[:-2, 1:-1]]
    src = rgb.copy()
    sp = np.pad(src, ((1, 1), (1, 1), (0, 0)))
    sn = [sp[1:-1, 2:], sp[1:-1, :-2], sp[2:, 1:-1], sp[:-2, 1:-1]]
    acc = np.zeros_like(src)
    cnt = np.zeros((h, w))
    for s, n in zip(sn, nb):
        acc += s * n[..., None]
        cnt += n
    avg = np.where(cnt[..., None] > 0, acc / np.maximum(cnt, 1)[..., None], src)
    out = src + sharpen * (src - avg)
    is_edge = cnt < 4
    out = np.where(is_edge[..., None], out * edge, out)
    rgb = np.where(m[..., None], np.clip(out, 0, 255), rgb)
    touch = np.zeros((h, w), bool)
    for n in nb:
        touch |= n
    alpha = np.where((~m) & touch, np.maximum(alpha, outline), alpha)
    return rgb, alpha


def to_layers(rgba, catcher, team, ss, unit=True, exposure_mul=1.0, shadow_mul=1.0):
    """rgba: premultiplied linear RGBA at ss x; catcher: light ratio (1 = unshadowed); team: team coverage.
    Returns dict(rgb display float (h, w, 3), mask bool, team level int16 (-1 = not team), shadow alpha float)."""
    a4 = np.clip(rgba[..., 3], 0, 1)
    a = box_down(a4, ss)
    col = box_down(rgba[..., :3], ss)
    mask = a >= COVER
    lin = np.where(a[..., None] > 1e-4, col / np.maximum(a, 1e-4)[..., None], 0)
    rgb = to_display(lin, exposure_mul)
    tcov = box_down(team, ss)
    is_team = mask & (tcov >= 0.5 * np.maximum(a, 1e-4))
    # Shadow: the fraction of light the figure takes away from the ground, measured where the ground shows.
    g4 = 1 - a4
    gsum = box_down(g4, ss)
    shad = box_down((1 - np.clip(catcher, 0, 1)) * g4, ss) / np.maximum(gsum, 1e-4)
    shad = np.clip(shad * shadow_mul, 0, 1)
    shad = np.where(mask | (gsum < 1e-3), 0, shad)
    shad = np.round(shad * 20) / 20
    shad[shad < 0.06] = 0
    outline = np.zeros_like(shad)
    if unit:
        rgb, outline = unit_post(rgb, outline, mask)
    lv = team_levels(rgb, is_team)
    return dict(rgb=rgb.astype(np.float32), mask=mask, team=lv, shadow=shad.astype(np.float32), outline=outline.astype(np.float32))
