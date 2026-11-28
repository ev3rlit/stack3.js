"""MC33, feature insertion in primal MC patches, and dual Hermite QEF extraction."""

from collections import defaultdict
from itertools import product

import numpy as np
from geometry import cyclic, unit
from scipy.ndimage import gaussian_filter, label
from skimage.measure import marching_cubes


def iso(field, level, method="lewiner"):
    verts, faces, _, _ = marching_cubes(
        field.astype(np.float32), level, method=method, gradient_direction="ascent", allow_degenerate=False
    )
    return verts, faces


def mc33(mask):
    p, f = iso(np.pad(mask, 1), 0.5)
    return p - 0.5, f


def feature_mesh(mask, step, dual, signed_distance=None, measured=None, *, surface_nets=False, regularized=False):
    field = np.pad(mask, 1)
    if dual:
        # A body diagonal can give two disjoint vertex links although every
        # resulting edge has incidence two. Test both signs before collapsing.
        corner_mask = np.zeros(np.array(field.shape) - 1, dtype=np.uint8)
        for bit, corner in enumerate(product((0, 1), repeat=3)):
            slices = tuple(slice(i, i + n) for i, n in zip(corner, corner_mask.shape))
            corner_mask |= field[slices].astype(np.uint8) << bit
        for code in np.unique(corner_mask):
            corners = ((int(code) >> np.arange(8)) & 1).reshape((2, 2, 2)).astype(bool)
            if label(corners)[1] > 1 or label(~corners)[1] > 1:
                cell = tuple((np.argwhere(corner_mask == code)[0] - 1).tolist())
                raise ValueError(f"multiple sheets in dual cell {cell}; use mc33")
    crosses = {}
    cells = defaultdict(list)
    if measured is None or signed_distance is not None:
        values = signed_distance if signed_distance is not None else -gaussian_filter(field.astype(float), 0.8)
        grads = np.stack(np.gradient(values, *step), axis=-1)
    for axis in range(3):
        u, v, _ = cyclic(axis)
        exposed = np.diff(field.astype(np.int8), axis=axis)
        # An uninterrupted coplanar 2x2 patch supports a flat sample-plane normal.
        # Isolated steps use the gradient of a filtered occupancy field instead.
        if measured is None and signed_distance is None:
            flat = np.zeros_like(exposed, bool)
            view = exposed.transpose(cyclic(axis))
            quads = (
                (view[:-1, :-1] != 0)
                & (view[:-1, :-1] == view[1:, :-1])
                & (view[:-1, :-1] == view[:-1, 1:])
                & (view[:-1, :-1] == view[1:, 1:])
            )
            for i, j in product(range(2), repeat=2):
                flat.transpose(cyclic(axis))[i : i + quads.shape[0], j : j + quads.shape[1]] |= quads
        for p in np.argwhere(exposed):
            key = (*p, axis)
            if measured is not None and (signed_distance is None or key in measured):
                crosses[key] = measured[key]
            else:
                q = p.copy()
                q[axis] += 1
                t = 0.5
                if signed_distance is not None:
                    start, end = values[tuple(p)], values[tuple(q)]
                    t = start / (start - end)
                n = unit((1 - t) * grads[tuple(p)] + t * grads[tuple(q)])
                if (signed_distance is None and flat[tuple(p)]) or np.linalg.norm(n) < 0.5:
                    n = -np.eye(3)[axis] * exposed[tuple(p)]
                crosses[key] = (p + t * (q - p), n)
            for du, dv in product(range(2), repeat=2):
                cell = p.copy()
                cell[u] -= du
                cell[v] -= dv
                cells[tuple(cell)].append(key)

    def solution(cell, keys):
        p, n = map(np.array, zip(*(crosses[k] for k in keys)))
        mean = p.mean(axis=0)
        if surface_nets:
            return mean, False
        # Solve in physical coordinates, centered at the mass point. SVD drops
        # unsupported directions; parallel planes then retain the mass point.
        rhs = np.einsum("ij,ij->i", n, (p - mean) * step)
        delta, _, rank, _ = np.linalg.lstsq(n, rhs, rcond=0.12)
        sharp = rank >= 2 and (n @ n.T).min() < 0.6
        if dual and (regularized or not sharp):
            # On nearly parallel constraints the tangential intersection is poorly
            # determined. Penalize drift from the centroid in those smooth cells.
            weight = 0.5 if regularized else 0.1
            delta = np.linalg.solve(n.T @ n + weight * len(n) * np.eye(3), n.T @ rhs)
        point = mean + delta / step
        lower = np.asarray(cell)
        if np.any(point < lower - 1e-7) or np.any(point > lower + 1 + 1e-7):
            # An extrapolated intersection on a sampled stair step is unreliable.
            # Clamping it to the wall can fold two neighboring dual quads together.
            point = mean
        else:
            point = np.clip(point, lower, lower + 1)
        return point, sharp

    if dual:
        reps, positions = {}, []
        for cell, keys in cells.items():
            reps[cell] = len(positions)
            positions.append(solution(cell, keys)[0])
        faces = []
        for key in crosses:
            p, axis = np.array(key[:3]), key[3]
            u, v, _ = cyclic(axis)
            e = np.eye(3, dtype=int)
            quad = [reps[tuple(c)] for c in (p, p - e[u], p - e[u] - e[v], p - e[v])]
            if not field[tuple(p)]:
                quad.reverse()
            a, b, c, d = quad
            faces.extend(((a, b, c), (a, c, d)))
        positions, faces = np.array(positions) - 0.5, np.array(faces)
        # Multiple disjoint sheets in one cell cannot share a dual representative.
        edges = np.sort(faces[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)
        if np.any(np.unique(edges, axis=0, return_counts=True)[1] != 2):
            raise ValueError("ambiguous dual cell joins multiple sheets; use mc33")
        return positions, faces

    p, f = iso(field, 0.5, "lorensen")
    patches = defaultdict(list)
    for tri in f:
        patches[tuple(np.floor(p[tri].mean(axis=0)).astype(int))].append(tri)
    # Store fans by their original MC boundary edge. Where two feature fans
    # meet, flip the shared diagonal to connect their feature vertices directly.
    positions = list(p)
    result = []
    fan_edges = {}
    for cell, patch in patches.items():
        point, sharp = solution(cell, cells[cell])
        if sharp:
            boundary = set()
            for a, b, c in patch:
                for i, j in ((a, b), (b, c), (c, a)):
                    if (j, i) in boundary:
                        boundary.remove((j, i))
                    else:
                        boundary.add((i, j))
            # Fan a single boundary loop. Keep disconnected/ambiguous MC patches intact.
            links = dict(boundary)
            start = next(iter(links))
            order, i = [], start
            while i not in order and i in links:
                order.append(i)
                i = links[i]
            if i == start and len(order) == len(boundary):
                fan = np.array([[p[a], p[b], point] for a, b in boundary])
                if np.all(
                    np.linalg.norm(np.cross(fan[:, 1] - fan[:, 0], fan[:, 2] - fan[:, 0]), axis=1) > 1e-9
                ):
                    feature = len(positions)
                    positions.append(point)
                    for a, b in zip(order, order[1:] + order[:1]):
                        face_id = len(result)
                        result.append([a, b, feature])
                        other = fan_edges.pop((b, a), None)
                        if other is None:
                            fan_edges[a, b] = face_id
                            continue
                        neighbor = result[other][2]
                        # Reject a folded or collapsed replacement.
                        old = np.array([[p[a], p[b], point], [p[b], p[a], positions[neighbor]]]) * step
                        new = (
                            np.array([[p[a], positions[neighbor], point], [p[b], point, positions[neighbor]]])
                            * step
                        )
                        reference = np.cross(old[:, 1] - old[:, 0], old[:, 2] - old[:, 0]).sum(axis=0)
                        normals = np.cross(new[:, 1] - new[:, 0], new[:, 2] - new[:, 0])
                        if np.all(normals @ reference > 0):
                            result[other] = [a, neighbor, feature]
                            result[face_id] = [b, feature, neighbor]
                    continue
        result.extend(patch)
    return np.asarray(positions) - 0.5, np.asarray(result)
