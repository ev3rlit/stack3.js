"""Capture solid intervals and surface normals along a registered axis grid."""
import numpy as np


def capture(parts, axis, grid, origin, step):
    transverse = [i for i in range(3) if i != axis]
    coords = np.indices(grid[transverse]).reshape(2, -1).T
    starts = np.tile(origin, (len(coords), 1))
    starts[:, transverse] += (coords + .5) * step[transverse]
    starts[:, axis] -= step[axis]
    direction = np.tile(np.eye(3)[axis], (len(coords), 1))
    intervals = [[] for _ in starts]
    for mesh in parts:
        # Keep distinct solids separate here: touching/overlapping joinery must
        # contribute its union, not toggle the parity of the combined triangle soup.
        hits, rays, faces = mesh.ray.intersects_location(starts, direction)
        if not len(hits):
            continue
        depths = hits[:, axis] - origin[axis]
        normals = mesh.face_normals[faces]
        order = np.lexsort((depths, rays))
        for group in np.split(order, np.flatnonzero(np.diff(rays[order])) + 1):
            if len(group) % 2 or np.any(normals[group[::2], axis] >= 0) or np.any(normals[group[1::2], axis] <= 0):
                raise ValueError(f"Unpaired intersection on axis {axis}, ray {rays[group[0]]}")
            for a, b in group.reshape(-1, 2):
                intervals[rays[a]].append((depths[a], depths[b], normals[a], normals[b]))

    offsets, depth, normals = [0], [], []
    occupancy = np.zeros((len(starts), grid[axis]), dtype=bool)
    centers = (np.arange(grid[axis]) + .5) * step[axis]
    for i, row in enumerate(intervals):
        union = []
        for lo, hi, enter, leave in sorted(row, key=lambda iv: iv[0]):
            if union and lo <= union[-1][1] + 1e-8:
                if hi > union[-1][1]:
                    union[-1][1], union[-1][3] = hi, leave
            else:
                union.append([lo, hi, enter, leave])
        for lo, hi, enter, leave in union:
            depth.extend([max(lo, 0), min(hi, grid[axis] * step[axis])])
            normals.extend([enter, leave])
            occupancy[i] |= (centers >= lo) & (centers < hi)
        offsets.append(len(depth))
    arrays = dict(offsets=np.array(offsets, np.uint32), depth=np.array(depth), normals=np.array(normals))
    mask = np.moveaxis(occupancy.reshape(*grid[transverse], grid[axis]), -1, axis)
    return arrays, mask
