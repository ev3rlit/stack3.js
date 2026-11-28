"""Sample one frozen field and an atlas-derived continuous loft in registered scene units."""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.interpolate import make_lsq_spline
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates


def read_stack(folder):
    meta = json.loads((folder / "stack.json").read_text())
    w, d, l, c = [meta[key] for key in ("width", "depth", "layers", "columns")]
    packed = np.asarray(Image.open(folder / "stack.png").convert("RGBA"))
    slices = packed.reshape(-1, d, c, w, 4).transpose(0, 2, 3, 1, 4).reshape(-1, w, d, 4)
    return meta, slices[:l].transpose(1, 2, 0, 3)


def view_extents(name, size, heights):
    mask = np.asarray(Image.open(Path("views") / (name + ".png")))[:, :, 3] >= 128
    h, w = mask.shape
    rows = mask[np.clip(((1 - heights) * h).astype(int), 0, h - 1)]
    if not np.all(rows.any(axis=1)):
        raise ValueError("Missing silhouette at a section station")
    left = (rows.argmax(axis=1) / w - .5) * size
    right = (.5 - rows[:, ::-1].argmax(axis=1) / w) * size
    if name == "left":
        return -right, -left
    return left, right


def section_field(axes, model_size, spline, exponent=2.0):
    heights = (np.arange(64) + .5) / 64
    bounds = np.column_stack((*view_extents("front", model_size[0], heights),
                              *view_extents("left", model_size[1], heights)))
    x, y, z = axes
    zs = np.clip(z, heights[0], heights[-1])
    if spline:
        # A cubic loft of corresponding ring points: for a fixed angle their
        # coordinates are linear combinations of these four spline coefficients.
        knots = np.r_[[heights[0]] * 4, heights[4:-3:4], [heights[-1]] * 4]
        limits = make_lsq_spline(heights, bounds, knots, k=3)(zs).T
    else:
        limits = [np.interp(zs, heights, values) for values in bounds.T]
    x0, x1, y0, y1 = limits
    a, b = np.maximum((x1-x0) / 2, .001), np.maximum((y1-y0) / 2, .001)
    dx = (x[:,None,None] - (x1+x0)/2) / a
    dy = (y[None,:,None] - (y1+y0)/2) / b
    # Signed implicit function with a length scale, not an exact Euclidean SDF.
    return ((abs(dx)**exponent + abs(dy)**exponent)**(1/exponent) - 1) * np.minimum(a,b)


def smoothstep(x):
    t = np.clip(x, 0, 1)
    return t*t*(3-2*t)


def save_grid(name, field, rgb, size, pivot):
    folder = Path(name)
    folder.mkdir(exist_ok=True)
    # Preserve signs without exact zeros for the external field contract.
    field = field.astype(np.float32)
    field[field == 0] = np.finfo(np.float32).eps
    np.save(folder / "field.npy", field)
    inside = field[1:-1,1:-1,1:-1] < 0
    w, d, l = inside.shape
    rgba = np.concatenate((rgb, (inside*255).astype(np.uint8)[..., None]),axis=3)
    tiles = rgba.transpose(2,1,0,3)
    columns = 16
    tiles = np.pad(tiles, ((0, -l % columns), (0,0),(0,0),(0,0)))
    png = tiles.reshape(-1,columns,d,w,4).transpose(0,2,1,3,4).reshape(-1, columns*w, 4)
    Image.fromarray(png).save(folder/"stack.png")
    meta = dict(version=1, atlas="stack.png",width=w,depth=d,layers=l,columns=columns,
                spacing=size[2]/l, size=size.tolist(),pivot=pivot.tolist(),layerOrder="bottom-to-top",
                layout="row-major",axes="xy-ground-z-up-y-forward")
    (folder/"stack.json").write_text(json.dumps(meta,indent=2)+"\n")


def main():
    meta, rgba = read_stack(Path("../layer-count/padded-32-64"))
    model = json.loads(Path("../layer-count/stack-32-64/stack.json").read_text())
    size, pivot = np.array(meta["size"]), np.array(meta["pivot"])
    pitch = size / rgba.shape[:3]
    origin = -size * [.5,.5,0] - pivot
    mask = rgba[...,3] >= 128
    occupied = np.pad(mask,1)
    raw = distance_transform_edt(~occupied, sampling=pitch) - distance_transform_edt(occupied, sampling=pitch)
    sigma = json.loads(Path("../layer-count/32-64.json").read_text())["sigma"]
    frozen = gaussian_filter(raw, sigma*pitch.min()/pitch, mode="nearest")
    nearest = distance_transform_edt(~mask, sampling=pitch,return_distances=False,return_indices=True)
    colors = rgba[tuple(nearest)][...,:3]
    for n in (64,128):
        axes = [o + (np.arange(n+2)-.5)*s/n for o,s in zip(origin,size)]
        coords = [(axis-o)/p+.5 for axis,o,p in zip(axes,origin,pitch)]
        field = map_coordinates(frozen,np.meshgrid(*coords,indexing="ij"),order=3,mode="mirror")
        lookup = [np.clip(np.rint(c[1:-1]-1).astype(int),0,extent-1)
                  for c,extent in zip(coords,mask.shape)]
        rgb = colors[np.ix_(*lookup)]
        save_grid(f"grid{n}",field,rgb,size,pivot)
        if n==64:
            z=axes[2]
            weight = smoothstep((z-.16)/.10)*smoothstep((.91-z)/.11)
            for name,spline,n_exp in (("ellipse",False,2),("superellipse3",False,3),("loft",True,2)):
                prior=section_field(axes,model["size"],spline,n_exp)
                save_grid(name,field*(1-weight)+prior*weight,rgb,size,pivot)


if __name__ == "__main__":
    main()
