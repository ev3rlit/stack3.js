"""Build a two-frame comparison in memory from the final Blender file and the prior GLB."""
import bpy,json,sys
from pathlib import Path
from mathutils import Matrix,Vector
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[sys.argv.index('--')+1]);s=bpy.context.scene
s.frame_set(0);bpy.context.view_layer.update()
new=[o for o in s.objects if o.type=='MESH']
assert len(new)==10
cam=s.camera
for obj in [*new,cam,cam.data]:
    if obj.animation_data: obj.animation_data_clear()
bpy.ops.import_scene.gltf(filepath=str(root/'local-guides/aircraft.glb'),merge_vertices=True)
old=list(bpy.context.selected_objects)
old_mesh=[o for o in old if o.type=='MESH'];assert len(old_mesh)==1
old_mesh[0].name='Previous · single atlas'
cal=json.loads((root/'inputs/camera.json').read_text())
def orient(target,u,v,b,span,w,h):
    cam.location=target+14*b
    cam.rotation_euler=Matrix([u,v,b]).transposed().to_euler()
    cam.data.ortho_scale=span;s.render.resolution_x=w;s.render.resolution_y=h
    bpy.context.view_layer.update()
def view(key):
    if key=='photo':
        w,h=cal['resolution'];u,v,b=map(Vector,cal['basis'])
        _,_,_,scale,cx,cy=cal['parameters']
        orient(u*((w/2-cx)/scale)+v*((cy-h/2)/scale),u,v,b,w/scale,w,h)
    else:
        wpx=457;length=583;height=175;unit=6/length
        back,up,w,h={'top':((0,0,1),(0,-1,0),wpx,length),'left':((-1,0,0),(0,0,1),length,height),'front':((0,1,0),(0,0,1),wpx,height),'rear':((0,-1,0),(0,0,1),wpx,height)}[key]
        b,v=Vector(back),Vector(up)
        orient(Vector((0,0,height*unit/2)),v.cross(b),v,b,max(w,h)*unit,w,h)
s.timeline_markers.clear()
s.timeline_markers.new('이전 · 단일 아틀라스',frame=1);s.timeline_markers.new('현재 · 파츠별 아틀라스',frame=2)
s.frame_start=1;s.frame_end=2
for f in (1,2):
    for objects,hidden in ((new,f==1),(old_mesh,f==2)):
        for o in objects:
            for prop in ('hide_render','hide_viewport'):
                setattr(o,prop,hidden);o.keyframe_insert(data_path=prop,frame=f)
tridata={}
for key,f,objects in [('old',1,old_mesh),('new',2,new)]:
    s.frame_set(f);bpy.context.view_layer.update()
    count=0;hits=[]
    dg=bpy.context.evaluated_depsgraph_get()
    x=(94-228.5)*6/583;y=(105-291.5)*6/583
    for o in objects:
        ob=o.evaluated_get(dg);me=ob.data;me.calc_loop_triangles();count+=len(me.loop_triangles)
        if key=='new' and ob.name!='Wing_L':continue
        wi=ob.matrix_world.inverted()
        for z,dz in [(4,-1),(-2,1)]:
            ok,p,_,_=ob.ray_cast(wi@Vector((x,y,z)),wi.to_3x3()@Vector((0,0,dz)))
            assert ok,(key,o.name)
            hits.append((ob.matrix_world@p).z)
    tridata[key]={'mesh_objects':len(objects),'triangles':count,'wing_thickness':abs(hits[0]-hits[1])}
    for angle in ('photo','top','left','front','rear'):
        view(angle);s.render.engine='CYCLES' if angle=='photo' else 'BLENDER_EEVEE'
        s.render.filepath=str(out/f'{key}-{angle}.png')
        bpy.ops.render.render(write_still=True)
    # Identical neutral material for visual inspection of shape alone.
    view('photo');s.render.engine='BLENDER_WORKBENCH'
    s.display.shading.color_type='SINGLE';s.display.shading.single_color=(.55,.58,.62)
    s.render.filepath=str(out/f'{key}-clay.png');bpy.ops.render.render(write_still=True)
(out/'geometry.json').write_text(json.dumps(tridata,indent=2))
s.frame_set(2);view('photo');s.render.engine='CYCLES';s.render.filepath='//renders/compare'
s.name='버전 비교 · 1 이전 / 2 현재'
# Remove the current file's playback note; the camera in this copy is fixed across the two poses.
note=bpy.data.texts.get('읽기 · Aircraft')
if note:note.clear();note.write('1프레임은 이전 단일 기체, 2프레임은 현재 10개 파츠 조립체입니다. 좌우 화살표로 전환합니다.\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(root/'version-comparison/Compare.blend'),compress=True)
