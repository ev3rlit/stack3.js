"""Score the saved frames, using their actual alpha channel and one reopened voxel GLB."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

here=Path(__file__).resolve().parent
frames=Path(sys.argv[1])
setup=json.loads((here/'experiment.json').read_text())
orbit=[f'{a}_{e}' for e in (15,55) for a in range(0,360,45)]
views=['photo','front','side','top',*orbit]
def load_frame(name,stage,view):
    return np.array(Image.open(frames/f'{name}-{stage}-{view}.png').convert('RGBA'))
ref={v:load_frame('voxel','voxel',v) for v in views}
original=np.asarray(Image.open(here.parent/'inputs/reference-mask.png'))>=128
def iou(a,b):
    return float(np.count_nonzero(a&b)/np.count_nonzero(a|b))
def metrics(name,stage):
    details={}
    for v,r in ref.items():
        b=load_frame(name,stage,v)
        a=r[...,3]>=128;mask=b[...,3]>=128
        common=a|mask
        assert common.any()
        def on_background(image):
            pix=image[common].astype('float32')
            return (pix[:,:3]-32)*(pix[:,3:]/255)+32
        details[v]=dict(iou=iou(a,mask),pixels=int(mask.sum()),
            rgb_mae=float(np.abs(on_background(r)-on_background(b)).mean()))
        if v=='photo':
            details[v]['photo_iou']=iou(mask,original)
    return dict(orbit_mean_iou=float(np.mean([details[v]['iou'] for v in orbit])),
        orbit_mean_rgb_mae=float(np.mean([details[v]['rgb_mae'] for v in orbit])),
        orbit_min_iou=min(details[v]['iou'] for v in orbit), views=details)
results={'voxel':{'voxel':metrics('voxel','voxel')}}
for name in {**setup['cases'],**setup['matched_texels']}:
    stages=['stack','mesh'] if name in setup['cases'] else ['stack']
    results[name]={mode:metrics(name,mode) for mode in stages}
    r=results[name]['stack']
    print(name,round(r['orbit_mean_iou']*100,2),round(r['orbit_mean_rgb_mae'],2),
          round(r['views']['photo']['photo_iou']*100,2),[round(r['views'][v]['iou']*100,2) for v in ('top','front','side')])
for case,view in [('z72','front'),('z72','side'),('xy144','top'),('x72','top'),('y72','top')]:
    assert results[case]['stack']['views'][view]['pixels']==0
for view in views:
    assert np.array_equal(load_frame('z72','mesh',view),load_frame('xyz216','mesh',view))
(here/'view-results.json').write_text(json.dumps(results,indent=2)+'\n')
