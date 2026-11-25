"""Read the existing independent part images, for native surface UVs and section widths."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
here=Path(__file__).resolve().parent
src=here.parent/'part-atlases'
out=Path(sys.argv[1]);spec=json.loads((src/'calibration.json').read_text())
tables={}
for k in ('wing','canard','canopy','fin','fuselage'):
    full=Image.open(src/'atlases'/f'{k}.png').convert('RGBA')
    tables[k]={}
    for view in ('top','left','front'):
        x,y,w,h=spec[k]['views'][view]
        a=np.asarray(full.crop((x,y,x+w,y+h)))
        mask=a[...,3]>=128
        nearest=nd.distance_transform_edt(~mask,return_distances=False,return_indices=True)
        Image.fromarray(a[tuple(nearest)][...,:3]).save(out/f'{k}-{view}.png')
        # Normalized ranges in image rows at each x, and columns at each y.
        for n,grid in [('rows',mask.T),('cols',mask)]:
            good=grid.any(axis=1);pos=np.arange(len(grid))
            lo=np.interp(pos,pos[good],grid[good].argmax(1))/grid.shape[1]
            hi=np.interp(pos,pos[good],grid.shape[1]-grid[good,::-1].argmax(1))/grid.shape[1]
            tables[k][view+'_'+n]=[nd.gaussian_filter1d(z,1.25).tolist() for z in (lo,hi)]
(out/'tables.json').write_text(json.dumps(tables))
