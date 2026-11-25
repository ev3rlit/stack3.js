"""Coordinates are XYZ cell-boundary indices until export. All permutations are cyclic."""

import numpy as np
import shapely as sh
from shapely.geometry import Polygon


def cyclic(axis):
    return (axis + 1) % 3, (axis + 2) % 3, axis


def xyz(uvt, axis):
    return np.asarray(uvt)[..., np.argsort(cyclic(axis))]


def unit(v):
    length = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(length, 1e-30)


def indexed(triangles):
    points = np.asarray(triangles, dtype=float).reshape(-1, 3)
    if not len(points):
        raise ValueError("no surface in the supplied stack and guide")
    _, keep, ids = np.unique(points.round(10), axis=0, return_index=True, return_inverse=True)
    return points[keep], ids.reshape(-1, 3)


def runs(row):
    changes = np.flatnonzero(np.diff(row.astype(np.int8), prepend=0, append=0))
    return list(zip(changes[::2], changes[1::2]))


def region(mask):
    rects = [sh.box(lo, y, hi, y + 1) for y, row in enumerate(mask.T) for lo, hi in runs(row)]
    return sh.union_all(rects).simplify(0)


def polygons(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == "Polygon":
        return [shape]
    return [poly for child in getattr(shape, "geoms", []) for poly in polygons(child)]


def planar_triangles(poly):
    return [
        np.asarray(sh.orient_polygons(t).exterior.coords)[:3]
        for t in sh.constrained_delaunay_triangles(poly).geoms
    ]


def profile(data):
    if not isinstance(data, dict) or "outer" not in data:
        raise ValueError("profile needs outer and optional holes")
    rings = [data["outer"], *data.get("holes", [])]
    for ring in rings:
        r = np.asarray(ring, dtype=float)
        if r.ndim != 2 or r.shape[1] != 2 or len(r) < 3 or not np.isfinite(r).all():
            raise ValueError("expected finite closed 2D polygon loops (at least three points)")
    poly = Polygon(rings[0], rings[1:])
    if not poly.is_valid or poly.area <= 0:
        raise ValueError("self-intersecting, overlapping or empty profile loops")
    return sh.orient_polygons(poly)


def connect(a, b):
    """Join two consistently oriented outer (CCW) or hole (CW) station loops."""
    c, d = np.roll(a, -1, axis=0), np.roll(b, -1, axis=0)
    return np.concatenate((np.stack((a, c, d), axis=1), np.stack((a, d, b), axis=1)))
