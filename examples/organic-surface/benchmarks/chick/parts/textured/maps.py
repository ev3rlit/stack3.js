"""Build padded six-chart albedo maps from the registered per-part source PNGs."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
from scipy.ndimage import distance_transform_edt, gaussian_filter

root=Path(__file__).resolve().parents[1];out=root/'textured'
s=256;pad=5
for part in ['body','wing','crest','beak','leg']:
    tiles=[]
    for direction in ['front','rear','left','right','top','bottom']:
        source={'right':'left','bottom':'top'}.get(direction,direction)
        img=Image.open(root/part/(source+'.png')).convert('RGBA')
        if direction=='right':img=ImageOps.mirror(img)
        arr=np.asarray(img)
        empty=arr[...,3]<128
        indices=distance_transform_edt(empty,return_distances=False,return_indices=True)
        filled=Image.fromarray(arr[...,:3][tuple(indices)]).resize((s,s),Image.Resampling.LANCZOS)
        rgb=np.array(filled,dtype=float)
        # Keep the reference pigment variation while allowing studio lights
        # to provide the main shading. The lip cleft retains its darker color.
        mid=np.median(rgb.reshape(-1,3),axis=0)
        palette={'body':[248,204,68], 'wing':[247,199,58], 'crest':[248,195,55],
                 'beak':[247,150,37], 'leg':[239,151,45]}[part]
        strength=.38 if part in ('beak','leg') else .32
        if direction=='bottom':strength=.12
        tex=np.clip(np.array(palette)+strength*(rgb-mid),0,255)
        tiles.append(np.pad(np.uint8(tex),((pad,pad),(pad,pad),(0,0)),mode='edge'))
    atlas=np.vstack([np.hstack(tiles[:3]),np.hstack(tiles[3:])])
    Image.fromarray(atlas).save(out/(part+'-basecolor.png'))
