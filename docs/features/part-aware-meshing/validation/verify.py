"""Run from any directory: python verify.py OUTPUT_DIR. Run blender_check.py on that directory next."""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from fixtures import generate
from measure import (
    block_coverage,
    intermediate_sections,
    read_mesh,
    read_stack,
    thickness,
    volume_iou,
    voxelize,
)
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[4]
PARTS = ROOT / "docs/research/020-aircraft-rendering/part-atlases"
CASES = {
    "box": [("extended-mc", None), ("hermite-dc", None), ("marching-cubes", None)],
    "face-saddle": [("mc33", None)],
    "interior-saddle": [("mc33", None)],
    "waist": [("smooth-loft", "waist"), ("section-loft", "waist")],
    "bore": [("mc33", None), ("branch-loft", None), ("heightfield", "x")],
    "fork": [("branch-loft", None), ("mc33", None)],
    "sphere": [("extended-mc", None), ("hermite-dc", None), ("mc33", None)],
    "merge": [("branch-loft", None)],
    "slabs": [("hermite-dc", None)],
    "tube": [("path-sweep", "sweep"), ("revolve", "lathe"), ("section-loft", None), ("smooth-loft", None)],
    "cup": [("revolve", "lathe")],
    "oblique": [("section-network", "diagonal")],
    "notch": [("section-network", "network")],
    "blocks": [("voxel", None), ("greedy", None), ("monotone", None)],
    "canard": [("section-loft", "x"), ("heightfield", None), ("marching-cubes", None)],
    "wing": [("section-loft", "x"), ("heightfield", None), ("marching-cubes", None)],
    "canopy": [("smooth-loft", "y"), ("surface-nets", None), ("revolve", "canopy-lathe")],
}


def assess(part, method, path, output):
    mesh, doc, uv, texture = read_mesh(output)
    rgba, step, origin = read_stack(path)
    meta = json.loads((path / "stack.json").read_text())
    assert doc["nodes"][0]["extras"] == {
        "pivot": meta["pivot"],
        "size": [*meta["size"][:2], meta["layers"] * meta["spacing"]],
    }
    mask = rgba[:, :, :, 3] >= 128
    candidate = voxelize(mesh, mask.shape, step, origin)
    row = {
        "triangles": len(mesh.faces),
        "vertices": doc["accessors"][0]["count"],
        "watertight": mesh.is_watertight,
        "winding": mesh.is_winding_consistent,
        "volume": float(mesh.volume),
        "stack_iou": (mask & candidate).sum() / (mask | candidate).sum(),
    }
    assert row["watertight"] and row["winding"] and row["volume"] > 0, row
    if part.endswith("-saddle"):
        # Body-diagonal positives are separated (the trilinear center is .25).
        # A face diagonal has a singular .5 saddle; record the library tie choice.
        row["components"] = mesh.body_count
        assert mesh.body_count == (2 if part == "interior-saddle" else 1)
    if part == "waist":
        # Recut the actual GLB at the replacement and halfway from the previous control.
        widths = []
        for z in (2.5, 5.0, 7.5):
            points, _, _ = mesh.ray.intersects_location([[-20, 0.001, z]], [[1, 0, 0]])
            widths.append(float(np.ptp(points[:, 0])))
        assert np.allclose([widths[0], widths[-1]], [12, 6]) and 6 < widths[1] < 12, widths
        row["control_and_mid_widths"] = widths
    if part == "sphere":
        row["dihedral_p95_deg"] = float(np.percentile(np.rad2deg(mesh.face_adjacency_angles), 95))
        row["dihedral_max_deg"] = float(np.rad2deg(mesh.face_adjacency_angles).max())
    if part == "merge":
        from scipy.ndimage import label

        counts = [label(candidate[:, :, k])[1] for k in (3, 12, 26)]
        assert counts == [2, 3, 2] and mesh.body_count == 2, counts
        row["components_at_z3_12_26"] = counts
    if part == "blocks":
        n, bad = block_coverage(mesh, rgba, uv, texture)
        row.update(exposed=n, color_mismatches=bad)
        if method != "voxel":
            assert bad == 0
    if part == "box":
        corners = np.array(np.meshgrid(*[(2, 14)] * 3)).reshape(3, -1).T * step + origin
        row["max_corner_distance"] = float(cKDTree(mesh.vertices).query(corners)[0].max())
        row["max_dihedral_deg"] = float(np.rad2deg(mesh.face_adjacency_angles).max())
        if method != "marching-cubes":
            assert np.isclose(row["max_dihedral_deg"], 90)
            assert row["max_corner_distance"] < 1e-5
    if part in ("bore", "tube") and method != "heightfield":
        assert not candidate[8, 8].any()
        hits = mesh.ray.intersects_any([[0.013, 0.027, mesh.bounds[0, 2] - 1]], [[0, 0, 1]])
        assert not hits[0]
        row["open_bore"] = True
    if part == "cup":
        assert candidate[8, 8, 3] and not candidate[8, 8, 8]
    if part == "slabs":
        assert np.array_equal(mask, candidate)
    if part == "fork":
        from scipy.ndimage import label

        row["components_at_z3_11"] = [label(candidate[:, :, k])[1] for k in (3, 11)]
        assert row["components_at_z3_11"] == [1, 2]
    if part in ("notch", "oblique"):
        import shapely as sh
        from trimesh.intersections import mesh_plane

        distances = []
        guide = "network" if part == "notch" else "diagonal"
        guides = json.loads((output.parent / (guide + ".json")).read_text())
        for section in guides["sections"]:
            basis = np.array([section["u"], section["v"]])
            lines = mesh_plane(mesh, np.cross(*basis), section["origin"])
            lines = (lines - np.array(section["origin"])) @ basis.T
            recut = sh.build_area(sh.union_all(sh.set_precision(sh.linestrings(lines), 1e-6)))
            assert recut.geom_type == "Polygon" and len(recut.interiors) == 0
            distance = float(
                sh.hausdorff_distance(recut.boundary, sh.Polygon(section["outer"]).boundary, densify=0.25)
            )
            assert distance < 0.6 * np.linalg.norm(step)
            distances.append(distance)
        row["independent_recut_hausdorff"] = distances
        # At horizontal z=8 and vertical y=3 the previously filled notch is now empty.
        assert not candidate[11, 11, 8] and not candidate[11, 11, 4] and candidate[4, 11, 8]
    if part in ("canard", "canopy", "wing"):
        row["volume_iou_27"] = volume_iou(mesh, mask, step, origin)
        row["intermediate"] = intermediate_sections(mesh, mask, step, origin, 1 if part == "canopy" else 0)
        row["thickness_error"] = thickness(mesh, mask, step, origin, 1 if part == "canopy" else 0)
        # Render the *mesh* from each calibrated orthographic camera. Projecting
        # cell-center occupancy would miss thin surfaces, especially in the lathe.
        atlas = Image.open(PARTS / "atlases" / f"{part}.png").convert("RGBA")
        boxes = json.loads((PARTS / "calibration.json").read_text())[part]["views"]
        ious = {}
        for name, (x, y, w, h) in boxes.items():
            gt = np.asarray(atlas.crop((x, y, x + w, y + h)))[:, :, 3] >= 128
            ax, u, v, us, vs = {
                "top": (2, 0, 1, 1, 1),
                "left": (0, 1, 2, -1, -1),
                "front": (1, 0, 2, 1, -1),
                "rear": (1, 0, 2, -1, -1),
            }[name]
            # Include both silhouettes outside the nominal camera frame.
            extra = max(w, h) // 2
            target = np.pad(gt, extra)
            pixels = np.indices(target.shape).reshape(2, -1).T[:, ::-1] + 0.5 - extra
            uvn = pixels / [w, h]
            uvn[:, 0] = uvn[:, 0] if us > 0 else 1 - uvn[:, 0]
            uvn[:, 1] = uvn[:, 1] if vs > 0 else 1 - uvn[:, 1]
            starts = np.empty((len(pixels), 3))
            starts[:, [u, v]] = uvn * (np.array(mask.shape) * step)[[u, v]] + origin[[u, v]]
            starts[:, ax] = mesh.bounds[0, ax] - step[ax]
            pred = np.zeros(len(starts), bool)
            for start in range(0, len(starts), 100000):
                rays = starts[start : start + 100000]
                pred[start : start + len(rays)] = mesh.ray.intersects_any(
                    rays, np.tile(np.eye(3)[ax], (len(rays), 1))
                )
            pred = pred.reshape(target.shape)
            ious[name] = (target & pred).sum() / (target | pred).sum()
        row["atlas_iou"] = ious
    return row


def check_rejections(out):
    from tempfile import TemporaryDirectory

    narrow = {"outer": [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]]}
    cases = [
        ("fork", "section-loft", {}, "branch-loft"),
        ("interior-saddle", "hermite-dc", {}, "multiple sheets"),
        (
            "bore",
            "path-sweep",
            {"path": [[-3, -3, 8], [3, 3, 8], [-3, 3, 8], [3, -3, 8]], "up": [0, 0, 1], "profile": narrow},
            "intersects itself",
        ),
        ("bore", "path-sweep", {"path": [[0, 0, 2], [0, 0, 3], [0, 0, 2]], "profile": narrow}, "reverses"),
    ]
    results = []
    with TemporaryDirectory() as scratch:
        guide = Path(scratch) / "guide.json"
        target = Path(scratch) / "result.glb"
        for part, method, data, reason in cases:
            guide.write_text(json.dumps(data))
            proc = subprocess.run(
                [
                    "node",
                    ROOT / "apps/cli/bin/stack3.mjs",
                    "mesh",
                    out / part,
                    "--mesh-method",
                    method,
                    "--guide",
                    guide,
                    "--output",
                    target,
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            assert proc.returncode and str(out / part) in proc.stderr and reason in proc.stderr, proc.stderr
            assert not target.exists()
            results.append({"part": part, "method": method, "reason": reason})
    (out / "rejections.json").write_text(json.dumps(results, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reuse", action="store_true", help="measure previously generated GLBs")
    args = parser.parse_args()
    out = args.output.resolve()
    generate(out)
    check_rejections(out)
    results = {}
    for part, methods in CASES.items():
        path = PARTS / "stacks" / part if (PARTS / "stacks" / part).exists() else out / part
        for method, guide in methods:
            name = f"{part}-{method}"
            output = out / (name + ".glb")
            if not (args.reuse and output.exists()):
                cmd = [
                    "node",
                    ROOT / "apps/cli/bin/stack3.mjs",
                    "mesh",
                    path,
                    "--mesh-method",
                    method,
                    "--output",
                    output,
                ]
                if guide:
                    cmd.extend(["--guide", out / (guide + ".json")])
                subprocess.run(cmd, check=True)
            results[name] = assess(part, method, path, output)
            print(name, results[name], flush=True)
            (out / "measurements.json").write_text(
                json.dumps(results, indent=2, default=lambda x: x.item()) + "\n"
            )


if __name__ == "__main__":
    main()
