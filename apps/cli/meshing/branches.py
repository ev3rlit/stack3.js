"""Match connected cross-section regions per slab; interpolate each overlap group separately."""

from collections import Counter

import numpy as np
from geometry import cyclic, indexed, xyz
from implicit import iso
from scipy.ndimage import distance_transform_edt, label
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def section_field(mask, pitch):
    if not mask.any():
        return None
    padded = np.pad(mask, 1)
    return distance_transform_edt(padded, sampling=pitch) - distance_transform_edt(~padded, sampling=pitch)


def branch_loft(mask, step, axis):
    u, v, _ = cyclic(axis)
    slices = mask.transpose(cyclic(axis))
    previous = np.zeros(slices.shape[:2], dtype=int)
    triangles, events = [], Counter()
    for k in range(slices.shape[2] + 1):
        current, nc = label(slices[:, :, k]) if k < slices.shape[2] else (np.zeros_like(previous), 0)
        nparts = int(previous.max())
        if nparts + nc == 0:
            continue
        # Vertices of this bipartite graph are filled regions including their holes.
        both = (previous != 0) & (current != 0)
        rows, cols = previous[both] - 1, nparts + current[both] - 1
        graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nparts + nc, nparts + nc))
        count, groups = connected_components(graph, directed=False)
        for group in range(count):
            aa, bb = (
                np.flatnonzero(groups[:nparts] == group) + 1,
                np.flatnonzero(groups[nparts:] == group) + 1,
            )
            if len(aa) != 1 or len(bb) != 1:
                events[f"{len(aa)}->{len(bb)}"] += 1
            a, b = np.isin(previous, aa), np.isin(current, bb)
            ij = np.argwhere(a | b)
            lo, hi = ij.min(axis=0), ij.max(axis=0) + 1

            crop = np.s_[lo[0] : hi[0], lo[1] : hi[1]]
            d0, d1 = (section_field(layer[crop], step[[u, v]]) for layer in (a, b))
            if d0 is None:
                fields = [-abs(d1), d1]
            elif d1 is None:
                fields = [d0, -abs(d0)]
            else:
                # Sample the intermediate signed-distance contour at splits and joins.
                middle = (d0 + d1) * 0.5
                middle[middle == 0] = -0.001 * min(step[u], step[v])
                fields = [d0, middle, d1]
            p, f = iso(np.stack(fields, axis=2), 0)
            p = p.astype(float) * [1, 1, 1 / (len(fields) - 1)] + [*(lo - 0.5), k - 0.5]
            triangles.extend(p[f])
        previous = current
    print("branch overlap events:", dict(events))
    return indexed(xyz(triangles, axis))
