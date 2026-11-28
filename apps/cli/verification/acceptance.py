"""Deterministic acceptance checks and two-dimensional camera evidence."""
import math

import numpy as np
from PIL import ImageDraw

from panels import CYAN, GREEN, RED, canvas, dot, sheet


def dimensions(panels, tolerance):
    ranges = {}
    for view, panel in panels.items():
        if panel.scale is None:
            return dict(verdict="UNCONFIRMED", differences=[])
        y, x = np.nonzero(panel.mask)
        for axis, points in zip(panel.axes, (x, y)):
            ranges.setdefault(axis, []).append((view, float(points.max()-points.min()+1), panel.scale))
    differences = []
    for axis, entries in ranges.items():
        for i, (view, pixels, scale) in enumerate(entries):
            for other, other_pixels, other_scale in entries[i+1:]:
                error = abs(pixels/scale-other_pixels/other_scale)*max(scale, other_scale)
                differences.append(dict(axis=axis, views=[view, other], errorPx=error))
    return dict(verdict="FAIL" if any(d["errorPx"] > tolerance for d in differences) else "PASS",
                differences=differences)


def camera(panels, config, tolerance):
    if not isinstance(config, dict) or set(config) - set(panels):
        raise ValueError("axisPairs must map known views to lists of annotated pairs")
    images = canvas(panels)
    checks = {}
    for view, panel in panels.items():
        pairs = config.get(view, [])
        if not isinstance(pairs, list):
            raise ValueError(f"{view}: axisPairs must be a list")
        rows = []
        drawing = ImageDraw.Draw(images[view])
        y, x = np.nonzero(panel.mask)
        bounds = tuple(map(int, (x.min(), y.min(), x.max(), y.max())))
        drawing.rectangle(bounds, outline=CYAN)
        w, h = bounds[2]-bounds[0]+1, bounds[3]-bounds[1]+1
        drawing.text((bounds[0], max(0, bounds[1]-12)), f"{w} x {h} px", fill=CYAN)
        if view != "top" and panel.origin is not None:
            ground = panel.origin[1]
            if 0 <= ground < panel.mask.shape[0]:
                drawing.line([(0, ground), (panel.mask.shape[1]-1, ground)], fill=CYAN, width=1)
        for pair in pairs:
            evidence = pair["evidence"]
            if not isinstance(evidence, str) or not evidence.strip():
                raise ValueError(f"{view}: axis pair needs an evidence description")
            a, b = (panel.annotation(xy, f"{view} axis pair") for xy in pair["points"])
            error = math.dist(a, b)
            passed = error <= tolerance
            color = GREEN if passed else RED
            drawing.line([tuple(a), tuple(b)], fill=color, width=2)
            dot(drawing, a, color)
            dot(drawing, b, color)
            rows.append(dict(points=[a, b], evidence=evidence, errorPx=error, passed=passed))
        checks[view] = rows
    verdict = ("FAIL" if any(not row["passed"] for rows in checks.values() for row in rows)
               else "PASS" if all(checks.values()) else "UNCONFIRMED")
    overlay = sheet(images, "Orthographic atlas guides", "Cyan: silhouette / registered ground   Green: pass   Red: fail")
    return dict(verdict=verdict, views=checks), overlay


def acceptance(data, panels, results, tolerance, save_overlay):
    sizes = dimensions(panels, tolerance)
    cameras, overlay = camera(panels, data.get("axisPairs", {}), tolerance)
    save_overlay("atlas-guides", cameras, overlay)
    projection = results.get("projections", {})
    contour = ("UNCONFIRMED" if projection.get("status") != "measured"
               else "FAIL" if projection["unsupportedSamples"] else "PASS")
    marks = results.get("landmarks", {}).get("landmarks", [])
    shared = [e for row in marks for pair in row["sharedAxes"] for e in pair["sharedErrorPx"].values()]
    held_out = [p["errorPx"] for row in marks for p in row["predictions"]]
    landmarks = ("FAIL" if any(e > tolerance for e in shared + held_out)
                 else "PASS" if held_out and all(row["status"] == "measured" for row in marks)
                 else "UNCONFIRMED")
    checks = dict(dimensions=sizes, cameras=cameras, projections=dict(verdict=contour),
                  landmarks=dict(verdict=landmarks))
    verdicts = {check["verdict"] for check in checks.values()}
    verdict = "FAIL" if "FAIL" in verdicts else "PASS" if verdicts == {"PASS"} else "UNCONFIRMED"
    return dict(version=1, verdict=verdict, checks=checks,
                inputs={view: panel.fingerprint for view, panel in panels.items()})
