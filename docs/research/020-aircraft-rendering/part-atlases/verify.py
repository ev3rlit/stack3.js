"""Re-open the actual assembly, validate each GLB node and measure the registered renders."""
from pathlib import Path
import json,sys
from itertools import combinations
import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation
import trimesh

root=Path(__file__).resolve().parent;work=Path(sys.argv[1])
m=json.loads((root/'mounts.json').read_text())
raw=(root/'aircraft.glb').read_bytes();length=int.from_bytes(raw[12:16],'little')
doc=json.loads(raw[20:20+length]);buffer=memoryview(raw)[28+length:]
def acc(id):
    a=doc['accessors'][id];v=doc['bufferViews'][a['bufferView']]
    typ=np.dtype({5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
    return np.ndarray((a['count'],n),dtype=typ,buffer=buffer,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',n*typ.itemsize),typ.itemsize))
parts={};local_meshes={}
for node in doc['nodes']:
    if 'mesh' not in node:continue
    name=node['name']
    p,=doc['meshes'][node['mesh']]['primitives'];v=acc(p['attributes']['POSITION'])
    f=acc(p['indices']).reshape(-1,3);r=Rotation.from_quat(node['rotation'])
    world=r.apply(v*node['scale'])+node['translation']
    xyz=np.column_stack((world[:,0],-world[:,2],world[:,1]))
    faces=f[:,::-1] if node['scale'][0]<0 else f
    mesh=trimesh.Trimesh(xyz,faces,process=True)
    assert mesh.is_watertight and mesh.is_winding_consistent and len(mesh.split(only_watertight=False))==1,name
    parts[name]=mesh
    local_meshes[m[name]['source']]=len(f)
assert len(parts)==10 and len(local_meshes)==6
edges=[]
for a,b in combinations(parts,2):
    A,B=parts[a],parts[b]
    if not np.all((A.bounds[1]>B.bounds[0])&(B.bounds[1]>A.bounds[0])):continue
    if A.contains(B.vertices[::2]).any() or B.contains(A.vertices[::2]).any():edges.append([a,b])
connected={'Fuselage'}
for _ in parts:
    for a,b in edges:
        if a in connected or b in connected:connected.update([a,b])
print('Attachments',edges,'missing',set(parts)-connected,flush=True)
assert connected==set(parts),'Unseated parts: '+str(set(parts)-connected)

animation,=doc['animations']
assert animation['name']=='Explode' and len(animation['channels'])==9
for ch in animation['channels']:
    n=doc['nodes'][ch['target']['node']];sampler=animation['samplers'][ch['sampler']]
    positions=acc(sampler['output'])
    assert np.allclose(acc(sampler['input']).ravel(),[0,1.5,2.5,4])
    assert np.allclose(positions[[0,-1]],n['translation'])
    shift=m[n['name']]['explosion'];assert np.allclose(positions[1]-positions[0],[shift[0],shift[2],-shift[1]],atol=1e-6)
def mask_iou(a,b):return float((a&b).sum()/(a|b).sum())
orthos={}
for name in ('top','left','front','rear'):
    a=np.asarray(Image.open(work/f'ortho-{name}.png'))[...,3]>=128
    if name!='left':a=a[:,::-1]
    target=np.asarray(Image.open(root.parent/'inputs'/f'{name}.png'))[...,3]>=128
    orthos[name]=mask_iou(a,target)
photo=np.asarray(Image.open(root.parent/'inputs/reference-mask.png'))>=128
render=np.asarray(Image.open(work/'assembled.png'))[...,3]>=128
unit=6/583
xx=(94-228.5)*unit;yy=(105-291.5)*unit
hits,_,_=parts['Wing_L'].ray.intersects_location([[xx,yy,3]],[[0,0,-1]])
assert len(hits)>=2
thickness=float(np.ptp(hits[:,2]))
stats=dict(source_atlases=6,mesh_nodes=10,triangles_per_asset=local_meshes,
    assembled_triangles=sum(len(i.faces) for i in parts.values()),all_closed=True,
    all_parts_attached=True,overlap_pairs=edges,animation_seconds=4,wing_probe_scene_units=thickness,
    four_view_iou=orthos,mean_four_view_iou=float(np.mean(list(orthos.values()))),photo_iou=mask_iou(photo,render))
(root/'measurements.json').write_text(json.dumps(stats,indent=2)+'\n')
print(stats)
