"""Measure the native frames and independently project each re-opened GLB into its four inputs."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from common import read_stack,save_json
from measure import silhouettes,load_mesh

def iou(a,b):
    union=np.count_nonzero(a|b)
    return float(np.count_nonzero(a&b)/union) if union else None

frames=Path(sys.argv[1])
original=Image.open(HERE.parent/'inputs/reference-mask.png').convert('L')
def load(key):
    return np.asarray(Image.open(frames/(key+'.png')).convert('RGBA'))
def lighting_pair(a,b):
    ma=a[...,3]>=128;mb=b[...,3]>=128
    common=nd.binary_erosion((a[...,3]>=254)&(b[...,3]>=254),iterations=2)
    rgb=float(np.abs(a[common,:3].astype(float)-b[common,:3]).mean()) if common.any() else None
    return dict(rgb_mae=rgb,mask_iou=iou(ma,mb),common_pixels=int(common.sum()))
results={'guides':{},'axes':{}}
methods=('cpu','webgl','eevee','cycles')
meta,_=read_stack()
size=np.array(meta['size'])
for guide in ('off','on'):
    mesh=load_mesh(HERE/'models'/f'guide-{guide}.glb')
    orthos=silhouettes(mesh,size,-size*np.array([.5,.5,0]))
    data={'source_views_iou':orthos,'mean_source_iou':float(np.mean(list(orthos.values()))),'engines':{}}
    for engine in (*methods,'clay'):
        on=load(f'{guide}-{engine}-on')
        ref=np.array(original.resize(on.shape[1::-1],Image.Resampling.BOX))>=128
        a=on[...,3]>=128
        stats=dict(native_resolution=list(a.shape[::-1]),photo_iou=iou(a,ref))
        if engine!='clay':
            off=load(f'{guide}-{engine}-off')
            stats['unlit_photo_iou']=iou(off[...,3]>=128,ref)
            stats['lighting_change']=lighting_pair(off,on)
        data['engines'][engine]=stats
    results['guides'][guide]=data
for axis in ('z72','xy72','xyz72'):
    for view in ('photo','top'):
        for engine in ('cpu','webgl'):
            a,b=[load(f'{axis}-{view}-{engine}-{lit}') for lit in ('off','on')]
            results['axes'][f'{axis}-{view}-{engine}']={**lighting_pair(a,b),
                'unlit_pixels':int((a[...,3]>=128).sum()),'lit_pixels':int((b[...,3]>=128).sum())}
for engine in ('cpu','webgl'):
    xy=results['axes']['xy72-top-'+engine]
    assert xy['unlit_pixels']==xy['lit_pixels']==0
for g,data in results['guides'].items():
    print(g,round(data['mean_source_iou']*100,2),[(k,round(q['photo_iou']*100,2),round(q['lighting_change']['rgb_mae'],2) if k!='clay' else None) for k,q in data['engines'].items()])
save_json(HERE/'results.json',results)
