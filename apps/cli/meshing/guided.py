from itertools import pairwise, product

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
    unit,
    xyz,
)
from scipy.spatial.transform import Rotation


def vector(data, key):
    p = np.asarray(data.get(key), dtype=float)
    if p.shape != (3,) or not np.isfinite(p).all():
        raise ValueError(f"{key} must be a finite XYZ point or vector")
    return p


def revolve(mask, step, origin, guide, axis):
    center = (vector(guide, "origin") - origin) / step
    u, v, _ = cyclic(axis)
    stack = mask.transpose(cyclic(axis))
    if not (0 <= center[u] < mask.shape[u] and 0 <= center[v] < mask.shape[v]):
        raise ValueError("rotation axis outside the stack")
    # Sample the +u half of the meridian at the supplied transverse origin.
    profile_mask = stack[:, int(center[v]), :]
    meridian = region(profile_mask).intersection(sh.box(center[u], 0, mask.shape[u], mask.shape[axis]))
    if meridian.area <= 0:
        raise ValueError("positive meridian of the rotation axis misses the saved stack")
    segments = guide.get("segments", 64)
    if type(segments) is not int or not 8 <= segments <= 512:
        raise ValueError("segments must be an integer from 8 to 512")
    angle = np.arange(segments) * (2 * np.pi / segments)
    triangles = []
    for poly in polygons(meridian):
        poly = sh.orient_polygons(poly)
        for ring in [poly.exterior, *poly.interiors]:
            points = []
            for r, h in ring.coords:
                radius = (r - center[u]) * step[u]
                points.append(
                    np.column_stack(
                        (
                            center[u] + radius * np.cos(angle) / step[u],
                            center[v] + radius * np.sin(angle) / step[v],
                            np.full(segments, h),
                        )
                    )
                )
            for a, b in pairwise(points):
                for face in connect(a, b):
                    if (
                        not np.array_equal(face[0], face[1])
                        and not np.array_equal(face[1], face[2])
                        and not np.array_equal(face[0], face[2])
                    ):
                        triangles.append(face)
    return indexed(xyz(triangles, axis))


def stack_profile(mask, step, origin, station, tangent, frame):
    """Sample the actual first cutting plane in its transported metric basis."""
    from shapely.affinity import affine_transform
    from shapely.geometry import Point, Polygon

    corners = np.array(list(product(*zip(np.zeros(3), mask.shape)))) * step + origin
    bounds = (corners - station) @ frame.T
    pitch = 1 / np.linalg.norm(frame / step, axis=1)
    low = bounds.min(axis=0)
    shape = np.maximum(1, np.ceil((bounds.max(axis=0) - low) / pitch).astype(int))
    indices = np.indices(shape).reshape(2, -1).T
    points = station + ((indices + 0.5) * pitch + low) @ frame + tangent * min(step) * 1e-6
    cells = np.floor((points - origin) / step).astype(int)
    inside = np.all((cells >= 0) & (cells < mask.shape), axis=1)
    inside[inside] = mask[tuple(cells[inside].T)]
    candidates = []
    for section in polygons(region(inside.reshape(shape))):
        poly = affine_transform(section, [pitch[0], 0, 0, pitch[1], *low])
        if Polygon(poly.exterior).covers(Point(0, 0)):
            candidates.append(sh.orient_polygons(poly))
    if len(candidates) != 1:
        raise ValueError(
            "first path station must lie inside a unique outer section; supply profile or move the path"
        )
    print("sweep profile: outer and hole loops from the saved first section")
    return candidates[0]


def sweep(mask, step, origin, guide):
    path = np.asarray(guide.get("path"), dtype=float)
    if path.ndim != 2 or path.shape[1] != 3 or len(path) < 2 or not np.isfinite(path).all():
        raise ValueError("path requires at least two finite XYZ points")
    delta = np.diff(path, axis=0)
    lengths = np.linalg.norm(delta, axis=1)
    if (lengths < 1e-12).any():
        raise ValueError("duplicate stations on sweep path")
    directions = unit(delta)
    bends = directions[:-1] + directions[1:]
    if (np.linalg.norm(bends, axis=1) < 1e-6).any():
        raise ValueError("path reverses through a station")
    tangents = np.vstack((directions[0], unit(bends), directions[-1]))
    up = vector(guide, "up") if "up" in guide else np.eye(3)[np.argmin(abs(tangents[0]))]
    u = up - up.dot(tangents[0]) * tangents[0]
    if np.linalg.norm(u) < 1e-8:
        raise ValueError("up must have a component perpendicular to the initial tangent")
    u = unit(u)
    frames = []
    for i, tangent in enumerate(tangents):
        if i:
            turn = np.cross(tangents[i - 1], tangent)
            angle = np.arctan2(np.linalg.norm(turn), tangents[i - 1].dot(tangent))
            u = Rotation.from_rotvec(unit(turn) * angle).apply(u)
        frames.append(np.stack((u, np.cross(tangent, u))))
    poly = (
        profile(guide["profile"])
        if "profile" in guide
        else stack_profile(mask, step, origin, path[0], tangents[0], frames[0])
    )
    triangles = []
    for ring in [poly.exterior, *poly.interiors]:
        uv = np.asarray(ring.coords[:-1])
        rings = [xy + uv @ frame for xy, frame in zip(path, frames)]
        for a, b, direction in zip(rings, rings[1:], directions):
            if ((b - a) @ direction <= 0).any():
                raise ValueError("bend folds the swept profile; widen the bend or reduce the profile")
            triangles.extend(connect(a, b))
    for tri in planar_triangles(poly):
        triangles.extend((path[0] + tri[::-1] @ frames[0], path[-1] + tri @ frames[-1]))
    verts, faces = indexed(triangles)
    # Non-local crossings cannot be found from tangent or curvature checks alone.
    from intersection import check_intersections

    check_intersections(verts, faces)
    grid = (verts - origin) / step
    if np.any(grid.min(axis=0) < -1e-6) or np.any(grid.max(axis=0) > np.array(mask.shape) + 1e-6):
        raise ValueError("swept profile leaves the saved part frame")
    cells = np.clip(np.floor((path - origin) / step).astype(int), 0, np.array(mask.shape) - 1)
    radius = np.max(np.linalg.norm(np.asarray(poly.exterior.coords), axis=1))
    from scipy.ndimage import distance_transform_edt

    if (distance_transform_edt(~mask, sampling=step)[tuple(cells.T)] > radius + np.linalg.norm(step)).any():
        raise ValueError("sweep path and profile miss the saved occupancy")
    return grid, faces
