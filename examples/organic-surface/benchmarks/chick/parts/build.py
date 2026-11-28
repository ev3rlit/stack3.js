"""Rebuild the five saved stacks and their local-space meshes."""
from pathlib import Path
import json
import subprocess

root=Path(__file__).resolve().parent
cli=root.parents[4]/"apps/cli/bin/stack3.mjs"
parts={
    "body": (64,64,"round",1.55,6,480),
    "wing": (48,40,"round",1.20,5,128),
    "crest": (48,48,"silhouette",.95,4,220),
    "beak": (52,48,"round",.63,2,164),
    "leg": (48,40,"silhouette",.88,4,240)
}

def build(name):
    xy,z,profile,sigma,taubin,budget=parts[name]
    work=root/name
    def run(*args):
        subprocess.run(["node",str(cli),*args],cwd=work,check=True)
    run("build","views.json","--resolution",str(xy),"--layers",str(z),
        "--height","1","--profile",profile,"--format","stack","--output","stack")
    guide=dict(extractor="marching-cubes",interpolation="cubic",sigma=sigma,smoothingIterations=taubin)
    (work/"surface.json").write_text(json.dumps(guide,indent=2)+"\n")
    (work/"mesh.yaml").write_text(f"""version: 1
nodes:
  - {{ id: stack, type: load-stack, path: ./stack }}
  - id: surface
    type: extract-mesh
    input: stack
    method: organic
    guide: ./surface.json
    finish: {{ triangleBudget: {budget} }}
  - {{ id: export, type: write-glb, input: surface, path: ./part.glb, lit: true }}
""")
    run("pipeline","run","mesh.yaml")

if __name__=="__main__":
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(build,parts))
