"""Give every arm the same Gaussian support in scene units around the carved volume."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

radius = 1.25 * min(0.853416063247977 / 32, 0.8239564428312159 / 31, 1 / 32)
for tag in ("32-32", "32-64", "32-128", "64-64"):
    source = Path("../stack" if tag == "32-32" else "stack-" + tag)
    meta = json.loads((source / "stack.json").read_text())
    w, d, layers, c = (meta[key] for key in ("width", "depth", "layers", "columns"))
    atlas = np.array(Image.open(source / "stack.png").convert("RGBA"))
    slices = atlas.reshape(-1, d, c, w, 4).transpose(0, 2, 1, 3, 4).reshape(-1, d, w, 4)[:layers]
    pitch = np.array(meta["size"]) / [w, d, layers]
    px, py, pz = np.ceil(4 * radius / pitch).astype(int) + 1
    slices = np.pad(slices, ((pz, pz), (py, py), (px, px), (0, 0)))
    nl, nd, nw, _ = slices.shape
    cols = min(32, nl)
    tiles = np.pad(slices, ((0, -nl % cols), (0, 0), (0, 0), (0, 0)))
    tiles = tiles.reshape(-1, cols, nd, nw, 4).transpose(0, 2, 1, 3, 4).reshape(-1, cols * nw, 4)
    padded = Path("padded-" + tag)
    padded.mkdir(exist_ok=True)
    Image.fromarray(tiles).save(padded / "stack.png")
    meta.update(width=nw, depth=nd, layers=nl, columns=cols, size=(pitch * [nw, nd, nl]).tolist())
    meta["pivot"][2] += float(pz * pitch[2])
    (padded / "stack.json").write_text(json.dumps(meta, indent=2) + "\n")
    guide = dict(extractor="hermite-dc", interpolation="cubic", sigma=radius / min(pitch), smoothingIterations=6)
    Path(tag+".json").write_text(json.dumps(guide)+"\n")
    recipe = f"""version: 1
nodes:
  - {{ id: input, type: load-stack, path: ./padded-{tag} }}
  - id: organic
    type: extract-mesh
    input: input
    method: organic
    guide: ./{tag}.json
    finish: {{ triangleBudget: 1600 }}
  - {{ id: export, type: write-glb, input: organic, path: ./{tag}.glb, lit: true }}
"""
    Path(tag + ".yaml").write_text(recipe)
