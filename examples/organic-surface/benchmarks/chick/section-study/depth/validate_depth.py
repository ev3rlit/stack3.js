"""Evaluate the common ordered ray hits of the source and the budgeted GLBs."""
import json
import sys
from pathlib import Path
import numpy as np

folder=Path(sys.argv[1])
reference=np.load("synthetic.npz")
models={name:np.load(folder/f"check-{name}.npz") for name in ("baseline","roundtrip","fused")}
regions=json.loads(Path("fused.json").read_text())["depthRegions"]
grid,origin,step=[reference[k] for k in ("grid","origin","step")]
report={}
for axis,part in [(0,"wings"),(1,"head")]:
    name="xyz"[axis]
    other=[i for i in range(3) if i!=axis]
    region_list=regions[:2] if part=="wings" else regions[2:]
    offsets=reference[name+"_offsets"]
    errors={m:[] for m in models}
    total=0
    for ray,(start,end) in enumerate(zip(offsets,offsets[1:])):
        t=reference[name+"_depth"][start:end]
        if not len(t):
            continue
        u,v=np.unravel_index(ray,grid[other])
        points=np.tile(origin,(len(t),1))
        points[:,other]+=(np.array([u,v])+.5)*step[other]
        points[:,axis]+=t
        keep=np.zeros(len(t),bool)
        for region in region_list:
            keep|=np.sum(((points-region["center"])/region["radii"])**2,axis=1)<=.7**2
        total+=int(keep.sum())
        slices={m:npz[name+"_offsets"][ray:ray+2] for m,npz in models.items()}
        if not keep.any() or any(b-a!=len(t) for a,b in slices.values()):
            continue
        for m,(a,b) in slices.items():
            errors[m].extend(abs(models[m][name+"_depth"][a:b][keep]-t[keep]).tolist())
    report[part]=dict(reference_hits=total,common_hits=len(errors["fused"]),
                      mean_abs_depth_error={m:float(np.mean(e)) for m,e in errors.items()})
print(json.dumps(report,indent=2))
Path("depth-errors.json").write_text(json.dumps(report,indent=2)+"\n")
