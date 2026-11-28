# /// script
# dependencies = ["trimesh>=4.5,<5", "numpy>=2,<3", "rtree>=1.3,<2", "pillow>=11,<13", "shapely>=2,<3", "libigl>=2.6,<3"]
# ///
"""Measure the exported GLBs in metres, independently of the reconstruction code."""
import json
from pathlib import Path
import igl
import numpy as np
import trimesh
from shapely import MultiLineString, line_merge

ROOT = Path(__file__).resolve().parents[1] / "public/models"
SOURCES = ("reference", "stack3")
Y = {"table": 0.32, "bookshelf": 1.24, "cabinet": 0.540}


def distances(mesh, origins, direction):
    origins = np.array(origins)
    hits, indices, _ = mesh.ray.intersects_location(origins, np.tile(direction, (len(origins), 1)))
    result = np.full(len(origins), np.inf)
    if not len(hits):
        return result
    np.minimum.at(result, indices, np.linalg.norm(hits - origins[indices], axis=1))
    return result


CABINET_SOURCES = ("reference", "dexel", "dexel-2x", "dexel-4x")


def seam_measurement(mesh, lines, half_depth):
    # Intersect the front-going ray at the seam and at the flat door field.
    seam, face = distances(mesh, [[0, .54, 1], [.16, .54, 1]], [0, 0, -1])
    depth = float(seam - face)
    width = 0.
    if depth >= half_depth:
        # Intersect the section segments with a line parallel to the door face,
        # at the same reference half-depth in every model.
        z = 1 - face - half_depth
        a, b = lines[:, 0], lines[:, 1]
        cross = (a[:, 2] <= z) != (b[:, 2] <= z)
        a, b = a[cross], b[cross]
        xs = a[:, 0] + (z-a[:, 2]) * (b[:, 0]-a[:, 0]) / (b[:, 2]-a[:, 2])
        width = xs[xs > 0].min() - xs[xs < 0].max()
    return {"value": round(depth * 1000, 2), "widthMm": round(float(width) * 1000, 2)}


def seam_profile(lines):
    # Midpoints of 400 equal bins across the middle 40 mm of the shared section.
    a, b = lines[:, 0], lines[:, 1]
    result = []
    for x in (np.arange(400) + .5) * .0001 - .020:
        hit = (a[:, 0] <= x) != (b[:, 0] <= x)
        start, end = a[hit], b[hit]
        z = start[:, 2] + (x-start[:, 0]) * (end[:, 2]-start[:, 2]) / (end[:, 0]-start[:, 0])
        result.append(z.max())
    return np.array(result)


def measurement(name, mesh):
    if name == "bookshelf":
        # One unobstructed sightline in each intentionally open compartment.
        cells = [[-.14, .95, 1], [.15, .22, 1], [.15, 1.24, 1]]
        return int(np.isinf(distances(mesh, cells, [0, 0, -1])).sum())
    grid = [[x, 1, z] for x in np.linspace(-.35, .35, 11) for z in np.linspace(-.18, .18, 7)]
    height = 1 - distances(mesh, grid, [0, -1, 0])
    return round(float(np.sqrt(np.mean((height - .41) ** 2)) * 1000), 3)


def oblique_rays(bounds):
    corners = trimesh.bounds.corners(bounds)
    center = np.mean(bounds, axis=0)
    diagonal = np.linalg.norm(bounds[1] - bounds[0])
    starts, directions = [], []
    for direction in ([1,.6,1], [-1,.6,1], [1,.6,-1], [-1,.6,-1], [1,-.45,.8], [-1,-.45,-.8]):
        normal = trimesh.unitize(direction)
        right = trimesh.unitize(np.cross([0,1,0], normal))
        up = np.cross(normal, right)
        projections = (corners - center) @ np.stack([right,up]).T
        coords = [np.linspace(v.min(), v.max(), 65) for v in projections.T]
        x,y = np.meshgrid(*[(v[1:]+v[:-1])/2 for v in coords])
        origins = center + normal*diagonal + x.reshape(-1,1)*right + y.reshape(-1,1)*up
        starts.append(origins)
        directions.append(np.tile(-normal, (len(origins),1)))
    return np.vstack(starts), np.vstack(directions)


def visible_depths(mesh, rays):
    tree = igl.AABB()
    faces = mesh.faces[mesh.nondegenerate_faces()]
    tree.init(mesh.vertices, faces)
    ids, depth, _ = tree.intersect_ray_first(mesh.vertices, faces, *rays)
    return np.where(ids >= 0, depth, np.nan)


def visible_error(truth, observed):
    ref_hits = np.isfinite(truth)
    hits = np.isfinite(observed)
    both = ref_hits & hits
    return {"silhouetteIoU": round(float(both.sum() / (ref_hits | hits).sum()), 5),
            "depthP95Mm": round(float(np.percentile(np.abs(truth[both]-observed[both]), 95) * 1000), 3)}


def seat_measurement(mesh):
    # Vertical cut across both seat cushions at Z=0. Sample just to each side
    # of their contact plane; a ray exactly on the shared edge is ambiguous.
    middle = .07775
    xs = middle + np.array([-.20, -.005, .005, .20])
    y = 1 - distances(mesh, [[x, 1, 0] for x in xs], [0,-1,0])
    return round(float((y[[0,3]].mean()-y[[1,2]].mean())*1000), 2)


def section(lines, axes=(0, 2)):
    # Merge at 0.1 mm. Preserve separate parts (including hidden joints).
    lines = np.round(lines[:, :, list(axes)] * 1000, 1)
    curves = line_merge(MultiLineString(lines.tolist()))
    parts = curves.geoms if curves.geom_type == "MultiLineString" else [curves]
    return ["M" + " ".join(f"{x:.1f},{-z:.1f}" for x,z in p.simplify(.12).coords) for p in parts if not p.is_empty]


def main():
    metadata = json.loads((ROOT / "catalog.json").read_text())
    results = {}
    quality = {}
    for name, record in metadata.items():
        results[name] = {}
        sources = CABINET_SOURCES if name == "cabinet" else (*SOURCES, "measured")
        for source in sources:
            file = f"{source}/dexel.glb" if source.startswith("dexel") else f"{source}.glb"
            mesh = trimesh.load_scene(ROOT / name / file, process=False).to_mesh()
            assert len(mesh.faces) == record[source] and np.isfinite(mesh.vertices).all()
            assert np.max(np.abs(mesh.extents - record["size"])) < .10, (name, mesh.extents)
            if name != "cabinet":
                if source == "reference":
                    rays = oblique_rays(mesh.bounds)
                    truth = visible_depths(mesh, rays)
                    quality[name] = {}
                else:
                    quality[name][source] = visible_error(truth, visible_depths(mesh, rays))
            if name == "sofa":
                lines = trimesh.intersections.mesh_plane(mesh, [0,0,1], [0,0,0])
                results[name][source] = {"value": seat_measurement(mesh), "section": section(lines, (0,1))}
                results[name]["z"] = 0
            elif name in Y:
                lines = trimesh.intersections.mesh_plane(mesh, [0, 1, 0], [0, Y[name], 0])
                if name == "cabinet":
                    if source == "reference":
                        seam, face = distances(mesh, [[0, .54, 1], [.16, .54, 1]], [0, 0, -1])
                        half_depth = (seam - face) / 2
                        results[name]["widthProbeDepthMm"] = round(half_depth * 1000, 2)
                    profile = seam_profile(lines)
                    if source == "reference":
                        reference_profile = profile
                    result = seam_measurement(mesh, lines, half_depth)
                    result["profileMeanErrorMm"] = round(float(np.mean(np.abs(profile-reference_profile))) * 1000, 3)
                else:
                    result = {"value": measurement(name, mesh)}
                result["section"] = section(lines)
                results[name][source] = result
        if name in Y:
            results[name]["y"] = Y[name]
            print(name, *(results[name][s]["value"] for s in sources))
    assert results["cabinet"]["reference"]["value"] == 38.50
    assert results["cabinet"]["reference"]["widthMm"] == 15
    assert results["bookshelf"]["reference"]["value"] == 3
    assert results["table"]["reference"]["value"] < .01
    (ROOT / "surface-quality.json").write_text(json.dumps(quality, indent=2, allow_nan=False) + "\n")
    (ROOT / "sections.json").write_text(json.dumps({k: results[k] for k in (*Y,"sofa")}, separators=(",", ":"), allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
