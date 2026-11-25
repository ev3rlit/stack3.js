"""Partition directed exposed-face masks, then conform seams across all three plane families."""

from collections import defaultdict

import numpy as np
import shapely as sh
from geometry import cyclic, indexed, planar_triangles, runs, xyz
from shapely.geometry import Polygon


def rectangles(mask):
    mask = mask.copy()
    for y, row in enumerate(mask.T):
        for x in np.flatnonzero(row):
            if not mask[x, y]:
                continue
            hi = x + 1
            while hi < len(row) and mask[hi, y]:
                hi += 1
            end = y + 1
            while end < mask.shape[1] and mask[x:hi, end].all():
                end += 1
            mask[x:hi, y:end] = False
            yield sh.box(x, y, hi, end)


def monotone_regions(mask):
    # A chain of one-to-one overlapping scan runs is y-monotone. Close chains
    # at splits and joins; no polygon crosses a hole or bridges two islands.
    active = {}
    for y, row in enumerate(np.vstack((mask.T, np.zeros(mask.shape[0], bool)))):
        current = runs(row)
        links = {r: [p for p in active if max(r[0], p[0]) < min(r[1], p[1])] for r in current}
        degree = defaultdict(int)
        for prev in links.values():
            for p in prev:
                degree[p] += 1
        next_active = {}
        for r, prev in links.items():
            pieces = active.pop(prev[0]) if len(prev) == 1 and degree[prev[0]] == 1 else []
            pieces.append(sh.box(r[0], y, r[1], y + 1))
            next_active[r] = pieces
        for pieces in active.values():
            yield sh.union_all(pieces).simplify(0)
        active = next_active


def block_mesh(mask, monotone):
    panels = []
    lines = defaultdict(set)
    for axis in range(3):
        slices = mask.transpose(cyclic(axis))
        for sign in (-1, 1):
            neighbor = np.roll(slices, -sign, axis=2)
            neighbor[:, :, -1 if sign > 0 else 0] = False
            exposed = slices & ~neighbor
            for k in np.flatnonzero(exposed.any(axis=(0, 1))):
                partition = monotone_regions if monotone else rectangles
                for poly in partition(exposed[:, :, k]):
                    ring = np.asarray(sh.orient_polygons(poly).exterior.coords[:-1], dtype=int)
                    points = xyz(np.column_stack((ring, np.full(len(ring), k + (sign > 0)))), axis)
                    for p in points:
                        for a, (u, v, _) in enumerate(map(cyclic, range(3))):
                            lines[a, p[u], p[v]].add(p[a])
                    panels.append((axis, sign, points))
    triangles = []
    for axis, sign, points in panels:
        boundary = []
        for p, q in zip(points, np.roll(points, -1, axis=0)):
            a = np.flatnonzero(p != q).item()
            u, v, _ = cyclic(a)
            stops = sorted(t for t in lines[a, p[u], p[v]] if min(p[a], q[a]) < t < max(p[a], q[a]))
            boundary.append(p)
            for t in stops if p[a] < q[a] else reversed(stops):
                point = p.copy()
                point[a] = t
                boundary.append(point)
        u, v, _ = cyclic(axis)
        for tri in planar_triangles(Polygon(np.asarray(boundary)[:, [u, v]])):
            face = xyz(np.column_stack((tri, np.full(3, points[0, axis]))), axis)
            triangles.append(face if sign > 0 else face[::-1])
    return indexed(triangles)
