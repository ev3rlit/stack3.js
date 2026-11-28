"""Orthographic registration in pixel-center coordinates, without resampling source pixels."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import math

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw

AXES = {"top": ("x", "y"), "left": ("y", "z"), "front": ("x", "z"), "rear": ("x", "z")}
SIGNS = {"top": (1, 1), "left": (-1, -1), "front": (1, -1), "rear": (-1, -1)}
RED, CYAN, GOLD, GREEN = (205, 38, 58), (0, 152, 177), (241, 139, 0), (41, 155, 81)


def read_manifest(path):
    data = yaml.safe_load(Path(path).read_text(encoding="utf8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a YAML mapping")
    return data


def scalar(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: expected a finite number")
    return float(value)


def point(value, label):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label}: expected [u, v]")
    return [scalar(v, label) for v in value]


class Panel:
    def __init__(self, view, config, folder, images):
        self.view = view
        self.axes, self.signs = AXES[view], SIGNS[view]
        path = folder / config["image"]
        if path not in images:
            raw = path.read_bytes()
            with Image.open(BytesIO(raw)) as source:
                images[path] = (source.convert("RGBA"), sha256(raw).hexdigest())
        img, self.source_hash = images[path]
        if "crop" in config:
            x, y, w, h = config["crop"]
            if any(type(n) is not int for n in (x, y, w, h)) or min(x, y) < 0 or min(w, h) < 1 or x+w > img.width or y+h > img.height:
                raise ValueError(f"{view}: invalid crop [x,y,width,height]")
            img = img.crop((x, y, x+w, y+h))
        pixels = np.asarray(img)
        mode = config.get("mask", "alpha")
        self.mask = pixels[:, :, 3] >= 128
        if mode == "white":
            threshold = scalar(config.get("threshold", 238), "threshold")
            if not 0 <= threshold <= 255:
                raise ValueError("threshold must be in [0,255]")
            self.mask &= pixels[:, :, :3].min(axis=2) < threshold
        elif mode == "alpha" and self.mask.all() and "mask" not in config:
            raise ValueError(f"{view}: opaque panel; choose mask: white or explicitly confirm mask: alpha")
        elif mode != "alpha":
            raise ValueError(f"{view}: mask must be alpha or white")
        if not self.mask.any():
            raise ValueError(f"{view}: empty foreground")
        ys, xs = np.nonzero(self.mask)
        bounds = (slice(ys.min(), ys.max()+1), slice(xs.min(), xs.max()+1))
        visible = pixels[bounds].copy()
        visible[~self.mask[bounds]] = 0
        h, w = visible.shape[:2]
        self.fingerprint = dict(sourceSha256=self.source_hash,
                                viewSha256=sha256(f"{w}x{h}:".encode() + visible.tobytes()).hexdigest())
        self.image = Image.new("RGB", img.size, "white")
        self.image.paste(img, mask=img.getchannel("A"))
        self.origin = point(config["origin"], f"{view}.origin") if "origin" in config else None
        self.scale = scalar(config["scale"], f"{view}.scale") if "scale" in config else None
        if self.scale is not None and self.scale <= 0:
            raise ValueError(f"{view}: scale must be positive")
        self.contours = [c[:, 0, :] for c in cv2.findContours(self.mask.astype("uint8"), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)[0]]
        self.lines = {}

    def world(self, pixel):
        return {a: (pixel[i] - self.origin[i]) * self.signs[i] / self.scale for i, a in enumerate(self.axes)}

    def pixel(self, world):
        return [self.origin[i] + world[a] * self.signs[i] * self.scale for i, a in enumerate(self.axes)]

    def annotation(self, value, label):
        coord = point(value, label)
        if not all(0 <= c < limit for c, limit in zip(coord, self.image.size)):
            raise ValueError(f"{label}: point outside {self.view} panel")
        return coord

    def intervals(self, axis, constant):
        """All foreground pixel footprints on one scanline, in increasing world coordinates."""
        i = self.axes.index(axis)
        index = math.floor(self.origin[i] + constant*self.scale*self.signs[i] + .5)
        key = (i, index)
        if key not in self.lines:
            result = []
            if 0 <= index < self.image.size[i]:
                line = self.mask[:, index] if i == 0 else self.mask[index, :]
                runs = np.flatnonzero(np.diff(np.pad(line.astype(np.int8), 1))).reshape(-1, 2)
                j = 1-i
                for start, end in runs:
                    pair = [((float(n)-.5)-self.origin[j])*self.signs[j]/self.scale for n in (start, end)]
                    result.append(sorted(pair))
            self.lines[key] = sorted(result)
        return self.lines[key]


def atlas(path, data=None):
    if data is None:
        data = read_manifest(path)
    configs = data["views"]
    if not isinstance(configs, dict) or set(configs) != set(AXES):
        raise ValueError("views must map top, left, front and rear")
    images = {}
    panels = {v: Panel(v, configs[v], path.parent, images) for v in AXES}
    return data, panels


def unregistered(panels):
    return [v for v, p in panels.items() if p.origin is None or p.scale is None]


def dot(draw, xy, color, radius=4):
    x, y = xy
    draw.ellipse((x-radius, y-radius, x+radius, y+radius), outline=color, width=2)


def sheet(images, title, legend):
    # Keep pixel geometry untouched in each panel; pad cells only.
    width = max(360, max(im.width for im in images.values()) + 16)
    height = max(im.height for im in images.values()) + 32
    result = Image.new("RGB", (2*width, 2*height+54), (235, 238, 241))
    d = ImageDraw.Draw(result)
    d.text((8, 5), title, fill="black")
    d.text((8, 26), legend, fill="black")
    for i, (v, im) in enumerate(images.items()):
        x, y = i%2*width+8, i//2*height+56
        d.text((x, y), v.upper(), fill="black")
        result.paste(im, (x, y+16))
    return result


def canvas(panels):
    return {v: p.image.copy() for v, p in panels.items()}
