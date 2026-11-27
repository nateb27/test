"""Animation helpers: the Anim record the render driver consumes and keyframe interpolation of pose dicts.

A pose is (rot, loc): rot maps bone -> (x, y, z) Euler degrees, loc maps bone -> (x, y, z) in bone space (for the
human root bone y is up, z is forward... see humans.py)."""
import math


class Anim:
    def __init__(self, name, frames, pose, props=(), extra=None, facings=None, loop=True, cycle=None, frame_ms=None, zoom=1.0):
        self.name = name
        self.frames = frames
        self.pose = pose
        self.props = set(props) if not callable(props) else props
        self.extra = extra
        self.facings = list(facings) if facings is not None else list(range(8))
        self.loop = loop
        # Ground distance (tiles) covered by one full cycle of a locomotion animation (walk, carry): the game
        # advances its frames by distance travelled so the feet do not slide.
        self.cycle = cycle
        self.frame_ms = frame_ms
        # HUD portrait: rendered larger (one frame, one facing).
        self.zoom = zoom


def ease(t):
    return t * t * (3 - 2 * t)


def lerp_pose(a, b, t):
    ra, la = a
    rb, lb = b
    rot = {}
    for k in set(ra) | set(rb):
        x = ra.get(k, (0, 0, 0))
        y = rb.get(k, (0, 0, 0))
        rot[k] = tuple(x[i] + (y[i] - x[i]) * t for i in range(3))
    loc = {}
    for k in set(la) | set(lb):
        x = la.get(k, (0, 0, 0))
        y = lb.get(k, (0, 0, 0))
        loc[k] = tuple(x[i] + (y[i] - x[i]) * t for i in range(3))
    return rot, loc


def merge(base, over):
    """Pose `over` on top of `base` (bones in `over` replace those in `base`)."""
    r = dict(base[0])
    r.update(over[0])
    l = dict(base[1])
    l.update(over[1])
    return r, l


def keyed(keys, n, loop=False):
    """keys: list of (t, pose) with t in 0..1 ascending. Returns a function i -> pose for n frames.
    One-shot animations sample t = i / (n - 1); loops sample t = i / n and wrap to the first key."""
    ks = list(keys)
    if loop and ks[-1][0] < 1.0:
        ks = ks + [(1.0, ks[0][1])]

    def f(i):
        t = i / n if loop else i / max(1, n - 1)
        for (t0, p0), (t1, p1) in zip(ks[:-1], ks[1:]):
            if t <= t1 + 1e-9:
                u = 0.0 if t1 <= t0 else (t - t0) / (t1 - t0)
                return lerp_pose(p0, p1, ease(min(1.0, max(0.0, u))))
        return ks[-1][1]
    return f


def P(rot=None, loc=None):
    return (rot or {}, loc or {})


def sinp(p, k=1.0, ph=0.0):
    return math.sin(2 * math.pi * (p * k + ph))
