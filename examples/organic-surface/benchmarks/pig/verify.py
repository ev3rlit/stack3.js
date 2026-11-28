"""Verify the rendered fold against evaluated skinned GLB geometry."""
import bpy, json, struct, sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
path=Path(args[0]).resolve() if args else root/'piglet-rig.glb'
def gltf(path):
    raw=path.read_bytes()
    return json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
doc=gltf(path)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=24
bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)
rig=next(o for o in scene.objects if o.type=='ARMATURE')
objects={o.name:o for o in scene.objects if o.name in [n.get('name') for n in doc['nodes'] if 'mesh' in n]}
ears=[objects['Ear.L'],objects['Ear.R']]
action=rig.animation_data.action
start,end=[round(n) for n in action.frame_range]
deps=bpy.context.evaluated_depsgraph_get()
def data(ob):
    geom=ob.evaluated_get(deps);coords=[geom.matrix_world@v.co for v in geom.data.vertices]
    return np.array(coords),[p.vertices[:] for p in geom.data.polygons]
def evaluate_tree(ob):
    v,f=data(ob)
    return BVHTree.FromPolygons(v,f)
head=evaluate_tree(objects['Head']);torso=evaluate_tree(objects['Torso'])
ear_checks={}
for ear in ears:
    ear_checks[ear.name]={'self_collision_frames':[],'detached_frames':[],'tip_inside_head_frames':[],'max_weight_error':max(abs(sum(g.weight for g in v.groups)-1) for v in ear.data.vertices)}
scene.frame_set(start+36)
open_verts={o.name:data(o)[0] for o in ears}
for ear in ears:
    heights=open_verts[ear.name][:,2]
    ear_checks[ear.name]['tip_vertex']=int(heights.argmax())
for n in range(start,end+1):
    scene.frame_set(n)
    for o in ears:
        v,f=data(o);et=BVHTree.FromPolygons(v,f);results=ear_checks[o.name]
        coll=et.overlap(et)
        if any(a<b and set(f[a]).isdisjoint(f[b]) for a,b in coll):results['self_collision_frames'].append(n)
        if not et.overlap(head):results['detached_frames'].append(n)
        tip=Vector(v[results['tip_vertex']]);near,normal,_,dist=head.find_nearest(tip)
        signed_dist=dist if (tip-near).dot(normal)>=0 else -dist
        if signed_dist<0:results['tip_inside_head_frames'].append(n)
        if n==end:
            results['folded_tip_clearance_to_head']=signed_dist
            results['tip_drop']=float(open_verts[o.name][results['tip_vertex'],2]-tip.z)
            results['loop_closure_error']=float(np.max(np.linalg.norm(v-first[o.name],axis=1)))
    if n==start:first={o.name:data(o)[0] for o in ears}
result={'mesh_count':len(objects),'animation':action.name,'duration_seconds':(end-start)/24,'ears':ear_checks,
        'mounts':{},'triangles':sum(len(data(o)[1]) for o in objects.values())}
for name,ob in objects.items():
    if name in ('Head','Torso') or ob in ears:continue
    target=head if name=='Snout' or name.startswith('Eye.') else torso
    result['mounts'][name]=len(evaluate_tree(ob).overlap(target))
result['mounts']['Head-Torso']=len(head.overlap(torso))
(root/('game-checks.json' if args else 'shape-checks.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

assert all(result["mounts"].values()) and len(objects)==8
for check in ear_checks.values():
    assert not any(check[k] for k in ("self_collision_frames","detached_frames","tip_inside_head_frames"))
    assert check["tip_drop"] > .2 and check["loop_closure_error"]<1e-5 and check["max_weight_error"]<1e-4
