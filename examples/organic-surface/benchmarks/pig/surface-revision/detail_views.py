"""Matched Cycles detail shots from a build's authored studio scene."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
args=sys.argv[sys.argv.index("--")+1:]
out=Path(args[0]);out.mkdir(exist_ok=True,parents=True)
if len(args)>1:
    for ob in list(bpy.context.scene.objects):
        if ob.type in ("MESH","ARMATURE") and ob.name!="Plane":
            bpy.data.objects.remove(ob,do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(args[1]).resolve()),merge_vertices=True)
s=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
for mode in ('METAL','OPTIX','CUDA','HIP'):
    if mode in [r[0] for r in prefs.get_device_types(bpy.context)]:
        prefs.compute_device_type=mode;prefs.refresh_devices()
        if any(d.type==mode for d in prefs.devices):
            for d in prefs.devices:d.use=d.type==mode
            s.cycles.device='GPU';break
s.render.use_persistent_data=False
s.frame_set(1)
s.render.resolution_x=760;s.render.resolution_y=510;s.cycles.samples=30
c=s.camera
for name,target,offset,scale in [
    ('snout',(0,.46,.586),(1.15,4.8,.68),.39),
    ('body',(0,-.09,.245),(3.65,2.55,1.23),1.18)
]:
    if name=='body':
        for ob in s.objects:
            if ob.type=='MESH' and ob.name not in ('Plane','Torso') and 'Leg.' not in ob.name:ob.hide_render=True
    c.location=Vector(target)+Vector(offset)
    c.rotation_euler=(-Vector(offset)).to_track_quat('-Z','Y').to_euler()
    c.data.ortho_scale=scale
    s.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
