"""Write the independent Stack3 recipe and guide for each experimental arm."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NATIVE = "../layer-count/padded-32-64"
base = dict(interpolation="cubic", smoothingIterations=6, sigma=2.126339207306364)
cases = {
    "A": (NATIVE, "hermite-dc", {}, True),
    "B": (NATIVE, "hermite-dc", {}, False),
    "C": (NATIVE, "marching-cubes", {}, False),
    "D": (NATIVE, "surface-nets", {}, False),
    "R": (NATIVE, "regularized-dc", {}, False),
}
for case, stack in (("E64", "grid64"), ("E128", "grid128"), ("F", "ellipse"), ("F3", "superellipse3"), ("G", "loft")):
    cases[case] = (stack, "marching-cubes", dict(field=f"{stack}/field.npy", sigma=0), False)
iso = dict(field="loft/field.npy", sigma=0, targetEdgeLength=.038, adaptive=False)
cases["H"] = ("loft", "marching-cubes", iso, False)
cases["Hproj"] = ("loft", "marching-cubes", dict(iso, reproject=True), False)
for case in ("C", "F", "G", "Hproj"):
    stack, extractor, extras, _ = cases[case]
    cases[case + "-lod"] = (stack, extractor, extras, True)
for case, limit, remesh in (("L",False,False),("L-lod",True,False),("LR-lod",True,True)):
    extras = dict(field="contour/field.npy", sigma=0)
    if remesh:
        extras.update(targetEdgeLength=.038, adaptive=False, reproject=True)
    cases[case] = ("contour", "marching-cubes", extras, limit)

cases["LA-lod"] = ("contour", "marching-cubes", dict(field="contour/field.npy", sigma=0, targetEdgeLength=.038, adaptive=True, reproject=True), True)
# Pure extraction and resampling controls: disable the topology-dependent Taubin pass.
for source in ("B","C","D","R","E64","E128"):
    stack, extractor, extras, _ = cases[source]
    cases[source+"-raw"] = (stack, extractor, dict(extras, smoothingIterations=0), False)
for case, (stack, extractor, extras, lod) in cases.items():
    (ROOT/f"{case}.json").write_text(json.dumps(dict(base, extractor=extractor) | extras, indent=2)+"\n")
    finish = "    finish: { triangleBudget: 1600 }\n" if lod else ""
    (ROOT/f"{case}.yaml").write_text(f"""version: 1
nodes:
  - {{ id: stack, type: load-stack, path: {stack} }}
  - id: surface
    type: extract-mesh
    input: stack
    method: organic
    guide: ./{case}.json
{finish}  - {{ id: export, type: write-glb, input: surface, path: ./{case}.glb, lit: true }}
""")
