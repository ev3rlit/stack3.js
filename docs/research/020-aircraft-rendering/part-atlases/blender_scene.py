"""Create the self-contained Blender deliverable with the GLB animation and fixed wing geometry."""
import sys,json
from pathlib import Path
import bpy,numpy as np
from mathutils import Matrix,Vector
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
from render import s,cam,camera,cal,out,light

spec=json.loads((here/'calibration.json').read_text())
mounts=json.loads((here/'mounts.json').read_text())
assert bpy.ops.import_scene.gltf(filepath=str(here/'aircraft.glb'),merge_vertices=True)=={'FINISHED'}
parts={o.name:o for o in s.objects if o.type=='MESH'}
assert set(parts)==set(mounts)
s.name='항공기 · 부품별 아틀라스'
s.frame_start=0;s.frame_end=96;s.render.fps=24
s.cycles.samples=64;s.render.engine='CYCLES'
s.timeline_markers.new('조립',frame=0)
s.timeline_markers.new('분해',frame=36)
s.timeline_markers.new('재조립 시작',frame=60)
s.timeline_markers.new('복귀',frame=96)
# Pack both the actual image inputs and the stacks that provided geometry.
for key,sp in spec.items():
    for prefix,p in [('ATLAS',here/'atlases'/f'{key}.png'),('STACK',here/'stacks'/key/'stack.png')]:
        img=bpy.data.images.load(str(p))
        img.name=f'{prefix} · {key}';img.use_fake_user=True;img.pack()
for o in parts.values():
    source=mounts[o.name]['source']
    o['Source atlas']='ATLAS · '+source
    o['Source sprite stack']='STACK · '+source
    o['Part guide']={'fuselage':'elliptical longitudinal sections','canopy':'domed canopy with a flat rim',
        'nacelle':'elliptical sections plus TOP scoop and REAR recess','wing':'thin skin and upturned tip',
        'fin':'canted thin sections','canard':'thin tapered sections'}[source]
# Preserve the glTF UVs and use a second UV channel for the wing's authored plan maps.
wing_meshes={o.data.name:o.data for k,o in parts.items() if k.startswith('Wing_')}
for mesh in wing_meshes.values():
    uv=mesh.uv_layers.new(name='Wing_TOP')
    dim=np.array(spec['wing']['dim'])*6/583
    v=np.array([tuple(i.co) for i in mesh.vertices])
    # glTF importer expresses object-local vertex positions in Blender's Z-up coordinates.
    coords=np.column_stack((v[:,0]/dim[0]+.5,.5-v[:,1]/dim[1]))
    loops=np.array([q.vertex_index for q in mesh.loops])
    uv.uv.foreach_set('vector',coords[loops].astype('float32').ravel())
for shader_owner in {o.data.materials[0].name:o.data.materials[0] for k,o in parts.items() if k.startswith('Wing_')}.values():
    tree=shader_owner.node_tree
    bs=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    base=next(n for n in tree.nodes if n.type=='TEX_IMAGE')
    primary=tree.nodes.new('ShaderNodeUVMap');primary.uv_map=next(iter(wing_meshes.values())).uv_layers[0].name
    tree.links.new(primary.outputs['UV'],base.inputs['Vector'])
    uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map='Wing_TOP'
    for key in ('roughness','relief'):
        n=tree.nodes.new('ShaderNodeTexImage')
        n.image=bpy.data.images.load(str(out/f'wing-{key}.png'),check_existing=True)
        n.image.colorspace_settings.name='Non-Color';n.image.pack()
        n.extension='EXTEND';tree.links.new(uv.outputs[0],n.inputs['Vector'])
        if key=='roughness':tree.links.new(n.outputs['Color'],bs.inputs['Roughness'])
        else:
            bump=tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.55;bump.inputs['Distance'].default_value=.010
            tree.links.new(n.outputs['Color'],bump.inputs['Height']);tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
for k,o in parts.items():
    src=mounts[k]['source']
    if src=='wing':continue
    shader=next(n for n in o.data.materials[0].node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value={'canopy':.15,'fuselage':.55,'nacelle':.39,'fin':.52,'canard':.53}[src]
light('Grazing softbox',(-4,-2,2.1),95,3.2,(.87,.92,1))
def collection(name,items):
    col=bpy.data.collections.new(name);s.collection.children.link(col)
    for ob in items:
        for old in list(ob.users_collection):old.objects.unlink(ob)
        col.objects.link(ob)
collection('Aircraft · 10 parts',[bpy.data.objects['Aircraft'],*parts.values()])
collection('Studio · camera and lights',[o for o in list(s.objects) if o.type in ('CAMERA','LIGHT')])
for col in list(bpy.data.collections):
    if not col.objects and not col.children:bpy.data.collections.remove(col)
# Both end poses fit the same viewing direction. The camera follows the spread when scrubbing.
u,v,b=map(Vector,cal['basis'])
s.render.resolution_x=1600;s.render.resolution_y=960;s.render.resolution_percentage=100
s.world.color=(.17,.19,.22)
bpy.context.preferences.edit.keyframe_new_interpolation_type='LINEAR'
for index in (0,36,60,96):
    s.frame_set(index);bpy.context.view_layer.update()
    p=[o.matrix_world@q.co for o in parts.values() for q in o.data.vertices]
    x=[q.dot(u) for q in p];y=[q.dot(v) for q in p]
    center=u*((min(x)+max(x))/2)+v*((min(y)+max(y))/2)
    cam.location=center+b*14;cam.rotation_euler=Matrix([u,v,b]).transposed().to_euler()
    cam.data.ortho_scale=1.13*max(max(x)-min(x),(max(y)-min(y))*1600/960)
    cam.keyframe_insert(data_path='location',frame=index,group='Framing')
    cam.data.keyframe_insert(data_path='ortho_scale',frame=index,group='Framing')
s.frame_set(0)
cam.name='Studio Camera'
cam.data.passepartout_alpha=.88
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.overlay.show_overlays=False
            space.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
            space.region_3d.view_distance=8
            space.region_3d.view_location=(0,0,.7)
            space.region_3d.view_perspective='CAMERA'
            space.region_3d.view_camera_zoom=12
            space.shading.type='MATERIAL'
            space.shading.use_scene_lights=True;space.shading.use_scene_world=True
        elif area.type=='IMAGE_EDITOR':
            area.spaces.active.image=bpy.data.images.get('ATLAS · fuselage')
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=parts['Fuselage']
notes=bpy.data.texts.new('읽기 · Aircraft')
notes.write('각 파츠의 ATLAS 이미지는 TOP, LEFT, FRONT, REAR 순서입니다.\n이미지 에디터에서 ATLAS 또는 STACK을 검색하면 입력 6장과 스프라이트 스택 6장을 확인할 수 있습니다.\n프레임 0 조립 / 36~60 분해 / 96 복귀. 뷰포트에서 스페이스바로 재생합니다.\n각 부품의 사용자 정의 속성에 대응하는 이미지 이름을 기록했습니다.\n')
for img in bpy.data.images:
    if img.type=='IMAGE' and img.has_data and not img.packed_file and img.source=='FILE': img.pack()
s.render.filepath='//renders/aircraft'
bpy.context.preferences.filepaths.save_version=0
assert bpy.ops.wm.save_as_mainfile(filepath=str(here/'Aircraft.blend'),compress=True)=={'FINISHED'}
print('SAVED',len(parts),'parts',len([i for i in bpy.data.images if i.packed_file]),'packed images',s.frame_current)
