"""Re-import both GLBs and capture matched studio and clay views."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
from render import camera,cam,s,frame
views={'intake':((-.05,-1.47,.88),(-.62,.90,.81),1.55),'outlet':((0,-2.84,.63),(-.54,-1,.32),1.38)}
for key,path in [('before',here.parent/'guide-comparison/models/guide-on.glb'),('after',here/'aircraft.glb')]:
    assert bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)=={'FINISHED'}
    imported=list(bpy.context.selected_objects)
    for view in ('hero','intake','outlet'):
        camera()
        if view in views:
            target,back,span=views[view]
            direction=Vector(back).normalized()
            cam.location=Vector(target)+12*direction
            cam.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
            cam.data.ortho_scale=span
            s.render.resolution_x=1000;s.render.resolution_y=500
        frame(key+'-'+view,'CYCLES')
        if view!='hero':
            frame(key+'-'+view+'-clay','BLENDER_WORKBENCH')
    for obj in imported: bpy.data.objects.remove(obj,do_unlink=True)
