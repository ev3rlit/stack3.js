"""Synthetic saved stacks and independently specified measurements in pivot-relative XYZ."""

import json

import numpy as np
from PIL import Image


def save(folder, name, mask, step=(1.0, 1.0, 1.0), pivot=(0.0, 0.0, 0.0)):
    w, d, l = mask.shape
    columns = min(4, l)
    rgb = np.where((np.indices(mask.shape)[0] < w // 2)[..., None], [241, 61, 41], [26, 98, 210])
    # Exercise exact alpha threshold, non-square packing and opaque unused tiles.
    img = np.full((((l + columns - 1) // columns) * d, columns * w, 4), 255, np.uint8)
    for z in range(l):
        x, y = z % columns * w, z // columns * d
        img[y : y + d, x : x + w, :3] = rgb[:, :, z].transpose(1, 0, 2)
        img[y : y + d, x : x + w, 3] = 127 + mask[:, :, z].T
    path = folder / name
    path.mkdir(exist_ok=True, parents=True)
    Image.fromarray(img).save(path / "stack.png")
    (path / "stack.json").write_text(
        json.dumps(
            {
                "version": 1,
                "atlas": "stack.png",
                "width": w,
                "depth": d,
                "layers": l,
                "columns": columns,
                "spacing": step[2],
                "size": (np.array(mask.shape) * step).tolist(),
                "pivot": pivot,
                "layout": "row-major",
                "layerOrder": "bottom-to-top",
                "axes": "xy-ground-z-up-y-forward",
            }
        )
    )
    return path


def generate(folder):
    x, y, z = np.indices((16, 16, 16))
    box = (x >= 2) & (x < 14) & (y >= 2) & (y < 14) & (z >= 2) & (z < 14)
    save(folder, "box", box, (0.4, 0.6, 0.9), (1.0, -2.0, 3.0))
    hole = box & ~((x >= 6) & (x < 10) & (y >= 6) & (y < 10))
    save(folder, "bore", hole)
    save(folder, "waist", box)
    for name, other in [("interior-saddle", (3, 3, 3)), ("face-saddle", (3, 3, 2))]:
        saddle = np.zeros((6, 6, 6), bool)
        saddle[2, 2, 2] = saddle[other] = True
        save(folder, name, saddle)
    radius2 = (x + 0.5 - 8) ** 2 + (y + 0.5 - 8) ** 2
    save(folder, "tube", (radius2 < 25) & (radius2 > 4) & (z >= 2) & (z < 14))
    save(folder, "cup", (radius2 < 25) & ((radius2 > 4) | (z < 5)) & (z >= 2) & (z < 14))
    arm = np.maximum(z - 6, 0) * 0.50
    branch = (
        ((abs(x + 0.5 - 8 - arm) <= 1.7) | (abs(x + 0.5 - 8 + arm) <= 1.7))
        & (abs(y + 0.5 - 8) < 2.5)
        & (z >= 2)
    )
    save(folder, "fork", branch)
    # The second half merges the arms again. An adjacent third pipe stays separate.
    twin = np.concatenate((branch, branch[:, :, ::-1]), axis=2)
    twin[0, 7, 2:-2] = True
    save(folder, "merge", twin)
    save(folder, "sphere", (x + 0.5 - 8) ** 2 + (y + 0.5 - 8) ** 2 + (z + 0.5 - 8) ** 2 < 36)
    save(folder, "slabs", box & ((z == 3) | (z == 5)))
    block = hole & ((x < 11) | (z < 9)) & ~((x < 5) & (y < 6))
    block |= (x == 0) & (y == 0) & (z < 5)
    save(folder, "blocks", block)
    # The two ideal cuts describe an L-shaped prism. The prior deliberately
    # fills the notch, so a method ignoring guides cannot pass both re-cuts.
    save(folder, "notch", box)
    save(folder, "oblique", box)
    poly = [[-6, -6], [6, -6], [6, -1], [0, -1], [0, 6], [-6, 6]]
    guides = {
        "x": {"axis": "x"},
        "y": {"axis": "y"},
        "lathe": {"axis": "z", "origin": [0, 0, 0]},
        "canopy-lathe": {"axis": "y", "origin": [0, 0, 0.13]},
        "waist": {"axis": "z", "stations": [{"slice": 7, "outer": [[-3, -3], [3, -3], [3, 3], [-3, 3]]}]},
        "sweep": {"path": [[0, 0, 2], [0, 0, 8], [0, 0, 14]], "up": [1, 0, 0]},
        "network": {
            "sections": [
                {"origin": [0, 0, 8], "u": [1, 0, 0], "v": [0, 1, 0], "outer": poly, "source": "independent"},
                {
                    "origin": [0, 3, 0],
                    "u": [1, 0, 0],
                    "v": [0, 0, 1],
                    "outer": [[-6, 2], [0, 2], [0, 14], [-6, 14]],
                    "source": "independent",
                },
            ]
        },
    }
    c = 1 / np.sqrt(2)
    guides["diagonal"] = {
        "sections": [
            guides["network"]["sections"][0],
            {
                "source": "independent",
                "origin": [0, 0, 0],
                "u": [c, c, 0],
                "v": [0, 0, 1],
                "outer": [[-6 / c, 2], [0, 2], [0, 14], [-6 / c, 14]],
            },
        ]
    }
    for name, g in guides.items():
        (folder / (name + ".json")).write_text(json.dumps(g))
    return guides
