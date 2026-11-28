# /// script
# dependencies = ["numpy>=2,<3", "trimesh>=4.5,<5", "rtree>=1.3,<2", "scipy>=1.15,<2", "pillow>=11,<13"]
# ///
"""Measure X/Y/Z solid intervals from the original GLB and run Stack3 Hermite DC."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
import trimesh

from dexel_capture import capture

EXAMPLE = Path(__file__).resolve().parents[1]
CABINET = EXAMPLE / "public/models/cabinet"
CLI = EXAMPLE.parents[1] / "apps/cli/bin/stack3.mjs"
# From glTF (right, up, towards viewer) to the stack's right, depth, height.
TO_STACK = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]])


def build(scale):
    scene = trimesh.load_scene(CABINET / "reference.glb", process=False)
    parts = []
    for node in scene.graph.nodes_geometry:
        transform, key = scene.graph[node]
        mesh = scene.geometry[key].copy()
        mesh.apply_transform(TO_STACK @ transform)
        parts.append(mesh)
    manifest = json.loads((CABINET / "stack.json").read_text())
    base_grid = np.array([manifest[k] for k in ("width", "depth", "layers")])
    grid = base_grid * scale
    print(f"{scale}× grid {grid.tolist()}", flush=True)
    size = np.array(manifest["size"])
    origin = -size * [.5, .5, 0] - manifest["pivot"]
    step = size / grid
    data = dict(version=1, grid=grid, origin=origin, step=step)
    masks = []
    for axis, name in enumerate("xyz"):
        arrays, mask = capture(parts, axis, grid, origin, step)
        data.update({f"{name}_{key}": value for key, value in arrays.items()})
        masks.append(mask)
    if not all(np.array_equal(mask, masks[0]) for mask in masks[1:]):
        raise ValueError("Axis captures disagree at cell centers")

    # RGB uses the same saved four-view colors. Only alpha is replaced by
    # occupancy independently measured from the reference solid.
    bw, bd, bl = base_grid
    base = np.array(Image.open(CABINET / "stack.png").convert("RGBA"))
    tiles = base.reshape(-1, bd, manifest["columns"], bw, 4).transpose(0, 2, 3, 1, 4)
    volume = tiles.reshape(-1, bw, bd, 4)[:bl].transpose(1, 2, 0, 3).copy()
    painted = volume[..., 3] >= 128
    nearest = distance_transform_edt(~painted, sampling=size/base_grid, return_distances=False, return_indices=True)
    volume = volume[tuple(nearest)]
    for axis in range(3):
        volume = volume.repeat(scale, axis=axis)
    volume[..., 3] = masks[0] * 255
    volume[~masks[0]] = 0
    w, d, layers = map(int, grid)
    columns = min(layers, 4096 // w)
    rgba = np.zeros((((layers + columns - 1) // columns) * d, columns * w, 4), np.uint8)
    for layer in range(layers):
        row, col = divmod(layer, columns)
        rgba[row*d:(row+1)*d, col*w:(col+1)*w] = volume[:, :, layer].transpose(1, 0, 2)
    manifest.update(width=w, depth=d, layers=layers, columns=columns, spacing=float(step[2]))
    key = "dexel" if scale == 1 else f"dexel-{scale}x"
    target = CABINET / key
    target.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target) as tmp:
        folder = Path(tmp)
        np.savez_compressed(folder / "crossings.npz", **data)
        Image.fromarray(rgba).save(folder / "stack.png")
        (folder / "stack.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (folder / "guide.json").write_text('{"dexel":"crossings.npz"}\n')
        recipe = """version: 1
nodes:
  - {id: source, type: load-stack, path: .}
  - {id: mesh, type: extract-mesh, input: source, method: hermite-dc, guide: guide.json}
  - {id: export, type: write-glb, input: mesh, path: dexel.glb, lit: true}
"""
        (folder / "pipeline.yaml").write_text(recipe)
        subprocess.run(["node", str(CLI), "pipeline", "run", str(folder / "pipeline.yaml")], check=True)
        result = trimesh.load_scene(folder / "dexel.glb", process=False).to_mesh()
        catalog_file = CABINET.parent / "catalog.json"
        catalog = json.loads(catalog_file.read_text())
        catalog["cabinet"][key] = len(result.faces)
        for file in folder.iterdir():
            file.replace(target / file.name)
        catalog_file.write_text(json.dumps(catalog, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scales", type=int, nargs="*", default=[1, 2, 4])
    args = parser.parse_args()
    for scale in args.scales:
        if scale not in (1, 2, 4):
            parser.error("expected 1, 2 or 4")
        build(scale)
