"""Project saved RGB onto face charts and split vertices only at UV or hard-normal seams."""

import json
import math

import numpy as np
from geometry import cyclic, unit
from scipy.ndimage import distance_transform_edt


def split_creases(faces, normals):
    """Each connected fan below 55 degrees shares a shading normal."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    ids = np.arange(faces.size).reshape(-1, 3)
    ends = np.stack((ids.ravel(), np.roll(ids, -1, axis=1).ravel()), axis=1)
    edges = faces.ravel()[ends]
    flip = edges[:, 0] > edges[:, 1]
    ends[flip] = ends[flip, ::-1]
    edges.sort(axis=1)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    pairs = np.all(edges[order[:-1]] == edges[order[1:]], axis=1)
    a, b = order[:-1][pairs], order[1:][pairs]
    unit_normals = unit(normals)
    soft = (unit_normals[a // 3] * unit_normals[b // 3]).sum(axis=1) > np.cos(np.deg2rad(55))
    rows, cols = ends[a[soft]].ravel(), ends[b[soft]].ravel()
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(faces.size, faces.size))
    _, fan = connected_components(graph, directed=False)
    _, first = np.unique(fan, return_index=True)
    return faces.ravel()[first], fan.reshape(-1, 3)


def write_mesh(folder, mesh, rgba, step, origin, blocks=False, sharp=False, occlusion=None):
    verts, faces = mesh
    faces = np.asarray(faces, dtype=np.int32)
    local = (verts * step + origin).astype(np.float32).astype(float)
    a, b, c = local[faces].transpose(1, 0, 2)
    normals = np.cross(b - a, c - a)
    if not np.isfinite(local).all() or not len(faces) or (np.linalg.norm(normals, axis=1) == 0).any():
        raise ValueError("invalid surface: empty, nonfinite or degenerate triangles")
    if sharp:
        source, faces = split_creases(faces, normals)
        verts = verts[source]
        if occlusion is not None:
            occlusion = occlusion[source]
        local = verts * step + origin
    smooth = np.zeros_like(local)
    for i in range(3):
        np.add.at(smooth, faces[:, i], normals)
    smooth = unit(smooth)
    axes = np.argmax(abs(normals), axis=1)
    signs = np.sign(normals[np.arange(len(faces)), axes]).astype(int)
    stations = np.zeros(len(faces), dtype=int)
    if blocks:
        stations = verts[faces[:, 0], axes].round().astype(int) - (signs > 0)
    groups, group_ids = np.unique(np.column_stack((axes, signs, stations)), axis=0, return_inverse=True)
    # Each tile contains the saved texels of this plane (or its orthographic projection).
    tiles = []
    for axis, sign, station in groups:
        plane = rgba.transpose((*cyclic(axis), 3))
        if blocks:
            pixels = plane[:, :, station].copy()
        else:
            ray = plane[:, :, ::-1] if sign > 0 else plane
            hit = ray[:, :, :, 3] >= 128
            u, v = np.indices(ray.shape[:2])
            pixels = ray[u, v, hit.argmax(axis=2)].copy()
        valid = pixels[:, :, 3] >= 128
        uu, vv = np.where(valid)
        lo, bot = uu.min(), vv.min()
        tile = pixels[lo : uu.max() + 1, bot : vv.max() + 1].transpose(1, 0, 2).copy()
        empty = tile[:, :, 3] < 128
        if empty.any():
            nearest = distance_transform_edt(empty, return_distances=False, return_indices=True)
            tile[empty] = tile[tuple(nearest[:, empty])]
        tile[:, :, 3] = 255
        tiles.append((np.pad(tile, ((1, 1), (1, 1), (0, 0)), mode="edge"), lo, bot))
    width = max(
        max(t.shape[1] for t, _, _ in tiles), math.ceil(math.sqrt(sum(t.size / 4 for t, _, _ in tiles)))
    )
    x = y = height = 0
    offsets = []
    for tile, lo, bot in tiles:
        h, w = tile.shape[:2]
        if x + w > width:
            x, y = 0, height
        offsets.append((x, y))
        height = max(height, y + h)
        x += w
    texture = np.zeros((height, width, 4), np.uint8)
    corners, ids = np.unique(
        np.column_stack((faces.ravel(), np.repeat(group_ids, 3))), axis=0, return_inverse=True
    )
    pos = local[corners[:, 0]]
    nor = smooth[corners[:, 0]]
    uv = np.empty((len(pos), 2))
    for i, ((tile, lo, bot), (x, y), (axis, sign, _)) in enumerate(zip(tiles, offsets, groups)):
        h, w = tile.shape[:2]
        texture[y : y + h, x : x + w] = tile
        use = corners[:, 1] == i
        u, v, _ = cyclic(axis)
        coords = verts[corners[use, 0]][:, [u, v]] - [lo, bot]
        uv[use] = (np.clip(coords, 0, [w - 2, h - 2]) + [x + 1, y + 1]) / [width, height]
        if blocks:
            nor[use] = np.eye(3)[axis] * sign
    for name, data in [("positions", pos), ("normals", nor)]:
        (data[:, [0, 2, 1]] * [1, 1, -1]).astype("<f4").tofile(folder / name)
    uv.astype("<f4").tofile(folder / "uvs")
    ids.astype("<u4").tofile(folder / "indices")
    texture.tofile(folder / "texture")
    if occlusion is not None:
        rgb = np.repeat(occlusion[corners[:, 0], None], 3, axis=1)
        np.column_stack((rgb, np.ones(len(rgb)))).astype("<f4").tofile(folder / "colors")
    (folder / "output.json").write_text(json.dumps({"width": width, "height": height, "colors": occlusion is not None}))
