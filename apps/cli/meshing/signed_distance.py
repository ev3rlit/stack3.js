# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["gpytoolbox==0.3.8", "numpy==2.2.6", "scipy==1.15.3", "scikit-image==0.25.2", "shapely==2.1.2"]
# ///
"""Carrera et al.'s Dual Contouring of Signed Distance Data using Gpytoolbox."""

import sys
from pathlib import Path

import numpy as np
from gpytoolbox import dual_contouring_of_signed_distance_data
from scipy.ndimage import distance_transform_edt, map_coordinates

from field_data import load_field
from finishing import edge_pairs, topology
from mesh import run


def orient_surface(vertices, faces, field, step):
    directed, edges, owners = edge_pairs(faces)
    if len(edges) % 2 or not np.array_equal(edges[::2], edges[1::2]) or np.any(np.all(edges[2::2] == edges[:-2:2], axis=1)):
        raise ValueError("signed distance contouring produced an ambiguous surface; try mc33 or a finer grid")
    # Join matching edges consistently, then use the field to orient each sheet.
    neighbors = [[] for _ in faces]
    for a, b, same in zip(owners[::2], owners[1::2], directed[::2, 0] == directed[1::2, 0]):
        neighbors[a].append((b, same))
        neighbors[b].append((a, same))
    result = faces.copy()
    parity = np.full(len(faces), -1, dtype=np.int8)
    gradient = np.gradient(field, *step)
    for seed in range(len(faces)):
        if parity[seed] >= 0:
            continue
        parity[seed] = 0
        component = [seed]
        for face in component:
            for next_face, same in neighbors[face]:
                expected = parity[face] ^ same
                if parity[next_face] < 0:
                    parity[next_face] = expected
                    component.append(next_face)
                elif parity[next_face] != expected:
                    raise ValueError("signed distance contouring produced a non-orientable surface")
        indices = np.asarray(component)
        flipped = parity[indices] == 1
        a, b, c = vertices[faces[indices]].transpose(1, 0, 2)
        normal = np.cross(b - a, c - a)
        normal[flipped] *= -1
        centers = ((a + b + c) / 3 / step + 0.5).T
        outward = np.stack([map_coordinates(axis, centers, order=1, mode="nearest") for axis in gradient], axis=1)
        if np.einsum("ij,ij->", normal, outward) < 0:
            flipped = ~flipped
        result[indices[flipped]] = result[indices[flipped], ::-1]
    topology(vertices, result)
    return result


def signed_distance_mesh(mask, step, guide, guide_directory):
    occupied = np.pad(mask, 1)
    if "field" in guide:
        field = load_field(occupied, guide["field"], guide_directory)
    else:
        # Center-to-center distances provide a sampled approximation from occupancy.
        field = distance_transform_edt(~occupied, sampling=step) - distance_transform_edt(occupied, sampling=step)
    iterations = {}
    for field_name, option, default in [("outerIterations", "outer_iters", 3), ("innerIterations", "inner_iters", 12)]:
        value = guide.get(field_name, default)
        if type(value) is not int or not 1 <= value <= 100:
            raise ValueError(f"{field_name} must be an integer from 1 to 100")
        iterations[option] = value
    points = np.stack(np.unravel_index(np.arange(occupied.size), occupied.shape, order="F"), axis=1)
    # Gpytoolbox always includes these near-surface samples. Its larger default
    # batch adds a randomly ordered set of distant samples with no seed option.
    near_band = 3 * np.sqrt(3) * step.min() * (1 - 1e-9)
    batch_size = max(1, int(np.count_nonzero(np.abs(field) < near_band)))
    vertices, quads = dual_contouring_of_signed_distance_data(
        field.ravel(order="F"), (points - 0.5) * step, *occupied.shape, batch_size=batch_size, **iterations,
    )
    if not len(quads):
        raise ValueError("signed distance contouring returned an empty surface")
    d02 = np.linalg.norm(vertices[quads[:, 0]] - vertices[quads[:, 2]], axis=1)
    d13 = np.linalg.norm(vertices[quads[:, 1]] - vertices[quads[:, 3]], axis=1)
    quads = quads.copy()
    quads[d13 < d02] = np.roll(quads[d13 < d02], 1, axis=1)
    faces = quads[:, [[0, 1, 2], [0, 2, 3]]].reshape(-1, 3)
    return vertices / step, orient_surface(vertices, faces, field, step)


if __name__ == "__main__":
    try:
        run(sys.argv[1], Path(sys.argv[2]), signed_distance_mesh)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        sys.exit(str(exc))
