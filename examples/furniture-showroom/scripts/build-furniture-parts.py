# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["numpy>=2,<3", "trimesh>=4.5,<5", "scipy>=1.15,<2", "shapely>=2,<3", "pillow>=11,<13", "rtree>=1.3,<2", "scikit-image>=0.25,<0.26", "libigl>=2.6,<3", "fast-simplification>=0.1.12,<0.2"]
# ///
"""Sample each authored component, reconstruct it with Stack3, then restore its material and placement."""
import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import fast_simplification
import igl
import numpy as np
import trimesh

from dexel_capture import capture

EXAMPLE = Path(__file__).resolve().parents[1]
ROOT = EXAMPLE / "public/models"
sys.path.insert(0, str(EXAMPLE.parents[1] / "apps/cli/meshing"))
from dexel import load_dexel
from implicit import feature_mesh, iso
from material import split_creases

ASSETS = ("sofa", "stool", "table", "bookshelf", "armchair", "lamp", "trolley", "staircase")


def sampling_solid(reference, name):
    mesh = trimesh.Trimesh(vertices=reference.vertices, faces=reference.faces, process=True, validate=True)
    mesh.merge_vertices(digits_vertex=7)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    if name == "Bent steel stem" and not mesh.is_watertight:
        # Three.js TubeGeometry omits both end disks. Seal only the two ten-sided
        # end rings for solid sampling; the visible curved tube is unchanged.
        border = mesh.edges[trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)]
        caps = []
        vertices = mesh.vertices.tolist()
        while len(border):
            ring = [border[0, 0]]
            while True:
                i = np.flatnonzero(border[:, 0] == ring[-1]).item()
                end = border[i, 1]
                border = np.delete(border, i, axis=0)
                if end == ring[0]:
                    break
                ring.append(end)
            center = len(vertices)
            vertices.append(mesh.vertices[ring].mean(axis=0))
            caps.extend((b, a, center) for a, b in zip(ring, np.roll(ring, -1)))
        mesh = trimesh.Trimesh(vertices, np.vstack([mesh.faces, caps]), process=False)
    if not mesh.is_watertight or not mesh.is_winding_consistent:
        raise ValueError(f"{name}: input solid has inconsistent boundaries")
    return mesh


def measured_mesh(mesh, name, asset):
    longest = 96 if asset == "sofa" else 34
    pitch = mesh.extents.max() / longest
    if name == "Open domed shade":
        pitch = min(pitch, .0037)
    if name == "Bent steel stem":
        pitch = min(pitch, .0048)
    grid = np.maximum(6, np.ceil(mesh.extents / pitch).astype(int))
    step = mesh.extents / grid
    # Boundaries sit between sample centers. Slight asymmetric padding avoids
    # hitting exact symmetry planes and shared triangle edges on radial pieces.
    origin = mesh.bounds[0] - step * np.array([1.17, 1.23, 1.31])
    grid += 3
    data = dict(version=1, grid=grid, origin=origin, step=step)
    try:
        mask = None
        for axis, label in enumerate("xyz"):
            samples, other = capture([mesh], axis, grid, origin, step)
            data.update({label+"_"+key: arr for key, arr in samples.items()})
            if mask is not None and not np.array_equal(mask, other):
                raise ValueError("axis occupancy mismatch")
            mask = other
        with TemporaryDirectory() as temp:
            np.savez(Path(temp) / "samples.npz", **data)
            events = load_dexel(mask, step, origin, "samples.npz", temp)
        points, faces = feature_mesh(mask, step, True, measured=events)
        points = origin + points * step
        method = "Triple-Dexel / Hermite DC"
    except ValueError as exc:
        # Thin shells / ambiguous dual cells can contain several boundaries.
        # Sample signed distances on the same grid and use Stack3's Lewiner MC33.
        print(f"{name}: {exc}; extracting measured SDF with MC33", flush=True)
        samples = origin + (np.indices(grid).reshape(3, -1).T + .5) * step
        field = igl.signed_distance(samples, mesh.vertices, mesh.faces, igl.SIGNED_DISTANCE_TYPE_PSEUDONORMAL)[0]
        points, faces = iso(-field.reshape(grid), 0)
        points = origin + (points + .5) * step
        method = "Measured SDF / MC33"
    return points, faces, method, grid.tolist()


def fabric_normals(reference, positions):
    # Interpolate the authored cushion shading at the finished mesh. Positions,
    # topology and the geometric accuracy measurements are independent of shading.
    source_faces = reference.faces[reference.nondegenerate_faces()]
    _, nearest_face, closest = igl.point_mesh_squared_distance(positions, reference.vertices, source_faces)
    triangles = source_faces[nearest_face]
    weights = trimesh.triangles.points_to_barycentric(reference.vertices[triangles], closest)
    return trimesh.unitize(np.einsum("ni,nij->nj", weights, reference.vertex_normals[triangles]))


def finish(reference, points, faces, budget):
    # QEM uses absolute cost thresholds. Use millimetres for rigid features
    # and centimetres for upholstered surfaces with a smooth profile.
    material = reference.visual.material
    fabric = material.name in ("Pebble wool", "Ivory woven linen")
    units = 100 if fabric else 1000
    points, faces = fast_simplification.simplify(points * units, faces, lossless=True)
    if len(faces) > budget:
        points, faces = fast_simplification.simplify(points, faces, target_count=budget, agg=4)
    points /= units
    raw = trimesh.Trimesh(points, faces, process=True, validate=True)
    if raw.volume < 0:
        raw.invert()
    points, faces = raw.vertices, raw.faces
    indexes, split_faces = split_creases(faces, raw.face_normals)
    result = trimesh.Trimesh(points[indexes], split_faces, process=False)
    if material.baseColorTexture is None:
        result.visual = trimesh.visual.TextureVisuals(material=material)
        return result
    # Reapply the source material's metre-based planar mapping to the new surface.
    # Keep a separate vertex when adjacent faces select different projection axes.
    axes = np.argsort(-np.abs(result.face_normals), axis=1, kind="stable")[:, 1:]
    axes = np.take_along_axis(axes, np.argsort(-reference.extents[axes], axis=1, kind="stable"), axis=1)
    keys, inverse = np.unique(np.column_stack((split_faces.ravel(), axes.repeat(3, axis=0))), axis=0, return_inverse=True)
    vertex, u, v = keys.T
    pos = result.vertices[vertex]
    uv = np.column_stack((pos[np.arange(len(pos)), u]/.92 + .5, .5 - pos[np.arange(len(pos)), v]/.38))
    normals = fabric_normals(reference, pos) if fabric else result.vertex_normals[vertex]
    return trimesh.Trimesh(pos, inverse.reshape(-1, 3), vertex_normals=normals,
                          visual=trimesh.visual.TextureVisuals(uv=uv, material=material), process=False)


def build(asset):
    folder = ROOT / asset
    source = trimesh.load_scene(folder / "reference.glb", process=False)
    scene = trimesh.Scene()
    methods = []
    reused = {}
    for node in source.graph.nodes_geometry:
        transform, key = source.graph[node]
        reference = source.geometry[key]
        # Repeated legs and rails share local geometry, material and sampling conditions.
        cache_key = (reference.vertices.tobytes(), reference.faces.tobytes(),
                     reference.visual.material.name)
        if cache_key not in reused:
            solid = sampling_solid(reference, node)
            points, faces, method, grid = measured_mesh(solid, node, asset)
            budget = 3000 if asset == "sofa" or node == "Open domed shade" else min(1400, max(48, 3*len(solid.faces)))
            result = finish(reference, points, faces, budget)
            reused[cache_key] = (result, method, grid)
        result, method, grid = reused[cache_key]
        scene.add_geometry(result, node_name=node, geom_name=node, transform=transform)
        methods.append(dict(part=node, method=method, grid=grid, triangles=len(result.faces)))
    binary = scene.export(file_type="glb", include_normals=True)
    (folder / "measured.glb").write_bytes(binary)
    catalog = json.loads((ROOT / "catalog.json").read_text())
    catalog[asset]["measured"] = sum(p["triangles"] for p in methods)
    (ROOT / "catalog.json").write_text(json.dumps(catalog, indent=2)+"\n")
    (folder / "reconstruction.json").write_text(json.dumps(methods, indent=2)+"\n")
    print(asset, catalog[asset]["measured"], flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", nargs="*", default=ASSETS)
    for asset in parser.parse_args().assets:
        if asset not in ASSETS:
            parser.error(f"unknown asset {asset}")
        build(asset)
