import itertools

import numpy as np
import shapely as sh
from geometry import (
    connect,
    cyclic,
    indexed,
    planar_triangles,
    polygons,
    profile,
    region,
    xyz,
)
from scipy.interpolate import PchipInterpolator
from scipy.optimize import linear_sum_assignment
from shapely.geometry import Polygon


def heightfield(mask, axis):
    stack = mask.transpose(cyclic(axis))
    filled = stack.any(axis=2)
    starts = stack & ~np.pad(stack[:, :, :-1], ((0, 0), (0, 0), (1, 0)))
    multiple = int((starts.sum(axis=2) > 1).sum())
    print(f"heightfield filled {multiple} multi-interval columns")
    low = stack.argmax(axis=2)
    high = stack.shape[2] - stack[:, :, ::-1].argmax(axis=2)
    # Average the column endpoints incident on each footprint corner.
    count = np.zeros(np.array(filled.shape) + 1)
    heights = np.zeros((*count.shape, 2))
    for i in (0, 1):
        for j in (0, 1):
            area = np.s_[i : i + filled.shape[0], j : j + filled.shape[1]]
            count[area] += filled
            heights[area] += np.stack((low, high), axis=2) * filled[:, :, None]
    heights /= np.maximum(count, 1)[:, :, None]
    triangles = []
    offsets = np.array([[0, 0], [1, 0], [1, 1], [0, 1]])
    for x, y in np.argwhere(filled):
        uv = offsets + [x, y]
        lo, hi = [np.column_stack((uv, heights[uv[:, 0], uv[:, 1], i])) for i in (0, 1)]
        triangles.extend(lo[[[2, 1, 0], [3, 2, 0]]])
        triangles.extend(hi[[[0, 1, 2], [0, 2, 3]]])
        for i, (dx, dy) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
            a, b = x + dx, y + dy
            if 0 <= a < filled.shape[0] and 0 <= b < filled.shape[1] and filled[a, b]:
                continue
            j = (i + 1) % 4
            triangles.extend(([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]]))
    return indexed(xyz(triangles, axis))


def match(previous, current):
    if len(previous) != len(current):
        raise ValueError("section loop count changes; choose branch-loft")
    if not previous:
        return []
    overlap = np.array([[a.intersection(b).area for b in current] for a in previous])
    rows, cols = linear_sum_assignment(-overlap)
    if (overlap[rows, cols] <= 0).any():
        raise ValueError("no overlapping section correspondence; choose branch-loft")
    return [current[j] for j in cols]


def sample_ring(ring, count, metric, prev):
    p = np.asarray(ring.coords) * metric
    distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    stations = np.arange(count) * distance[-1] / count
    pts = np.column_stack([np.interp(stations, distance, p[:, i]) for i in (0, 1)])
    if prev is not None:
        prev = prev * metric
        # Circular least-squares alignment, including the wraparound seam.
        costs = [np.square(np.roll(pts, shift, axis=0) - prev).sum() for shift in range(count)]
        pts = np.roll(pts, np.argmin(costs), axis=0)
    return pts / metric


def loft(mask, step, origin, axis, smooth, controls):
    u, v, _ = cyclic(axis)
    metric = step[[u, v]]
    stack = mask.transpose(cyclic(axis))
    occupied = np.flatnonzero(stack.any(axis=(0, 1)))
    if np.any(np.diff(occupied) != 1):
        raise ValueError("empty intermediate section; choose branch-loft")
    overrides = {}
    if controls is not None:
        if not isinstance(controls, list) or not controls:
            raise ValueError("stations must be a nonempty list of slice objects")
        from shapely.affinity import affine_transform

        for station in controls:
            if not isinstance(station, dict) or set(station) - {"slice", "outer", "holes"}:
                raise ValueError("station needs slice and optional outer and holes")
            k = station.get("slice")
            if type(k) is not int or k not in occupied or k in overrides:
                raise ValueError(f"duplicate or unoccupied control slice: {k}")
            polygon = None
            if "outer" in station or "holes" in station:
                polygon = affine_transform(
                    profile(station),
                    [1 / step[u], 0, 0, 1 / step[v], -origin[u] / step[u], -origin[v] / step[v]],
                )
                bounds = sh.box(0, 0, stack.shape[0], stack.shape[1])
                if not bounds.buffer(1e-9).covers(polygon):
                    raise ValueError(f"control contour leaves part frame at slice {k}")
            overrides[k] = polygon
        print(
            "loft control slices:",
            sorted(overrides),
            "user contours:",
            sorted(k for k, p in overrides.items() if p is not None),
        )
    series = []
    for k in occupied:
        current = [sh.orient_polygons(p) for p in polygons(region(stack[:, :, k]))]
        replacement = overrides.get(k)
        if replacement is not None:
            if len(current) != 1 or replacement.intersection(current[0]).area == 0:
                raise ValueError(f"control contour does not match a unique occupied part at slice {k}")
            current = [replacement]
        series.append(match(series[-1], current) if series else current)
    triangles = []
    for parts in zip(*series):
        tracks = [[p.exterior for p in parts]]
        ordered_holes = []
        for part in parts:
            holes = [Polygon(h) for h in part.interiors]
            ordered_holes.append(match(ordered_holes[-1], holes) if ordered_holes else holes)
        selected = [
            i
            for i, k in enumerate(occupied)
            if not overrides or k in overrides or i in (0, len(occupied) - 1)
        ]
        tracks.extend([[h.exterior for h in group] for group in zip(*ordered_holes)])
        tracks = [[track[i] for i in selected] for track in tracks]
        stations = np.r_[occupied[0], occupied[selected] + 0.5, occupied[-1] + 1]
        samples = stations
        if smooth:
            intervals = [
                np.linspace(a, b, max(2, int(np.ceil((b - a) * 2))), endpoint=False)
                for a, b in itertools.pairwise(stations)
            ]
            samples = np.concatenate([*intervals, stations[-1:]])
        surfaces = []
        for track in tracks:
            count = min(512, max(16, 4 * max(len(r.coords) for r in track)))
            rings = []
            for r in track:
                rings.append(sample_ring(r, count, metric, rings[-1] if rings else None))
            rings = np.array([rings[0], *rings, rings[-1]])
            if smooth:
                rings = PchipInterpolator(stations, rings, axis=0)(samples)
            surfaces.append(rings)
            points = [np.column_stack((r, np.full(count, t))) for r, t in zip(rings, samples)]
            for a, b in itertools.pairwise(points):
                triangles.extend(connect(a, b))
        for i, t in enumerate(samples):
            section = Polygon(surfaces[0][i], [hole[i] for hole in surfaces[1:]])
            if not section.is_valid:
                raise ValueError(f"loft self-intersects at station {t}; choose branch-loft")
            if i in (0, len(samples) - 1):
                for tri in planar_triangles(section):
                    cap = np.column_stack((tri, np.full(3, t)))
                    triangles.append(cap[::-1] if i == 0 else cap)
    return indexed(xyz(triangles, axis))
