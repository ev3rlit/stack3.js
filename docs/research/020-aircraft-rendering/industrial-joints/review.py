"""Inspect actual saved files in clean Blender processes; capture under a shared light rig."""
from pathlib import Path
import bpy,sys,json,math
import numpy as np
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
here=Path(__file__).resolve().parent;out=Path(sys.argv[-2]);key=sys.argv[-1]
s=bpy.context.scene;cam=s.camera;parts={o.name:o for o in s.objects if o.type=='MESH'}
mounts=json.loads((here.parent/'part-atlases/mounts.json').read_text());assert set(parts)==set(mounts)
assert all(im.packed_file for im in bpy.data.images if im.source=='FILE' and im.has_data)
s.frame_set(0);rest={k:o.matrix_world.copy() for k,o in parts.items()}
s.frame_set(48);bpy.context.view_layer.update()
assert all(((o.matrix_world.translation-rest[k].translation)-Vector(mounts[k]['explosion'])).length<1e-4 for k,o in parts.items())
s.frame_set(96);bpy.context.view_layer.update()
assert all((o.matrix_world.translation-rest[k].translation).length<1e-5 for k,o in parts.items())
s.frame_set(0);trees={};tri=0;verts=[]
for k,o in parts.items():
    me=o.data;me.calc_loop_triangles();tri+=len(me.loop_triangles)
    p=[o.matrix_world@v.co for v in me.vertices]
    if k in ('Wing_L','Wing_R'):verts.extend(tuple(v) for v in p)
    trees[k]=BVHTree.FromPolygons(p,[tuple(f.vertices) for f in me.loop_triangles],all_triangles=True)
edges=[(a,b) for a in trees for b in trees if a<b and trees[a].overlap(trees[b])]
connected={'Fuselage'}
for _ in trees:
    for a,b in edges:
        if a in connected or b in connected:connected.update((a,b))
assert connected==set(parts)
u=6/583;x=(94-228.5)*u;y=(105-291.5)*u
th=trees['Wing_L'].ray_cast((x,y,4),(0,0,-1))[0].z-trees['Wing_L'].ray_cast((x,y,-2),(0,0,1))[0].z
np.save(out/(key+'-wings.npy'),verts)
(out/(key+'.json')).write_text(json.dumps(dict(triangles=tri,parts=len(parts),wing_probe=th,connected=len(connected)),indent=2))
for a in (cam,cam.data):
    if a.animation_data:a.animation_data_clear()
cal=json.loads((here.parent/'inputs/camera.json').read_text());right,up,back=map(Vector,cal['basis'])
w,h=cal['resolution'];_,_,_,scale,cx,cy=cal['parameters']
for view,target,span,sx,sy in [('hero',right*((w/2-cx)/scale)+up*((cy-h/2)/scale),w/scale,w,h),
        ('joint',Vector(((-52+225.9-228.5)*u,(147-291.5)*u,.74)),1.85,1050,560)]:
    cam.location=target+14*back;cam.rotation_euler=Matrix([right,up,back]).transposed().to_euler()
    cam.data.ortho_scale=span;s.render.resolution_x=sx;s.render.resolution_y=sy;s.render.engine='CYCLES'
    s.render.filepath=str(out/(key+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
