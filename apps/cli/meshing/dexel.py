"""Read registered triple-dexel intersections for Hermite Dual Contouring."""

from pathlib import Path

import numpy as np


def load_dexel(mask, step, origin, name, directory):
    if not isinstance(name, str) or not name or not directory:
        raise ValueError("dexel must be a .npz path relative to the guide")
    path = Path(directory) / name
    if path.suffix.lower() != ".npz":
        raise ValueError("dexel must be a .npz path")
    crossings = {}
    ignored = 0
    with np.load(path, allow_pickle=False) as data:
        if (data["version"].ndim != 0 or data["version"].item() != 1 or
                not np.array_equal(data["grid"], mask.shape) or
                data["origin"].shape != (3,) or data["step"].shape != (3,) or
                not np.allclose(data["origin"], origin, rtol=0, atol=1e-8) or
                not np.allclose(data["step"], step, rtol=0, atol=1e-8)):
            raise ValueError("dexel registration must match the saved stack grid, origin and spacing")
        for axis, axis_name in enumerate("xyz"):
            transverse = tuple(i for i in range(3) if i != axis)
            shape = tuple(mask.shape[i] for i in transverse)
            count = int(np.prod(shape))
            offsets, depth, normals = [data[axis_name + "_" + key] for key in ("offsets", "depth", "normals")]
            if (offsets.ndim != 1 or offsets.shape != (count + 1,) or offsets.dtype.kind not in "ui" or
                    offsets[0] != 0 or offsets[-1] != len(depth) or np.any(offsets[:-1] > offsets[1:])):
                raise ValueError(f"dexel {axis_name}: invalid ray offsets")
            if (depth.ndim != 1 or normals.shape != (len(depth), 3) or depth.dtype.kind != "f" or
                    normals.dtype.kind != "f" or not np.isfinite(depth).all() or not np.isfinite(normals).all() or
                    np.any(depth < 0) or np.any(depth > mask.shape[axis] * step[axis] + 1e-8)):
                raise ValueError(f"dexel {axis_name}: invalid depth or normal samples")
            lengths = np.linalg.norm(normals, axis=1)
            if np.any(abs(lengths - 1) > 1e-3):
                raise ValueError(f"dexel {axis_name}: normals must be unit vectors")
            centers = (np.arange(mask.shape[axis]) + 0.5) * step[axis]
            columns = np.moveaxis(mask, axis, -1).reshape(count, -1)
            for ray, (start, end) in enumerate(zip(offsets[:-1], offsets[1:])):
                t = depth[start:end]
                n = normals[start:end]
                if (len(t) % 2 or np.any(t[:-1] >= t[1:]) or
                        np.any(n[::2, axis] >= 0) or np.any(n[1::2, axis] <= 0)):
                    raise ValueError(f"dexel {axis_name} ray {ray}: expected ordered, outward-facing enter/exit pairs")
                if not np.array_equal(np.searchsorted(t, centers, side="right") % 2, columns[ray]):
                    raise ValueError(f"dexel {axis_name} ray {ray}: occupancy differs from the saved stack")
                if not len(t):
                    continue
                # Padded sample i sits at (i - 0.5) * step. A DC edge spans i..i+1.
                pad = np.pad(columns[ray], 1)
                changes = np.flatnonzero(pad[:-1] != pad[1:])
                indexed = np.searchsorted(centers, t, side="left")
                u, v = np.unravel_index(ray, shape)
                for i in changes:
                    events = np.flatnonzero(indexed == i)
                    if len(events) != 1:
                        raise ValueError(f"dexel {axis_name} ray {ray}: multiple crossings on a sign-changing grid edge; use a finer grid")
                    event = events[0]
                    p = [0, 0, 0]
                    p[axis], p[transverse[0]], p[transverse[1]] = i, u + 1, v + 1
                    position = np.array(p, dtype=float)
                    position[axis] = t[event] / step[axis] + 0.5
                    crossings[(*p, axis)] = (position, n[event])
                ignored += len(t) - len(changes)
    print(f"triple-dexel: used {len(crossings)} measured crossings; {ignored} crossings on edges without a sampled sign change")
    return crossings
