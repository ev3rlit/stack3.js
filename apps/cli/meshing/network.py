"""Registered planar constraints blended into the stack distance field, with measured re-cuts."""

from itertools import combinations

import numpy as np
import shapely as sh
from geometry import profile, unit
from guided import vector
from implicit import iso
from scipy.ndimage import distance_transform_edt, map_coordinates
from shapely.geometry import LineString, MultiLineString


def registered(data, box_min, box_max):
    if not isinstance(data, dict) or data.get("source") != "independent":
        raise ValueError("each section must declare source independent (actual cuts only)")
    origin, u, v = [vector(data, name) for name in ("origin", "u", "v")]
    if not np.allclose([u @ u, v @ v, u @ v], [1, 1, 0], atol=1e-7, rtol=0):
        raise ValueError("section u and v must be orthonormal unit vectors")
    uv = np.stack((u, v))
    shape = profile(data)
    pts = sh.get_coordinates(shape) @ uv + origin
    if np.any(pts < box_min - 1e-8) or np.any(pts > box_max + 1e-8):
        raise ValueError("section leaves the saved part frame")
    return origin, uv, np.cross(u, v), shape


def line_intervals(section, on_line, direction, span):
    origin, uv, _, polygon = section
    endpoints = on_line + np.array([[-2 * span], [2 * span]]) * direction
    hit = polygon.intersection(LineString((endpoints - origin) @ uv.T))
    spans = []
    for piece in sh.get_parts(hit):
        if piece.is_empty:
            continue
        points = sh.get_coordinates(piece) @ uv + origin
        t = (points - on_line) @ direction
        spans.append((t.min(), t.max()))
    merged = []
    for low, high in sorted(spans):
        if merged and low <= merged[-1][1] + span * 1e-8:
            merged[-1][1] = max(high, merged[-1][1])
        else:
            merged.append([low, high])
    return np.asarray(merged).reshape(-1, 2)


def check_pairs(sections, center, span):
    crossing = False
    for a, b in combinations(sections, 2):
        direction = np.cross(a[2], b[2])
        if np.linalg.norm(direction) < 1e-8:
            if abs((a[0] - b[0]) @ a[2]) < span * 1e-8:
                raise ValueError("duplicate section planes")
            continue
        direction = unit(direction)
        on_line = center + np.linalg.solve(
            [a[2], b[2], direction], [(a[0] - center) @ a[2], (b[0] - center) @ b[2], 0]
        )
        first, second = (line_intervals(section, on_line, direction, span) for section in (a, b))
        if len(first) != len(second) or not np.allclose(first, second, rtol=0, atol=span * 1e-6):
            raise ValueError("independent contours disagree along their plane intersection")
        crossing |= np.any(first[:, 1] - first[:, 0] > span * 1e-8)
    if not crossing:
        raise ValueError("need nonparallel independent sections crossing inside the part")


def recut(verts, faces, section, tolerance):
    origin, uv, normal, target = section
    distance = (verts - origin) @ normal
    # Half-open predicate counts a cut passing through a vertex just once.
    tri = faces[(distance[faces].min(axis=1) < 0) & (distance[faces].max(axis=1) >= 0)]
    hits = [[] for _ in range(len(tri))]
    for j in range(3):
        a, b = tri[:, j], tri[:, (j + 1) % 3]
        cut = np.flatnonzero((distance[a] < 0) != (distance[b] < 0))
        t = distance[a[cut]] / (distance[a[cut]] - distance[b[cut]])
        p = verts[a[cut]] + (verts[b[cut]] - verts[a[cut]]) * t[:, None]
        for i, point in zip(cut, (p - origin) @ uv.T):
            hits[i].append(point)
    if not hits:
        return np.inf, False
    lines = sh.set_precision(MultiLineString(hits), tolerance * 1e-5)
    area = sh.build_area(sh.union_all(sh.get_parts(lines)))
    if area.is_empty:
        return np.inf, False
    same = sh.get_num_geometries(area) == 1 and sh.get_num_interior_rings(area) == len(target.interiors)
    return float(sh.hausdorff_distance(area.boundary, target.boundary, densify=0.25)), same


def section_network(mask, step, origin, guide):
    data = guide.get("sections")
    if not isinstance(data, list) or len(data) < 2:
        raise ValueError("sections must contain at least two independent cuts")
    extent = np.array(mask.shape) * step
    sections = [registered(d, origin, origin + extent) for d in data]
    check_pairs(sections, origin + extent * 0.5, np.linalg.norm(extent))
    padded = np.pad(mask, 1)
    prior = distance_transform_edt(padded, sampling=step) - distance_transform_edt(~padded, sampling=step)
    tolerance = guide.get("tolerance", np.linalg.norm(step) * 0.6)
    if not isinstance(tolerance, (int, float)) or not np.isfinite(tolerance) or tolerance <= 0:
        raise ValueError("tolerance must be a positive distance in scene units")
    for factor in (2, 4):
        dimensions = np.array(mask.shape) * factor + 3
        if np.prod(dimensions) > 40_000_000:
            raise ValueError("section-network refinement exceeds 40 million samples")
        field = np.empty(dimensions, dtype=np.float32)
        yz = np.indices(dimensions[1:]).reshape(2, -1).T
        for x in range(dimensions[0]):
            grid = (np.column_stack((np.full(len(yz), x), yz)) - 1) / factor
            p = grid * step + origin
            field_sum = map_coordinates(prior, (grid + 0.5).T, order=1, mode="nearest")
            weights = np.ones(len(p))
            for o, uv, n, shape in sections:
                dist = np.abs((p - o) @ n)
                radius = 3 * np.linalg.norm(step)
                near = dist < radius
                coords = (p[near] - o) @ uv.T
                pts = sh.points(coords)
                signed = sh.distance(pts, shape.boundary) * np.where(sh.contains_xy(shape, *coords.T), 1, -1)
                w = (1 - dist[near] / radius) ** 2 / np.maximum(dist[near] / radius, 1e-7) ** 2
                field_sum[near] += w * signed
                weights[near] += w
            field[x] = (field_sum / weights).reshape(dimensions[1:])
        for a in range(3):
            border = np.moveaxis(field, a, 0)
            border[[0, -1]] = -min(step) / factor
        p, f = iso(field, 0)
        p = (p - 1) / factor
        results = [recut(p * step + origin, f, s, tolerance) for s in sections]
        if all(ok and d <= tolerance for d, ok in results):
            print(
                f"independent re-cut Hausdorff distances {[round(d, 8) for d, _ in results]}, tolerance {tolerance:g}"
            )
            return p, f
    raise ValueError(f"re-cut exceeds tolerance or has wrong loop count: {results}")
