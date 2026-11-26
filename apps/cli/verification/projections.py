import math

import cv2
import numpy as np
from PIL import ImageDraw

from panels import RED, CYAN, GOLD, canvas, dot, sheet


def gap(intervals):
    """Smallest gap between a simultaneous choice of one interval per row."""
    if any(not row for row in intervals):
        return None
    at = [0]*len(intervals)
    best = math.inf
    while True:
        current = [row[pos] for row, pos in zip(intervals, at)]
        first_end = min(range(len(current)), key=lambda i: current[i][1])
        separation = max(a for a, _ in current) - current[first_end][1]
        if separation <= 1e-9:
            return 0
        best = min(best, separation)
        at[first_end] += 1
        if at[first_end] == len(intervals[first_end]):
            return best


def sample(source, xy, panels, distances):
    world = source.world(xy)
    lines, parallel = {}, []
    missing = next(a for a in "xyz" if a not in world)
    for name, target in panels.items():
        if target is source:
            continue
        if missing not in target.axes:
            u, v = target.pixel(world)
            i, j = math.floor(u+.5), math.floor(v+.5)
            if not (0 <= i < target.image.width and 0 <= j < target.image.height):
                parallel.append(dict(view=name, pixel=[u, v], gapPx=None, reason="outside panel"))
            elif not target.mask[j, i]:
                parallel.append(dict(view=name, pixel=[u, v], gapPx=float(distances[name][j, i])*source.scale/target.scale,
                                     reason="outside silhouette"))
        else:
            axis = next(a for a in target.axes if a in world)
            lines[name] = dict(axis=axis, coordinate=world[axis], intervals=target.intervals(axis, world[axis]))
    separation = gap([line["intervals"] for line in lines.values()])
    return dict(pixel=xy, missingAxis=missing, scanlines=lines,
                gapPx=None if separation is None else separation*source.scale, opposingView=parallel)


def failed(detail, tolerance):
    return (detail["gapPx"] is None or detail["gapPx"] > tolerance or
            any(p["gapPx"] is None or p["gapPx"] > tolerance for p in detail["opposingView"]))


def severity(detail):
    values = [detail["gapPx"], *(p["gapPx"] for p in detail["opposingView"])]
    return math.inf if None in values else max(values)


def runs(flags):
    """Consecutive failed contour samples, including a run crossing index zero."""
    if all(flags):
        yield list(range(len(flags)))
        return
    start = flags.index(False)
    run = []
    for delta in range(1, len(flags)+1):
        i = (start+delta) % len(flags)
        if flags[i]:
            run.append(i)
        elif run:
            yield run
            run = []


def mark_lines(detail, panels, images):
    for name, line in detail["scanlines"].items():
        panel = panels[name]
        i = panel.axes.index(line["axis"])
        fixed = panel.origin[i]+line["coordinate"]*panel.signs[i]*panel.scale
        def xy(free):
            return (fixed, free) if i == 0 else (free, fixed)
        d = ImageDraw.Draw(images[name])
        d.line([xy(0), xy(panel.image.size[1-i]-1)], fill=GOLD, width=1)
        for start, end in line["intervals"]:
            d.line([xy(panel.origin[1-i]+n*panel.signs[1-i]*panel.scale) for n in (start, end)], fill=CYAN, width=2)
    for other in detail["opposingView"]:
        dot(ImageDraw.Draw(images[other["view"]]), other["pixel"], GOLD)


def projections(panels, tolerance):
    images = canvas(panels)
    distances = {v: cv2.distanceTransform((~p.mask).astype("uint8"), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
                 for v, p in panels.items() if v in ("front", "rear")}
    findings = {}
    selected = None
    for name, p in panels.items():
        groups = []
        failed_count = total = 0
        d = ImageDraw.Draw(images[name])
        for contour_id, contour in enumerate(p.contours):
            details = [sample(p, xy, panels, distances) for xy in contour.tolist()]
            flags = [failed(s, tolerance) for s in details]
            total += len(flags)
            failed_count += sum(flags)
            for run in runs(flags):
                worst = max((details[i] for i in run), key=severity)
                points = [tuple(details[i]["pixel"]) for i in run]
                if len(points) > 1:
                    d.line(points, fill=RED, width=3)
                else:
                    dot(d, points[0], RED, 2)
                available = [details[i]["gapPx"] for i in run if details[i]["gapPx"] is not None]
                numeric = [severity(details[i]) for i in run if math.isfinite(severity(details[i]))]
                groups.append(dict(minSeparationPx=min(numeric, default=None), contour=contour_id, start=points[0], end=points[-1],
                                   count=len(run), minScanlineGapPx=min(available, default=None), sample=worst))
                # Prefer an actual finite gap between occupied intervals for the illustration.
                finite_gaps = [details[i] for i in run if (details[i]["gapPx"] or 0) > tolerance]
                illustration = max(finite_gaps, key=lambda row: row["gapPx"]) if finite_gaps else worst
                rank = (bool(finite_gaps), len(run))
                if selected is None or rank > selected[0]:
                    selected = (rank, name, illustration)
        findings[name] = dict(boundarySamples=total, unsupportedSamples=failed_count, runs=groups)
    if selected:
        _, name, detail = selected
        mark_lines(detail, panels, images)
        dot(ImageDraw.Draw(images[name]), detail["pixel"], GOLD, 7)
    count = sum(item["boundarySamples"] for item in findings.values())
    unsupported = sum(item["unsupportedSamples"] for item in findings.values())
    return (dict(status="measured", views=findings,
                 boundarySamples=count, unsupportedSamples=unsupported, unsupportedFraction=unsupported/count,
                 illustrated=None if not selected else dict(view=selected[1], **selected[2])),
            sheet(images, "Silhouette projection consistency",
                  "Red: unsupported contour   Gold: selected point / scanline   Cyan: occupied intervals"))
