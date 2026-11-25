"""Read the final GLB accessors; all geometric measurements below are in stack XYZ."""

import io
import json
import struct

import numpy as np
import trimesh
from PIL import Image


def read_mesh(path):
    raw = path.read_bytes()
    (n,) = struct.unpack_from("<I", raw, 12)
    doc = json.loads(raw[20 : 20 + n])
    binary = memoryview(raw)[28 + n :]

    def view(i):
        b = doc["bufferViews"][i]
        off = b.get("byteOffset", 0)
        return binary[off : off + b["byteLength"]]

    def accessor(i, dtype, columns):
        return np.frombuffer(view(doc["accessors"][i]["bufferView"]), dtype).reshape(-1, columns)

    pos = accessor(0, "<f4", 3)[:, [0, 2, 1]] * [1, -1, 1]
    indices = accessor(3, "<u4", 3)
    uv = accessor(2, "<f4", 2)
    texture = np.asarray(Image.open(io.BytesIO(view(doc["images"][0]["bufferView"]))).convert("RGB"))
    p, ids = np.unique(pos, axis=0, return_inverse=True)
    mesh = trimesh.Trimesh(vertices=p, faces=ids[indices], process=False)
    return mesh, doc, uv[indices], texture


def read_stack(path):
    meta = json.loads((path / "stack.json").read_text())
    w, d, l, c = [meta[k] for k in ("width", "depth", "layers", "columns")]
    im = np.asarray(Image.open(path / "stack.png").convert("RGBA"))
    rgba = np.stack(
        [im[z // c * d : (z // c + 1) * d, z % c * w : (z % c + 1) * w].transpose(1, 0, 2) for z in range(l)],
        axis=2,
    )
    size = np.array([*meta["size"][:2], meta["spacing"] * l])
    step = size / [w, d, l]
    origin = -size * [0.5, 0.5, 0] - meta["pivot"]
    return rgba, step, origin


def voxelize(mesh, shape, step, origin):
    # Cast rays once per column. Count crossings at every cell center. Subcell
    # XY offset avoids coplanar triangles exactly on a ray without moving its cell.
    xy = (np.indices(shape[:2]).reshape(2, -1).T + [0.50013, 0.50029]) * step[:2] + origin[:2]
    starts = np.column_stack((xy, np.full(len(xy), min(mesh.bounds[0, 2], origin[2]) - step[2])))
    _tri, rays, points = mesh.ray.intersects_id(
        starts, np.tile([0, 0, 1], (len(xy), 1)), return_locations=True
    )
    bins = np.floor((points[:, 2] - origin[2]) / step[2] + 0.5).astype(int).clip(0, shape[2])
    flips = np.zeros((len(xy), shape[2] + 1), np.int32)
    np.add.at(flips, (rays, bins), 1)
    return (np.cumsum(flips, axis=1)[:, :-1] % 2).reshape(shape).astype(bool)


def thickness(mesh, mask, step, origin, axis):
    result = []
    for fraction in (0.1, 0.5, 0.9):
        k = int((mask.shape[axis] - 1) * fraction)
        cross = mask[k, :, :] if axis == 0 else mask[:, k, :]
        used = np.flatnonzero(cross.any(axis=1))
        j = int(used[len(used) // 2])
        ix, iy = (k, j) if axis == 0 else (j, k)
        xy = (np.array([ix + 0.50013, iy + 0.50029]) * step[:2] + origin[:2]).tolist()
        points, _, _ = mesh.ray.intersects_location([[*xy, mesh.bounds[0, 2] - step[2]]], [[0, 0, 1]])
        zz = np.sort(points[:, 2])
        measured = np.diff(zz)[::2].sum()
        result.append(float(measured - mask[ix, iy, :].sum() * step[2]))
    return result


def block_coverage(mesh, rgba, texcoords, texture):
    # Enumerate every unit-face center, including internal holes and islands.
    # Test plane, direction and texture at a jittered interior point. Comparing
    # area as well rejects overlaps or extra triangles outside expected cells.
    mask = rgba[:, :, :, 3] >= 128
    shape = np.array(mask.shape)
    origin = -shape * [0.5, 0.5, 0]
    expected = {}
    for ijk in np.argwhere(mask):
        for a in range(3):
            for s in (-1, 1):
                q = ijk.copy()
                q[a] += s
                if np.all(q >= 0) and np.all(q < shape) and mask[tuple(q)]:
                    continue
                key = (*ijk, a, s)
                expected[key] = list(rgba[tuple(ijk)][:3])
    seen = {}
    for face, normal, uv in zip(mesh.triangles - origin, mesh.face_normals, texcoords):
        a = int(np.argmax(abs(normal)))
        s = int(np.sign(normal[a]))
        u, v = (a + 1) % 3, (a + 2) % 3
        vv = face[:, [u, v]]
        mat = (vv[1:] - vv[0]).T
        for i in range(int(vv[:, 0].min()), int(vv[:, 0].max())):
            for j in range(int(vv[:, 1].min()), int(vv[:, 1].max())):
                bary = np.linalg.solve(mat, np.array([i + 0.50013, j + 0.50029]) - vv[0])
                weights = np.r_[1 - bary.sum(), bary]
                if weights.min() < 0:
                    continue
                q = np.zeros(3, int)
                q[[u, v, a]] = i, j, round(face[0, a]) - (s > 0)
                key = (*q, a, s)
                assert key not in seen
                px, py = np.floor((weights @ uv) * texture.shape[1::-1]).astype(int)
                seen[key] = list(texture[py, px])
    assert set(seen) == set(expected) and np.isclose(mesh.area, len(expected))
    return len(expected), sum(seen[k] != expected[k] for k in seen)


def volume_iou(mesh, mask, step, origin, factor=3):
    """Integrate both volumes on a shared subcell grid including out-of-frame surface."""
    shape = np.array(mask.shape)
    lower = np.minimum(0, np.floor((mesh.bounds[0] - origin) / step + 1e-6)).astype(int)
    upper = np.maximum(shape, np.ceil((mesh.bounds[1] - origin) / step - 1e-6)).astype(int)
    prior = np.pad(mask, np.stack((-lower, upper - shape), axis=1))
    intersection = union = 0
    for first in range(0, len(prior), 12):
        slab = prior[first : first + 12].repeat(factor, 0).repeat(factor, 1).repeat(factor, 2)
        generated = voxelize(mesh, slab.shape, step / factor, origin + (lower + [first, 0, 0]) * step)
        intersection += (slab & generated).sum()
        union += (slab | generated).sum()
    return intersection / union


def intermediate_sections(mesh, mask, step, origin, axis):
    """Mid-interval thickness vs linear interpolation of the two column thicknesses."""
    transverse = 1 - axis
    errors = []
    for k in range(mask.shape[axis] - 1):
        slices = np.take(mask, [k, k + 1], axis=axis).sum(axis=2)
        if axis == 1:
            slices = slices.T
        common = np.flatnonzero(np.min(slices, axis=0) > 0)
        if not len(common):
            continue
        j = common[len(common) // 2]
        cell = np.zeros(2)
        cell[axis] = k + 1.00013
        cell[transverse] = j + 0.50029
        p = cell * step[:2] + origin[:2]
        hits, _, _ = mesh.ray.intersects_location([[*p, mesh.bounds[0, 2] - step[2]]], [[0, 0, 1]])
        thickness = np.diff(np.sort(hits[:, 2]))[::2].sum()
        errors.append(thickness - slices[:, j].mean() * step[2])
    return {"count": len(errors), "max_excess": max(0.0, max(errors)), "max_abs": max(map(abs, errors))}
