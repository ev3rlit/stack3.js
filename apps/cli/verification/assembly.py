import math

import cv2
import numpy as np
from PIL import Image, ImageDraw
from panels import CYAN, GOLD, RED, GREEN, canvas, dot, sheet, unregistered


def assemble(base, local, spec, tolerance):
    missing = unregistered(local)
    if missing:
        return dict(status="registration-needed", reason="Missing part registration", views=missing), None

    def read_pair(view, pair):
        p = local[view].annotation(pair["part"], view+".part")
        q = base[view].annotation(pair["whole"], view+".whole")
        return local[view].world(p), base[view].world(q)

    fits = spec.get("mounts", {})
    top = [read_pair("top", m) for m in fits.get("top", [])]
    front = [read_pair("front", m) for m in fits.get("front", [])]
    if len(top) < 2 or not front:
        return dict(status="registration-needed", reason="Need two TOP mounts and a FRONT height mount"), None
    p = np.array([[v["x"],v["y"]] for v,_ in top])
    q = np.array([[v["x"],v["y"]] for _,v in top])
    centered = p-p.mean(axis=0)
    denom = (centered**2).sum()
    if denom == 0:
        return dict(status="registration-needed", reason="TOP mounts must be distinct"), None
    scale = float((centered*(q-q.mean(axis=0))).sum()/denom)
    if scale <= 0:
        return dict(status="registration-needed", reason="TOP mounts disagree on part orientation"), None
    tx, ty = q.mean(axis=0)-scale*p.mean(axis=0)
    tz = sum(b["z"]-scale*a["z"] for a,b in front)/len(front)
    shift = dict(x=float(tx), y=float(ty), z=tz)
    def transform(view, xy):
        world = local[view].world(xy)
        return base[view].pixel({a: v*scale+shift[a] for a,v in world.items()})
    images = canvas(base)
    edges = {}
    for v,panel in local.items():
        lines = []
        for contour in panel.contours:
            coords = [transform(v, xy) for xy in contour]
            lines.append(np.rint(coords).astype(np.int32))
        pixels = np.array(images[v])
        cv2.polylines(pixels, lines, True, CYAN, 1)
        images[v].paste(Image.fromarray(pixels))
        edges[v] = lines
    residuals = []
    for v in ("top", "front"):
        for m in fits[v]:
            pred = transform(v,m["part"])
            residuals.append(dict(view=v, errorPx=math.dist(pred,m["whole"]), predicted=pred, whole=m["whole"]))
            dot(ImageDraw.Draw(images[v]), m["whole"], GREEN)
    checks = []
    for c in spec.get("checks", []):
        v = c["view"]
        whole = base[v]
        d = ImageDraw.Draw(images[v])
        if c.get("visible", True) is False:
            if "whole" in c:
                dot(d, whole.annotation(c["whole"], c["id"]), GOLD, 6)
            if "edge" in c:
                pts = [tuple(whole.annotation(pt, c["id"])) for pt in c["edge"]]
                if len(pts) >= 2:
                    d.line(pts, fill=GOLD, width=2)
            checks.append(dict(id=c["id"], view=v, status="occluded"))
            continue
        if "edge" in c:
            # Sample only the independently marked visible segment of the whole part.
            pts = np.array([whole.annotation(pt, c["id"]) for pt in c["edge"]])
            if len(pts) < 2:
                raise ValueError("a visible edge needs at least two points")
            pixels = np.ones(whole.mask.shape, np.uint8)
            cv2.polylines(pixels, edges[v], True, 0, 1)
            target = np.zeros_like(pixels)
            cv2.polylines(target, [np.rint(pts).astype(np.int32)], False, 1, 1)
            err = float(cv2.distanceTransform(pixels, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[target.astype(bool)].max()) if not pixels.all() else None
            row = dict(maxEdgeErrorPx=err, edge=c["edge"])
            bad = err is None or err > tolerance
            d.line([tuple(pt) for pt in pts], fill=RED if bad else GREEN, width=2)
        else:
            a = local[v].annotation(c["part"], c["id"])
            b = whole.annotation(c["whole"], c["id"])
            if any(a == m["part"] or b == m["whole"] for m in fits.get(v, [])):
                raise ValueError(f"{c['id']}: held-out check reuses a fit anchor in {v}")
            pred = transform(v, a)
            err = math.dist(pred,b)
            row = dict(predicted=pred, observed=b, errorPx=err)
            d.line([tuple(pred), tuple(b)], fill=RED, width=2)
            dot(d, pred, CYAN, 5)
            dot(d, b, GOLD)
        checks.append(dict(id=c["id"], view=v, status="measured" if err is not None else "outside-panel", **row))
    return dict(status="measured", transform=dict(scale=scale, offset=shift), fit=residuals, heldOut=checks), sheet(images,"Fixed part placement",
                    "Cyan: projected part   Green: mount / matched edge   Gold: observed or occluded   Red: residual")
