"""Broad-phase AABBs and the triangle separating-axis test for a transported profile."""

import numpy as np
from geometry import unit


def check_intersections(verts, faces):
    tris = verts[faces]
    lo, hi = tris.min(axis=1), tris.max(axis=1)
    eps = np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)) * 1e-10
    edges = np.roll(tris, -1, axis=1) - tris
    normals = unit(np.cross(edges[:, 0], edges[:, 1]))
    for i, tri in enumerate(tris):
        ids = np.flatnonzero(np.all((hi[:i] >= lo[i] - eps) & (lo[:i] <= hi[i] + eps), axis=1))
        for j in ids:
            if np.isin(faces[i], faces[j]).any():
                continue
            # In-plane edge normals also separate disjoint coplanar triangles.
            axes = np.vstack(
                (
                    normals[[i, j]],
                    np.cross(edges[i][:, None], edges[j]).reshape(-1, 3),
                    np.cross(edges[i], normals[i]),
                    np.cross(edges[j], normals[j]),
                )
            )
            axes = unit(axes[np.linalg.norm(axes, axis=1) > 1e-14])
            first, second = tri @ axes.T, tris[j] @ axes.T
            if not np.any(
                (first.max(axis=0) < second.min(axis=0) - eps)
                | (second.max(axis=0) < first.min(axis=0) - eps)
            ):
                raise ValueError("sweep intersects itself between non-adjacent faces")
