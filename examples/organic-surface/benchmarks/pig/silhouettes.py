"""Rasterize assembled GLB triangles in the whole atlas frame, including the isolated tail's LEFT projection."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_fill_holes,label
out=Path(__file__).resolve().parent
folder=Path(sys.argv[1])
names=('Head','Torso','Snout','Curled tail','Eye.L','Eye.R','Ear.L','Ear.R')
meshes=[(name,np.load(folder/(name+'.npz'))) for name in names]
views={}
for name in ['front','rear','left','top']:
    mask=np.asarray(Image.open(out/'whole'/(name+'.png')))[...,3]>=128
    views[name]=mask
# Unit height. Each pair of agreeing dimensions contributes equally to the shared axes.
fh,fw=views['front'].shape;sh,sw=views['left'].shape;th,tw=views['top'].shape
D=sw/sh;W=(fw/fh+D*tw/th)*.5
result={}
for view,ref in views.items():
    h,w=ref.shape
    im=Image.new('L',(w*2,h*2)); tail=Image.new('L',im.size)
    draw=ImageDraw.Draw(im);td=ImageDraw.Draw(tail)
    for name,mesh in meshes:
        x,y,z=mesh['v'].T
        uv={'front':(.5+x/W,1-z),'rear':(.5-x/W,1-z),'left':(.5-y/D,1-z),'top':(.5+x/W,.5+y/D)}[view]
        points=np.rint(np.column_stack(uv)*[2*w,2*h]-.5).astype(int)
        for tri in points[mesh['f']]:
            coords=tri.flatten().tolist();draw.polygon(coords,fill=255)
            if name=='Curled tail':td.polygon(coords,fill=255)
    pred=np.asarray(im.resize((w,h),Image.Resampling.BOX))>=128
    result[view]=float((pred&ref).sum()/(pred|ref).sum())
    if view=='left':
        t=np.asarray(tail.resize((w,h),Image.Resampling.BOX))>=128
        holes=binary_fill_holes(t)&~t
        result['tail_enclosed_background_pixels_in_left_view']=int(holes.sum())
(out/'silhouettes.json').write_text(json.dumps(result,indent=2)+'\n')
print(result)
