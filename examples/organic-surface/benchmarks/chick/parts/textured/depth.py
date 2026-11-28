"""Capture registered per-part XYZ intervals, then reconstruct the export mesh."""
import argparse,json,subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
cli=root.parents[4]/'apps/cli/bin/stack3.mjs'
parser=argparse.ArgumentParser()
parser.add_argument('part',choices=['crest','beak','leg'])
parser.add_argument('--reference',type=Path,help='Independently authored closed GLB in the fitted stack frame')
args=parser.parse_args()
folder=root/args.part
dest=folder/'depth'
dest.mkdir(exist_ok=True)
def run(*argv):
    subprocess.run(['node',str(cli),*argv],check=True,cwd=folder)
if args.reference:
    source=args.reference.resolve()
else:
    source=dest/'atlas-derived-reference.glb'
    run('mesh','fitted','--mesh-method','organic','--guide','fitted.json','--output',str(source))
run('capture-dexel','fitted','--source',str(source),'--output','depth/intervals.npz')
guide=dict(dexel='depth/intervals.npz',dexelOccupancy='measured',sigma=0,
           extractor='marching-cubes',interpolation='cubic',smoothingIterations=2)
(folder/'dexel.json').write_text(json.dumps(guide,indent=2)+'\n')
recipe=(folder/'fitted.yaml').read_text().replace('./fitted.json','./dexel.json').replace('./fitted.glb','./dexel.glb')
(folder/'dexel.yaml').write_text(recipe)
run('pipeline','run','dexel.yaml')
