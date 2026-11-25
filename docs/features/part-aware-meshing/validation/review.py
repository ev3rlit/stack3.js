"""Pair each fixed-camera Blender render with a near section in scene coordinates."""

import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from measure import read_mesh, read_stack
from PIL import Image
from trimesh.intersections import mesh_plane

folder = Path(sys.argv[1])
parts = Path(__file__).resolve().parents[3] / "research/020-aircraft-rendering/part-atlases/stacks"
rows = [
    ("canard", "marching-cubes", "section-loft", "heightfield"),
    ("wing", "marching-cubes", "section-loft", "heightfield"),
    ("canopy", "surface-nets", "smooth-loft", "revolve"),
]
fig = plt.figure(figsize=(10, 8), layout="constrained")
panels = fig.subfigures(3, 1)
for panel, (part, *methods) in zip(panels, rows):
    rgba, step, origin = read_stack(parts / part)
    mask = rgba[:, :, :, 3] >= 128
    axis = 1 if part == "canopy" else 0
    uv = [1 - axis, 2]
    k = int((mask.shape[axis] - 1) * 0.5)
    center = origin.copy()
    center[axis] += (k + 0.50013) * step[axis]
    section = np.take(mask, k, axis=axis)
    lo, hi = np.argwhere(section).min(axis=0), np.argwhere(section).max(axis=0) + 1
    # Same crop for all methods; enlarge to include the axisymmetric candidate.
    items = []
    for m in methods:
        mesh = read_mesh(folder / f"{part}-{m}.glb")[0]
        lines = mesh_plane(mesh, np.eye(3)[axis], center)[:, :, uv]
        items.append(lines)
    bounds = np.vstack([origin[uv] + np.array([lo, hi]) * step[uv], *(ls.reshape(-1, 2) for ls in items)])
    low, high = bounds.min(axis=0), bounds.max(axis=0)
    axes = panel.subplots(2, 3, gridspec_kw={"height_ratios": [1.5, 1]})
    panel.suptitle(part.capitalize(), fontsize=14, fontweight="bold", x=0.035, ha="left")
    for j, (method, lines) in enumerate(zip(methods, items)):
        top, bottom = axes[:, j]
        top.imshow(Image.open(folder / f"{part}-{method}.png"))
        top.set_title(method, fontsize=10)
        top.axis("off")
        lower = origin[uv]
        upper = lower + np.array(section.shape) * step[uv]
        bottom.imshow(
            section.T,
            cmap="Greys",
            vmin=0,
            vmax=2,
            interpolation="nearest",
            origin="lower",
            extent=[lower[0], upper[0], lower[1], upper[1]],
        )
        bottom.add_collection(LineCollection(lines, colors="#bd4618", linewidths=1))
        margin = (high - low) * 0.06
        bottom.set(
            xlim=(low[0] - margin[0], high[0] + margin[0]),
            ylim=(low[1] - margin[1], high[1] + margin[1]),
            aspect="equal",
        )
        bottom.tick_params(labelsize=6)
fig.suptitle("Saved parts  /  fixed-camera renders and mid-span sections", fontsize=17)
fig.legend(
    handles=[
        Line2D([], [], color="#aaa", linewidth=5, label="Saved occupancy"),
        Line2D([], [], color="#bd4618", label="GLB re-cut (scene units)"),
    ],
    loc="outside lower center",
    ncol=2,
)
fig.savefig(folder / "comparison.png", dpi=170)
