# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["numpy==2.2.6", "scipy==1.15.3", "scikit-image==0.25.2", "shapely==2.1.2"]
# ///
"""Saved stack -> selected surface -> typed buffers for stack3's GLB writer."""

import json
import sys
from pathlib import Path

import numpy as np
from blocks import block_mesh
from branches import branch_loft
from guided import revolve, sweep
from implicit import feature_mesh, mc33
from material import write_mesh
from network import section_network
from sections import heightfield, loft


def run(method, folder):
    meta = json.loads((folder / "input.json").read_text())
    w, d, l, c = [meta[k] for k in ("width", "depth", "layers", "columns")]
    tiles = np.fromfile(folder / "stack.rgba", np.uint8).reshape(-1, d, c, w, 4)
    rgba = tiles.transpose(0, 2, 3, 1, 4).reshape(-1, w, d, 4)[:l].transpose(1, 2, 0, 3)
    mask = rgba[:, :, :, 3] >= 128
    if not mask.any():
        raise ValueError("saved stack contains no occupied samples")
    size = np.array(meta["size"])
    step = size / mask.shape
    origin = -size * [0.5, 0.5, 0] - meta["pivot"]
    g = meta["guide"]
    options = {
        "section-loft": ["axis", "stations"],
        "smooth-loft": ["axis", "stations"],
        "heightfield": ["axis"],
        "branch-loft": ["axis"],
        "revolve": ["axis", "origin", "segments"],
        "path-sweep": ["path", "up", "profile"],
        "section-network": ["sections", "tolerance"],
    }
    if not isinstance(g, dict) or set(g) - set(options.get(method, [])):
        raise ValueError(f"expected guide object with fields {options.get(method, [])} for {method}")
    if method == "revolve" and "axis" not in g:
        raise ValueError("revolve requires an explicit axis and origin")
    name = g.get("axis", "z")
    if name not in ("x", "y", "z"):
        raise ValueError("axis must be x, y or z")
    axis = "xyz".index(name)
    if method in ("section-loft", "smooth-loft"):
        mesh = loft(mask, step, origin, axis, method == "smooth-loft", g.get("stations"))
    elif method == "heightfield":
        mesh = heightfield(mask, axis)
    elif method == "branch-loft":
        mesh = branch_loft(mask, step, axis)
    elif method == "revolve":
        mesh = revolve(mask, step, origin, g, axis)
    elif method == "path-sweep":
        mesh = sweep(mask, step, origin, g)
    elif method == "section-network":
        mesh = section_network(mask, step, origin, g)
    elif method in ("extended-mc", "hermite-dc"):
        mesh = feature_mesh(mask, step, method == "hermite-dc")
    elif method == "mc33":
        mesh = mc33(mask)
    elif method in ("greedy", "monotone"):
        mesh = block_mesh(mask, method == "monotone")
    else:
        raise ValueError(f"unknown method {method}")
    print(f"{method}: saved alpha/RGB; user guide fields {sorted(g)}")
    write_mesh(
        folder,
        mesh,
        rgba,
        step,
        origin,
        method in ("greedy", "monotone"),
        method in ("extended-mc", "hermite-dc"),
    )


if __name__ == "__main__":
    try:
        run(sys.argv[1], Path(sys.argv[2]))
    except (ValueError, TypeError, KeyError) as exc:
        sys.exit(str(exc))
