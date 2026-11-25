"""Capture only the final GLB. Use its actual translation clip for the exploded view."""
from pathlib import Path
import sys,json,math
import bpy
from mathutils import Matrix,Vector
from bpy_extras.object_utils import world_to_camera_view
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
from render import camera,cam,s,frame,out,cal
spec=json.loads((here/'mounts.json').read_text())
assert bpy.ops.import_scene.gltf(filepath=str(here/'aircraft.glb'),merge_vertices=True)=={'FINISHED'}
pieces={o.name:o for o in bpy.context.scene.objects if o.type=='MESH'}
assert set(pieces)==set(spec),list(pieces)
s.render.fps=24
s.frame_set(0);bpy.context.view_layer.update()
rest={k:o.matrix_world.translation.copy() for k,o in pieces.items()}
camera();frame('assembled','CYCLES')
# Match reference silhouettes in the original four calibrated canvases.
size=Vector((457*6/583,6,175*6/583));center=Vector((0,0,size.z/2))
for key,(back,up,w,h,span) in {'top':((0,0,1),(0,-1,0),457,583,6),
    'left':((-1,0,0),(0,0,1),583,175,6),'front':((0,1,0),(0,0,1),457,175,size.x),
    'rear':((0,-1,0),(0,0,1),457,175,size.x)}.items():
    # Right vector matches the image-to-grid convention, including atlas x reflection.
    # The symmetric aircraft allows one horizontal display flip when comparing TOP/FRONT/REAR.
    b=Vector(back);v=Vector(up);u=v.cross(b)
    cam.rotation_euler=Matrix([u,v,b]).transposed().to_euler()
    cam.location=center+b*14
    cam.data.ortho_scale=span
    s.render.resolution_x=w;s.render.resolution_y=h
    frame('ortho-'+key,'BLENDER_EEVEE')
s.frame_set(48);bpy.context.view_layer.update()
for k,o in pieces.items():
    assert ((o.matrix_world.translation-rest[k])-Vector(spec[k]['explosion'])).length<1e-4,k
u,v,b=map(Vector,cal['basis'])
points=[o.matrix_world@p.co for o in pieces.values() for p in o.data.vertices]
x=[p.dot(u) for p in points];y=[p.dot(v) for p in points]
w,h=1800,1120
target=u*((max(x)+min(x))/2)+v*((max(y)+min(y))/2)
cam.location=target+b*14;cam.rotation_euler=Matrix([u,v,b]).transposed().to_euler()
cam.data.ortho_scale=1.08*max(max(x)-min(x),(max(y)-min(y))*w/h)
s.render.resolution_x=w;s.render.resolution_y=h;bpy.context.view_layer.update()
frame('exploded','CYCLES')
palette={'fuselage':(.44,.51,.56,1),'canopy':(.85,.38,.11,1),'nacelle':(.18,.46,.54,1),
         'canard':(.77,.55,.27,1),'fin':(.42,.42,.71,1),'wing':(.25,.63,.55,1)}
for k,o in pieces.items():o.color=palette[spec[k]['source']]
s.display.shading.color_type='OBJECT'
frame('parts-color','BLENDER_WORKBENCH')
anchors={}
for name,o in pieces.items():
    pts=[world_to_camera_view(s,cam,o.matrix_world@v.co) for v in o.data.vertices]
    anchors[name]=[sum(p.x for p in pts)/len(pts),1-sum(p.y for p in pts)/len(pts)]
(out/'anchors.json').write_text(json.dumps(anchors,indent=2))
s.frame_set(96);bpy.context.view_layer.update()
assert max((o.matrix_world.translation-rest[k]).length for k,o in pieces.items())<1e-5
