"""Read the delivered file in a clean Blender process and render its actual animated poses."""
import bpy,sys,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
out=Path(sys.argv[sys.argv.index('--')+1])
s=bpy.context.scene;here=Path(bpy.data.filepath).resolve().parent
spec=json.loads((here/'mounts.json').read_text())
parts={o.name:o for o in s.objects if o.type=='MESH'}
assert set(parts)==set(spec)
for k in ('fuselage','canopy','nacelle','wing','fin','canard'):
    for prefix in ('ATLAS','STACK'):
        im=bpy.data.images[prefix+' · '+k]
        assert im.packed_file and im.size[0]>0
assert s.frame_current==0 and s.frame_start==0 and s.frame_end==96
assert all(i.packed_file for i in bpy.data.images if i.source=='FILE' and i.has_data)
rest={k:o.matrix_world.copy() for k,o in parts.items()}
def frame(f,name):
    s.frame_set(f);bpy.context.view_layer.update()
    xyz=[world_to_camera_view(s,s.camera,o.matrix_world@v.co) for o in parts.values() for v in o.data.vertices]
    assert min(min(p.x,p.y,1-p.x,1-p.y) for p in xyz)>.01
    s.render.filepath=str(out/name);bpy.ops.render.render(write_still=True)
frame(0,'blend-assembled.png')
frame(48,'blend-exploded.png')
for k,o in parts.items():
    assert ((o.matrix_world.translation-rest[k].translation)-Vector(spec[k]['explosion'])).length<1e-4,k
s.frame_set(96);bpy.context.view_layer.update()
assert max(max(abs(a-b) for row1,row2 in zip(o.matrix_world,rest[k]) for a,b in zip(row1,row2)) for k,o in parts.items())<1e-5
print('VERIFIED',len(parts),'part transforms, 12 packed sources, F0/F48/F96; frame bounds OK')
