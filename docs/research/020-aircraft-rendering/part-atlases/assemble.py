"""Mount six separately reconstructed GLBs; attach nine translation tracks for inspection."""
import json,math,struct,sys
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation
import trimesh
here=Path(__file__).resolve().parent
specs=json.loads((here/'calibration.json').read_text());unit=6/583
cal=json.loads((here.parent/'inputs/camera.json').read_text())
u,v,back=np.array(cal['basis'])
views={name:trimesh.load_scene(here/'models'/f'{name}.glb').to_geometry() for name in specs}
# Coordinate system of the input four-view drawing, converted to glTF only on write.
def y_up(p):return np.asarray(p)[[0,2,1]]*[1,1,-1]
def world_pos(key,side):
    q=specs[key];w,d,h=q['dim']
    return np.array([225.9+side*q['center_x']-228.5,q['y0']+d/2-291.5,q['z0']])*unit
def canopy_seat():
    # Sample the newly reconstructed fuselage, never a prior aircraft model.
    body=views['fuselage'];origin=world_pos('fuselage',1)
    cap=world_pos('canopy',1)
    rows=[];heights=[]
    for f in (.14,.29,.50,.71,.86):
        local_y=(f-.5)*specs['canopy']['dim'][1]*unit
        for lateral in (-.115,.115):
            ray=[cap[0]+lateral-origin[0],2.2,-(cap[1]+local_y-origin[1])]
            p,_,_=body.ray.intersects_location([ray],[[0,-1,0]])
            if len(p):
                rows.append(local_y);heights.append(float(p[:,1].max()+origin[2]))
    assert len(heights)>=8
    slope,z=np.polyfit(rows,heights,1)
    return math.atan(slope),float(z-.024)
angle,seat=canopy_seat()
doc=dict(asset={'version':'2.0','generator':'stack3 per-part atlases'},scene=0,scenes=[{'nodes':[0]}],
    nodes=[{'name':'Aircraft','children':[]}],meshes=[],materials=[],textures=[],images=[],bufferViews=[],accessors=[])
bin=bytearray()
def pad():bin.extend(bytes((-len(bin))%4))
def embed_geometry(key):
    b=(here/'models'/f'{key}.glb').read_bytes();l=int.from_bytes(b[12:16],'little');g=json.loads(b[20:20+l])
    pad();byte=len(bin);bv=len(doc['bufferViews']);ac=len(doc['accessors']);mat=len(doc['materials'])
    assert len(g['meshes'])==len(g['materials'])==len(g['textures'])==len(g['images'])==1 and 'samplers' not in g
    bin.extend(b[28+l:28+l+g['buffers'][0]['byteLength']])
    for view in g['bufferViews']:view['byteOffset']=byte+view.get('byteOffset',0)
    for a in g['accessors']:a['bufferView']+=bv
    g['images'][0]['bufferView']+=bv;g['textures'][0]['source']=len(doc['images'])
    g['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']=len(doc['textures'])
    mesh=g['meshes'][0];mesh['name']=key
    for p in mesh['primitives']:
        p['material']+=mat;p['indices']+=ac
        p['attributes']={k:i+ac for k,i in p['attributes'].items()}
    idx=len(doc['meshes'])
    for array in ('meshes','materials','textures','images','bufferViews','accessors'):doc[array].extend(g[array])
    return idx
def add_accessor(values,kind):
    data=np.array(values,'<f4')
    pad();byte=len(bin);bin.extend(data.tobytes())
    doc['bufferViews'].append(dict(buffer=0,byteOffset=byte,byteLength=data.nbytes))
    doc['accessors'].append(dict(bufferView=len(doc['bufferViews'])-1,componentType=5126,count=len(data),type=kind,
        min=data.min(0).reshape(-1).tolist(),max=data.max(0).reshape(-1).tolist()))
    return len(doc['accessors'])-1

# Centers in the presentation camera's image plane for an unobstructed exploded pose.
targets={'Canopy':(-2.4,2.2),'Wing_R':(-3.55,.35),'Wing_L':(3.1,-1.65),
    'Fin_R':(-1.04,3.15),'Fin_L':(2.3,2.92),'Nacelle_R':(.00,1.96),'Nacelle_L':(2.75,.84),
    'Canard_R':(-2.92,-1.12),'Canard_L':(.12,-1.46)}
mounts={}
time=add_accessor([0,1.5,2.5,4.0],'SCALAR')
samplers=[];channels=[]
for key,q in specs.items():
    idx=embed_geometry(key)
    for side in ([1] if key in ('fuselage','canopy') else [-1,1]):
        name=key.capitalize()+('' if key in ('fuselage','canopy') else ('_L' if side<0 else '_R'))
        pos=world_pos(key,side);pitch=0.
        if key=='canopy':pos[2]=seat; pitch=angle
        rot=Rotation.from_rotvec([pitch,0,0]);scale=[side,1,1];loc=y_up(pos)
        node=dict(name=name,mesh=idx,translation=loc.tolist(),rotation=rot.as_quat().tolist(),scale=scale,
            extras={'atlas':f'atlases/{key}.png','stack':f'stacks/{key}/stack.json'})
        n=len(doc['nodes']);doc['nodes'].append(node);doc['nodes'][0]['children'].append(n)
        delta=np.zeros(3)
        if name in targets:
            center_gl=rot.apply((views[key].bounds.mean(0))*scale)+loc
            center=np.array([center_gl[0],-center_gl[2],center_gl[1]])
            tx,ty=targets[name]
            delta=(tx-center@u)*u+(ty-center@v)*v
            dest=loc+y_up(delta)
            animation=add_accessor([loc,dest,dest,loc],'VEC3')
            channels.append(dict(sampler=len(samplers),target={'node':n,'path':'translation'}))
            samplers.append(dict(input=time,output=animation,interpolation='LINEAR'))
        mounts[name]=dict(source=key,offset=pos.tolist(),pitch_degrees=math.degrees(pitch),mirror=side<0,
            explosion=delta.tolist(),position_gltf=loc.tolist())
assert len(mounts)==10 and len(channels)==9
doc['animations']=[dict(name='Explode',samplers=samplers,channels=channels)]
doc['buffers']=[{'byteLength':len(bin)}]
js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);pad()
output=struct.pack('<4sII',b'glTF',2,28+len(js)+len(bin))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(bin),b'BIN\x00')+bin
(here/'aircraft.glb').write_bytes(output)
(here/'mounts.json').write_text(json.dumps(mounts,indent=2)+'\n')
print('Canopy pitch and seat',math.degrees(angle),seat)
