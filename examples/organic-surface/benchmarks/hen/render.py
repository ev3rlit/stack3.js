from pathlib import Path
from mathutils import Vector
import bpy,sys,math,os

root=Path(__file__).resolve().parent;scene=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
for gpu in ('METAL','OPTIX','CUDA','HIP'):
    if gpu not in [v[0] for v in prefs.get_device_types(bpy.context)]:continue
    prefs.compute_device_type=gpu;prefs.refresh_devices()
    if any(d.type==gpu for d in prefs.devices):
        for d in prefs.devices:d.use=d.type==gpu
        scene.cycles.device='GPU';break
scene.render.use_persistent_data=True
cam=scene.camera
def pose(path,angle,elev):
    target=Vector((0,0,.49));a=math.radians(angle)
    cam.location=target+Vector((4.7*math.sin(a),4.7*math.cos(a),elev))
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
for n,a,h in [('hero',32,1.03),('left',-90,.25),('front',0,.40)]:pose(root/(n+'.png'),a,h)
if '--' in sys.argv:
    dest=Path(sys.argv[-1]);dest.mkdir(exist_ok=True,parents=True)
    scene.render.resolution_x=640;scene.render.resolution_y=640;scene.cycles.samples=10
    for i in range(72):pose(dest/f'{i:03}.png',32+5*i,.96)
