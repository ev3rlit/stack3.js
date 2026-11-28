"""Check the exported animation by reimporting and evaluating the skinned GLB."""
import bpy, json, struct
from pathlib import Path
import numpy as np
from mathutils.bvhtree import BVHTree

out=Path(__file__).resolve().parent
path=out/'chick-showcase.glb'
raw=path.read_bytes()
gltf=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
clips=gltf.get('animations',[])
assert len(clips)==1 and clips[0]['name']=='Chick_Showcase'
duration=max(gltf['accessors'][s['input']]['max'][0] for s in clips[0]['samplers'])
assert abs(duration-6.5)<1e-5
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.fps=24
bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)
rig=next(o for o in scene.objects if o.type=='ARMATURE')
objects={m['name']:scene.objects[m['name']] for m in gltf['meshes']}
assert len(objects)==9
print("Imported animation:",rig.animation_data.action,rig.animation_data.action.frame_range[:],list(objects))
# Blender imports glTF keys starting at frame zero.
start=round(rig.animation_data.action.frame_range[0])
deps=bpy.context.evaluated_depsgraph_get()
faces={name:[f.vertices[:] for f in o.data.polygons] for name,o in objects.items()}
history={k:[] for k in objects};miss={k:[] for k in objects if k!='Body'}
for n in range(157):
    scene.frame_set(n+start)
    trees={}
    for name,o in objects.items():
        evaluated=o.evaluated_get(deps)
        coords=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        trees[name]=BVHTree.FromPolygons(coords,faces[name])
        history[name].append(np.array(coords))
    for name,frames in miss.items():
        if not trees['Body'].overlap(trees[name]):frames.append(n)
history={k:np.stack(v) for k,v in history.items()}
floor={k:float(a[:,:,2].min()) for k,a in history.items()}
closure=max(float(np.max(np.linalg.norm(a[-1]-a[0],axis=1))) for a in history.values())
plant={}
for side in ['L','R']:
    v=history['Leg.'+side]
    sole=v[0,:,2]<.02
    # Frames on which this foot is planted on the stage between contacts.
    holds=[(0,16),(29,42),(56,117),(135,156)] if side=='L' else [(0,29),(42,117),(135,156)]
    drift=max(float(np.linalg.norm(v[a:b+1,sole]-v[a,sole],axis=-1).max()) for a,b in holds)
    plant[side]=drift
beak=history['Beak']
contact=[float(beak[f,:,2].min()) for f in [79,99]]
hop=min(float(history['Leg.'+side][126,:,2].min()) for side in ('L','R'))
q=dict(duration_s=duration,frames=156,fps=24,meshes=len(objects),bones=len(rig.data.bones),
       textures=len(gltf['images']),triangles=sum(len(t) for t in faces.values()),
       loop_max_vertex_error=closure,stance_sole_max_drift=plant,beak_contact_z=contact,hop_foot_clearance=hop,
       lowest_vertex_z=floor,body_contact_miss_frames=miss)
print(json.dumps(q,indent=2),flush=True)
(out/'motion-checks.json').write_text(json.dumps(q,indent=2)+'\n')
assert closure<.0001 and max(plant.values())<.0002
assert max(abs(c) for c in contact)<.002 and min(floor.values())>-.001
assert hop>.15 and not any(miss.values())
