"""Render the rest-to-fold demonstration and isolated bone-guide views."""
import bpy,json,sys,os
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

out=Path(__file__).resolve().parent
cache=Path(sys.argv[-1]);cache.mkdir(exist_ok=True,parents=True)
scene=bpy.context.scene;cam=scene.camera
prefs=bpy.context.preferences.addons['cycles'].preferences
available=[i[0] for i in prefs.get_device_types(bpy.context)]
for backend in ('METAL','OPTIX','CUDA','HIP'):
    if backend in available:
        prefs.compute_device_type=backend;prefs.refresh_devices()
        if any(d.type==backend for d in prefs.devices):
            for d in prefs.devices:d.use=d.type==backend
            scene.cycles.device='GPU';break
scene.render.use_persistent_data=True
def frame(f,path):
    scene.frame_set(f);scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
if not os.environ.get('GUIDES_ONLY'):
    for name,f in [('folded',1),('open',37)]:frame(f,out/(name+'.png'))
scene.render.resolution_x=720;scene.render.resolution_y=680;scene.cycles.samples=12
# Allow extra headroom for the upright ears.
cam.data.ortho_scale=1.54
cam.rotation_euler=(Vector((0,-.025,.59))-cam.location).to_track_quat('-Z','Y').to_euler()
for index in range(0 if os.environ.get("GUIDES_ONLY") else 84):
    frame(1+(36+index)%84,cache/f'{index:03d}.png')

rig=bpy.data.objects['Piglet']
for ob in scene.objects:
    if ob.type=='MESH' and ob.name!='Ear.L':ob.hide_render=True
cam.location=(2.8,1.35,1.35);aim=Vector((.315,.14,1.015))
cam.rotation_euler=(aim-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=.62
scene.render.resolution_x=460;scene.render.resolution_y=440;scene.render.film_transparent=True
scene.render.image_settings.color_mode='RGBA';scene.cycles.samples=24
scene.render.engine='BLENDER_WORKBENCH';scene.display.render_aa='8'
shade=scene.display.shading;shade.color_type='SINGLE';shade.single_color=(.9,.48,.52);shade.light='STUDIO';shade.studio_light='paint.sl'
scene.view_settings.view_transform='Standard'
paths={}
for name,f in [('open',37),('mid',61),('folded',73)]:
    frame(f,cache/f'bones-{name}.png')
    chain=[rig.pose.bones[n+'.L'] for n in ('EarRoot','EarBend','EarArch','EarRoll','EarTip')]
    points=[b.head for b in chain]+[chain[-1].tail]
    projected=[world_to_camera_view(scene,cam,rig.matrix_world@p) for p in points]
    paths[name]=[[float(v.x*460),float((1-v.y)*440)] for v in projected]
(cache/'points.json').write_text(json.dumps(paths))
