"""Reopen the deliverable, evaluate its mounts at three poses, and capture fixed registered views."""
import bpy,sys,json
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
here=Path(__file__).resolve().parent;root=here.parent
out=Path(sys.argv[sys.argv.index('--')+1]);key=sys.argv[-1]
s=bpy.context.scene;cam=s.camera;parts={o.name:o for o in s.objects if o.type=='MESH'}
spec=json.loads((root/'part-atlases/mounts.json').read_text())
assert set(spec)==set(parts) and all(i.packed_file for i in bpy.data.images if i.source=='FILE' and i.has_data)
s.frame_set(0);initial={k:o.matrix_world.copy() for k,o in parts.items()}
s.frame_set(48);bpy.context.view_layer.update()
assert all(((o.matrix_world.translation-initial[k].translation)-Vector(spec[k]['explosion'])).length<1e-4 for k,o in parts.items())
s.frame_set(96);bpy.context.view_layer.update()
assert max((o.matrix_world.translation-initial[k].translation).length for k,o in parts.items())<1e-5
s.frame_set(0);bpy.context.view_layer.update()
trees={};count=0
for k,o in parts.items():
    me=o.data;me.calc_loop_triangles()
    count+=len(me.loop_triangles)
    trees[k]=BVHTree.FromPolygons([o.matrix_world@v.co for v in me.vertices],[tuple(f.vertices) for f in me.loop_triangles],all_triangles=True)
edges=[(a,b) for a in trees for b in trees if a<b and trees[a].overlap(trees[b])]
connected={'Fuselage'}
for _ in parts:
    for a,b in edges:
        if a in connected or b in connected:connected.update([a,b])
assert connected==set(parts),set(parts)-connected
u=6/583;x=(94-228.5)*u;y=(105-291.5)*u
hi=trees['Wing_L'].ray_cast((x,y,4),(0,0,-1))[0];lo=trees['Wing_L'].ray_cast((x,y,-2),(0,0,1))[0]
(out/(key+'.json')).write_text(json.dumps(dict(triangles=count,wing_thickness=hi.z-lo.z,connected=sorted(connected))))
for a in (cam,cam.data):
    if a.animation_data:a.animation_data_clear()
cal=json.loads((root/'inputs/camera.json').read_text())
def shoot(view,back,up,right,span,w,h,center,engine):
    cam.location=center+14*back;cam.rotation_euler=Matrix([right,up,back]).transposed().to_euler()
    cam.data.ortho_scale=span;s.render.resolution_x=w;s.render.resolution_y=h
    s.render.engine=engine;s.render.filepath=str(out/(key+'-'+view+'.png'))
    bpy.ops.render.render(write_still=True)
w,h=cal['resolution'];right,up,back=map(Vector,cal['basis']);_,_,_,scale,cx,cy=cal['parameters']
center=right*((w/2-cx)/scale)+up*((cy-h/2)/scale)
shoot('hero',back,up,right,w/scale,w,h,center,'CYCLES')
for label,b,v,w,h in [('top',(0,0,1),(0,-1,0),457,583),('front',(0,1,0),(0,0,1),457,175),('rear',(0,-1,0),(0,0,1),457,175),('left',(-1,0,0),(0,0,1),583,175)]:
    back,up=Vector(b),Vector(v);shoot(label,back,up,up.cross(back),max(w,h)*u,w,h,Vector((0,0,175*u/2)),'BLENDER_EEVEE')
