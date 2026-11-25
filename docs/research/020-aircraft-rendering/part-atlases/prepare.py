"""Normalize each independently authored four-view image to its own component frame."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
# Bounds in pixels on the whole aircraft's registered four-view artwork.
# center-x relative to central column; y is rear-to-nose; z is upward.
parts={
    'fuselage':dict(dim=[94,555,61],center_x=0,y0=28,z0=35,layers=64,resolution=192,budget=2200),
    'canopy':dict(dim=[44,172,26],center_x=0,y0=266,z0=82,layers=40,resolution=150,budget=960),
    'nacelle':dict(dim=[49,299,54],center_x=29.5,y0=2,z0=37,layers=64,resolution=178,budget=1560),
    'wing':dict(dim=[193,233,38],center_x=132.5,y0=40,z0=44,layers=64,resolution=176,budget=1120),
    'fin':dict(dim=[54,158,88],center_x=70,y0=0,z0=69,layers=72,resolution=138,budget=740),
    'canard':dict(dim=[65,77,6.5],center_x=57,y0=274,z0=45,layers=30,resolution=110,budget=490),
}
def components(path,expected):
    img=np.array(Image.open(path).convert('RGB'))
    _,labels,stats,_=cv2.connectedComponentsWithStats((img.min(axis=2)<220).astype('uint8'))
    keep=sorted([i for i in range(1,len(stats)) if stats[i,4]>800],key=lambda i:stats[i,0])
    assert len(keep)==expected,(path,[(i,stats[i,4]) for i in keep])
    result=[]
    for i in keep:
        x,y,w,h=map(int,stats[i,:4])
        rgba=np.dstack((img,255*(labels==i).astype('uint8')))[y:y+h,x:x+w]
        result.append(Image.fromarray(rgba))
    return result
for part,spec in parts.items():
    images=components(HERE/'originals'/f'{part}.png',4)
    if part=='fin':
        images[0]=components(HERE/'originals/fin-top.png',1)[0]
    w,d,h=spec['dim'];scale=min(4,780/max(w,d,h))
    dims=[max(4,round(k*scale)) for k in (w,d,h)]
    w,d,h=dims
    tiles=[img.resize(shape,Image.Resampling.LANCZOS) for img,shape in zip(images,[(w,d),(d,h),(w,h),(w,h)])]
    if part=='wing':
        # Align the low skin and the top of the upturned tip separately. Its thickness is
        # anchored to the FRONT whole-aircraft elevation, not inferred from the tip height.
        for i in (1,2,3):
            source=np.array(tiles[i])
            z=1-(np.arange(h)+.5)/h
            src_z=np.interp(z,[0,.45,1],[0,.19,1])
            yi=np.clip(((1-src_z)*h).astype(int),0,h-1)
            tiles[i]=Image.fromarray(source[yi])
    gutter=14;margin=10
    canvas=Image.new('RGBA',(2*margin+sum(t.width for t in tiles)+3*gutter,max(t.height for t in tiles)+2*margin))
    column=margin;boxes={}
    for name,t in zip(('top','left','front','rear'),tiles):
        row=(canvas.height-t.height)//2
        canvas.paste(t,(column,row));boxes[name]=[column,row,t.width,t.height]
        column+=t.width+gutter
    canvas.save(HERE/'atlases'/f'{part}.png',optimize=True)
    spec['views']=boxes
    spec['rectified_pixels']=dims
(HERE/'calibration.json').write_text(json.dumps(parts,indent=2)+'\n')
