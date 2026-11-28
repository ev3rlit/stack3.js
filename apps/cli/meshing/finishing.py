"""Fit surfaces on a shared topology, then apply optional offline mesh operations."""

import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from geometry import unit


def face_normals(vertices, faces):
    a, b, c = vertices[faces].transpose(1, 0, 2)
    return np.cross(b - a, c - a)


def edge_pairs(faces):
    edges = faces[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2)
    ordered = np.sort(edges, axis=1)
    order = np.lexsort((ordered[:, 1], ordered[:, 0]))
    return edges[order], ordered[order], order // 3


def topology(vertices, faces):
    vertices = np.asarray(vertices, dtype=np.float64)
    if not len(faces) or not np.isfinite(vertices).all() or np.any(np.all(face_normals(vertices, faces) == 0, axis=1)):
        raise ValueError("finishing needs finite, nondegenerate geometry")
    directed, edges, _ = edge_pairs(faces)
    if len(edges) % 2 or not np.array_equal(edges[::2], edges[1::2]) or np.any(np.all(edges[2::2] == edges[:-2:2], axis=1)):
        raise ValueError("finishing needs a closed surface with two faces per edge")
    if not np.array_equal(directed[::2], directed[1::2, ::-1]):
        raise ValueError("surface winding is inconsistent")
    count, _, inverse = np.unique(faces, return_index=True, return_inverse=True)
    remapped = inverse.reshape(faces.shape)
    links = remapped[:, :2].ravel(), remapped[:, 1:].ravel()
    graph = coo_matrix((np.ones(len(links[0])), links), shape=(len(count), len(count)))
    components = connected_components(graph, directed=False, return_labels=False)
    return components, len(count) - len(edges) // 2 + len(faces)


def fit_round(points, normals, tolerance):
    """Try a sphere and a cylinder in physical coordinates, with normal support."""
    center = points.mean(axis=0)
    p = points - center
    _, support, axes = np.linalg.svd(normals, full_matrices=False)
    bases = []
    if support[2] >= 0.25 * support[0]:
        bases.append((np.eye(3), "sphere"))
    if support[1] >= 0.35 * support[0] and support[2] <= 0.30 * support[0]:
        bases.append((axes[:2].T, "cylinder"))
    candidates = []
    for basis, kind in bases:
        coordinates = p @ basis
        system = np.column_stack((2 * coordinates, np.ones(len(p))))
        result, _, rank, _ = np.linalg.lstsq(system, np.sum(coordinates**2, axis=1), rcond=None)
        if rank < system.shape[1]:
            continue
        r2 = result[-1] + np.dot(result[:-1], result[:-1])
        if r2 <= tolerance**2:
            continue
        radius = np.sqrt(r2)
        radial = (coordinates - result[:-1]) @ basis.T
        directions = unit(radial)
        error = radius - np.linalg.norm(radial, axis=1)
        rms = np.sqrt(np.mean(error**2))
        if rms <= tolerance and np.max(np.abs(error)) <= 2 * tolerance and np.mean(np.abs(np.sum(directions * normals, axis=1))) >= 0.88:
            candidates.append((rms, directions, error, kind))
    return min(candidates, key=lambda item: item[0], default=None)


def fit_features(vertices, faces, tolerance, primitives):
    raw_normals = face_normals(vertices, faces)
    normals = unit(raw_normals)
    _, edges, owners = edge_pairs(faces)
    angle = 35 if primitives else 15
    near = np.all(edges[:-1] == edges[1:], axis=1) & (np.sum(normals[owners[:-1]] * normals[owners[1:]], axis=1) > np.cos(np.deg2rad(angle)))
    rows, cols = owners[:-1][near], owners[1:][near]
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(faces), len(faces)))
    _, labels = connected_components(graph, directed=False)
    groups = np.split(np.argsort(labels, kind="stable"), np.flatnonzero(np.diff(np.sort(labels))) + 1)
    constraints = {}
    counts = {"plane": 0, "sphere": 0, "cylinder": 0}
    for group in groups:
        indices = np.unique(faces[group])
        if len(group) < 4 or len(indices) < 6:
            continue
        p = vertices[indices]
        center = p.mean(axis=0)
        normal = np.linalg.svd(p - center, full_matrices=False)[2][-1]
        error = (center - p) @ normal
        if np.max(abs(error)) <= tolerance and np.mean(abs(normals[group] @ normal)) >= 0.97:
            directions = np.broadcast_to(normal, p.shape)
            kind = "plane"
        elif primitives and len(group) >= 24:
            vertex_normals = np.zeros((len(indices), 3))
            np.add.at(vertex_normals, np.searchsorted(indices, faces[group]).ravel(), np.repeat(raw_normals[group], 3, axis=0))
            result = fit_round(p, unit(vertex_normals), tolerance)
            if result is None:
                continue
            _, directions, error, kind = result
        else:
            continue
        counts[kind] += 1
        for i, n, offset in zip(indices, directions, error):
            constraints.setdefault(i, []).append((n, offset))
    displacement = np.zeros_like(vertices)
    for i, entries in constraints.items():
        if len(entries) == 1:
            n, offset = entries[0]
            delta = n * offset
        else:
            directions, offsets = zip(*entries)
            delta = np.linalg.lstsq(directions, offsets, rcond=0.15)[0]
        if np.linalg.norm(delta) <= 2 * tolerance:
            displacement[i] = delta
    # Boundary vertices are shared by every patch. Limit motion before a face folds.
    for strength in [1.0, 0.5, 0.25, 0.125]:
        candidate = vertices + strength * displacement
        if np.all(np.sum(face_normals(candidate, faces) * raw_normals, axis=1) > 0.1 * np.sum(raw_normals**2, axis=1)):
            print(f"feature fitting: {counts}; displacement factor {strength:g}")
            return candidate
    print("feature fitting: original vertices retained to prevent folded faces")
    return vertices


def finish_surface(mesh, step, origin, options, folder, blender):
    vertices, faces = mesh
    world = vertices * step + origin
    original = topology(world, faces)
    if "fitTolerance" in options:
        world = fit_features(world, faces, options["fitTolerance"], options.get("primitives", False))
    if "regularization" in options:
        from regularization import regularize

        world = regularize(world, faces, options["regularization"])
    occlusion = None
    if any(name in options for name in ("bevelWidth", "dissolveAngle", "triangleBudget", "aoRadius")):
        data = folder / "geometry.npz"
        np.savez(data, vertices=world, faces=faces)
        script = Path(__file__).with_name("finish_blender.py")
        try:
            subprocess.run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "-P", str(script), "--", str(folder)], check=True)
        except FileNotFoundError:
            raise ValueError("Blender was not found. Set BLENDER_BIN to use bevel, dissolve, QEM or AO.") from None
        except subprocess.CalledProcessError:
            raise ValueError("Blender could not finish the surface") from None
        with np.load(data, allow_pickle=False) as result:
            world, faces = result["vertices"], result["faces"]
            if "occlusion" in result:
                occlusion = result["occlusion"]
    if topology(world, faces) != original:
        raise ValueError("finishing changed the component count or Euler characteristic")
    return ((world - origin) / step, faces), occlusion
