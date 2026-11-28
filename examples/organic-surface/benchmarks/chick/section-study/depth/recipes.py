import json
from pathlib import Path

regions = [
    {"center":[-.33,.015,.42],"radii":[.23,.28,.22]},
    {"center":[.33,.015,.42],"radii":[.23,.28,.22]},
    {"center":[.055,.21,.75],"radii":[.18,.24,.15]}
]
for name,src,fuse in (("roundtrip","prior.npz",True),("fused","synthetic.npz",True),("full","synthetic.npz",False)):
    guide=dict(dexel=src,dexelOccupancy="measured",sigma=0,extractor="marching-cubes",
               interpolation="cubic",smoothingIterations=6 if fuse else 0)
    if fuse:
        guide.update(field="../contour/field.npy",depthRegions=regions)
    Path(name+".json").write_text(json.dumps(guide,indent=2)+"\n")
    Path(name+".yaml").write_text(f"""version: 1
nodes:
  - {{ id: color, type: load-stack, path: ../contour }}
  - id: measured
    type: extract-mesh
    input: color
    method: organic
    guide: ./{name}.json
    finish: {{ triangleBudget: 1600 }}
  - {{ id: export, type: write-glb, input: measured, path: ./{name}.glb, lit: true }}
""")
