"""Compare the exported, placed meshes against the same fitted whole-chick masks."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parent
inputs=Path(sys.argv[-1])
size=json.loads((root.parent/'stack/stack.json').read_text())['size']
def project(verts,view):
    vx,vy,vz=verts.T
    x=.5+vx/size[0];y=.5+vy/size[1]
    return dict(front=(x,1-vz),rear=(1-x,1-vz),left=(1-y,1-vz),top=(x,y))[view]
def split_rows(mask):
    return sum(np.count_nonzero(np.diff(np.r_[False,row,False].astype(int))==1)>=2 for row in mask)
def iou(a,b):
    return np.count_nonzero(a&b)/np.count_nonzero(a|b)
results={}
for mode in ['single','parts']:
    data=[np.load(p) for p in sorted(inputs.glob(mode+'-*.npz'))]
    result={}
    for name in ['front','left','rear','top']:
        ref=Image.open(root.parent/'section-study/views'/f'{name}.png').convert('RGBA').getchannel('A')
        w,h=ref.size
        im=Image.new('L',(2*w,2*h))
        draw=ImageDraw.Draw(im)
        for asset in data:
            u,v=project(asset['v'],name)
            uv=np.rint(np.column_stack((u*w*2-.5,v*h*2-.5))).astype(int)
            for tri in uv[asset['f']]:
                draw.polygon(tri.ravel().tolist(),fill=255)
        pred=np.asarray(im.resize((w,h),Image.Resampling.BOX))>=128
        src=np.asarray(ref)>=128
        result[name]=dict(iou=iou(pred,src))
        if name=='front':
            result[name].update(crest_split_rows=int(split_rows(pred[:int(.145*h)])),source_crest_split_rows=int(split_rows(src[:int(.145*h)])),
                foot_region_iou=iou(pred[round(.84*h):],src[round(.84*h):]))
        merged=np.full((h,w,3),246,dtype=np.uint8)
        merged[src&pred]=[95,104,100];merged[src&~pred]=[232,135,65];merged[~src&pred]=[37,146,173]
        Image.fromarray(merged).save(inputs/(mode+'-mask-'+name+'.png'))
    results[mode]=result
(root/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
