"""Carve the part stacks and contour the rounded head, torso and legs."""
from pathlib import Path
import subprocess,json
from concurrent.futures import ThreadPoolExecutor

root=Path(__file__).resolve().parent
cli=root.parents[3]/'apps/cli/bin/stack3.mjs'
def build(part):
    wd=root/part
    def run(*args):subprocess.run(['node',str(cli),*args],cwd=wd,check=True)
    run('build','atlas.png','--format','stack','--layout','top,left,front,rear','--resolution','48',
        '--layers','64' if part in ('head','ear','torso') else '40','--height','1',
        '--profile','round' if part in ('head','torso','leg') else 'silhouette','--output','stack')
    if part not in ('head','torso','leg'):return
    (wd/'surface.json').write_text(json.dumps(dict(sigma=1.05,extractor='marching-cubes',interpolation='cubic',smoothingIterations=4))+'\n')
    budget={'head':420,'torso':320,'leg':132}[part]
    (wd/'mesh.yaml').write_text(f"""version: 1
nodes:
  - {{ id: stack, type: load-stack, path: ./stack }}
  - id: surface
    type: extract-mesh
    input: stack
    method: organic
    guide: ./surface.json
    finish: {{ triangleBudget: {budget} }}
  - {{ id: write, type: write-glb, input: surface, path: ./part.glb, lit: true }}
""")
    run('pipeline','run','mesh.yaml')
if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(build,['head','torso','leg','ear','snout','tail']))
