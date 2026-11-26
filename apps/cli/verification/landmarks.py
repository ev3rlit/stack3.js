from itertools import combinations
import math

from PIL import ImageDraw
from panels import CYAN, GOLD, RED, canvas, dot, sheet


def landmarks(panels, items, tolerance):
    images = canvas(panels)
    rows = []
    seen = set()
    for item in items:
        name = item["id"]
        if not isinstance(name, str) or not name or name in seen:
            raise ValueError("each landmark requires a unique id")
        seen.add(name)
        refs, hidden, missing = {}, [], []
        for v, xy in item["points"].items():
            if v not in panels:
                raise ValueError(f"{name}: unknown view {v}")
            if xy is None:
                hidden.append(v)
            elif panels[v].origin is None or panels[v].scale is None:
                missing.append(v)
            else:
                refs[v] = panels[v].annotation(xy, name)
                dot(ImageDraw.Draw(images[v]), refs[v], CYAN)
        pairs, predictions = [], []
        for a, b in combinations((v for v in panels if v in refs), 2):
            aw, bw = panels[a].world(refs[a]), panels[b].world(refs[b])
            shared = sorted(aw.keys() & bw.keys())
            errors = {axis: abs(aw[axis]-bw[axis])*panels[b].scale for axis in shared}
            pairs.append(dict(inputs=[a,b], measuredIn=b, sharedErrorPx=errors))
            if max(errors.values()) > tolerance:
                continue
            world = {**aw, **bw}
            for axis in shared:
                world[axis] = (aw[axis]+bw[axis])/2
            for test, observed in refs.items():
                if test in (a,b) or not set(panels[test].axes) <= world.keys():
                    continue
                predicted = panels[test].pixel(world)
                error = math.dist(observed, predicted)
                drawing = ImageDraw.Draw(images[test])
                drawing.line([tuple(predicted), tuple(observed)], fill=RED, width=2)
                dot(drawing, predicted, GOLD, 6)
                predictions.append(dict(inputs=[a,b], heldOut=test, predicted=predicted, observed=observed, errorPx=error))
        status = "measured" if pairs else "registration-needed" if missing else "skipped"
        rows.append(dict(id=name, status=status, hidden=hidden, unregistered=missing, sharedAxes=pairs, predictions=predictions,
                         predictionNote=None if predictions else "No independent visible target with a compatible pair"))
    status = "measured" if any(r["status"] == "measured" for r in rows) else "registration-needed" if any(r["unregistered"] for r in rows) else "skipped"
    return dict(status=status, landmarks=rows), sheet(images, "Held-out landmark reprojection",
               "Cyan: observed   Gold: predicted from two other views   Red: residual")
