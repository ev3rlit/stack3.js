"""Independent first-hit, topology, wing geometry and projection checks on the reimported GLBs."""
from pathlib import Path
from collections import Counter
import sys
import numpy as np
from PIL import Image

here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
# The parent module has the same basename, and is resolved first on sys.path.
from measure import load_mesh,silhouettes,iou
from common import read_stack,save_json

work=Path(sys.argv[1]);meta,_=read_stack('section-stack');size=np.array(meta['size'])
unit=size[1]/583
offset=-size*np.array([.5,.5,0])
ref=np.asarray(Image.open(here.parent/'inputs/reference-mask.png'))>=128
models={k:load_mesh(p) for k,p in [('before',here.parent/'guide-comparison/models/guide-on.glb'),('after',here/'aircraft.glb')]}
def point(x,y,z):
    return np.array([x,y,z])*unit+offset
def first(mesh,origin,direction):
    hits,_,_=mesh.ray.intersects_location([origin],[direction])
    assert len(hits)
    return float(np.min((hits-origin)@direction))
def wing_triangles(mesh):
    triangles=mesh.triangles
    x,y,z=((triangles.mean(1)-offset)/unit).T
    dx=np.abs(x-225.9)
    # The wing guide band from sections.py, plus a 3-pixel margin for isosurface smoothing.
    mid=56-7*np.clip((dx-40)/174,0,1)
    half=2.1+6*(1-np.clip((dx-37)/188,0,1))
    chosen=(y>54)&(y<275)&(dx>26)&(np.abs(z-mid)<=half+3)
    return Counter(tuple(sorted(map(tuple,t))) for t in np.round(triangles[chosen],6))
data={}
for k,m in models.items():
    assert m.is_watertight and m.is_winding_consistent and len(m.split(only_watertight=False))==1
    probe={}
    for x in (194,258):
        probe['intake_'+str(x)]=first(m,point(x,142,180),np.array([0,0,-1]))
    for x in (199,256):
        probe['outlet_'+str(x)]=first(m,point(x,-50,61.5),np.array([0,1,0]))
    silhouette=np.asarray(Image.open(work/(k+'-hero.png')))[...,3]>=128
    data[k]=dict(triangles=len(m.faces),first_hit_distance=probe,photo_iou=iou(silhouette,ref),
        ortho_iou=silhouettes(m,size,offset),watertight=True,components=1)
w0=wing_triangles(models['before']);w1=wing_triangles(models['after'])
assert w0==w1 and len(w0)>0
thickness_deltas=[]
for sign in (-1,1):
    for dx in (72,98,124,150,176,195):
        for y in (80,91,104,118,135):
            x=225.9+sign*dx
            if not np.asarray(Image.open(here.parent/'inputs/top.png'))[y,round(x),3]>=128:continue
            values=[]
            for m in models.values():
                hits,_,_=m.ray.intersects_location([point(x,y,200)],[[0,0,-1]])
                assert len(hits)>=2
                values.append(np.ptp(hits[:,2]))
            thickness_deltas.append(abs(values[0]-values[1]))
assert max(thickness_deltas)<1e-6
changes={key:data['after']['first_hit_distance'][key]-value for key,value in data['before']['first_hit_distance'].items()}
assert min(changes.values())>0
save_json(here/'measurements.json',dict(models=data,added_depth_scene_units=changes,matching_wing_triangles=sum(w0.values()),
    wing_probes=len(thickness_deltas),max_wing_thickness_delta=float(max(thickness_deltas))))
print('Wing',sum(w0.values()),len(thickness_deltas),max(thickness_deltas))
print('Mesh',[(k,v['triangles'],v['photo_iou']) for k,v in data.items()],'Depth',changes)
