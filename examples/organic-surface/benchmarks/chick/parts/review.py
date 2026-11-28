"""Reopen the GLBs and render identical cameras for the two reconstructions."""
import bpy, json, math, sys
import numpy as np
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parent
out=Path(sys.argv[-1]);out.mkdir(exist_ok=True,parents=True)
for mode,file in [('single',root.parent/'section-study/chick-contour-loft-1600.glb'),('parts',root/'chick-separated.glb'),('exploded',root/'chick-separated.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(file),merge_vertices=True)
    scene=bpy.context.scene
    objects=[o for o in scene.objects if o.type=='MESH']
    # All poses share the reference stack's world axis and original scale.
    pivot=bpy.data.objects.new('Turntable',None);scene.collection.objects.link(pivot)
    for obj in objects:
        transform=obj.matrix_world.copy()
        obj.parent=pivot;obj.matrix_world=transform
        if mode=='exploded':
            v={'Wing.L':(.23,-.02,.045),'Wing.R':(-.23,-.02,.045),'Crest':(0,0,.17),
               'Beak':(0,.23,.035),'Leg.L':(.075,0,-.12),'Leg.R':(-.075,0,-.12)}.get(obj.name,(0,0,0))
            obj.location+=Vector(v)
        if mode!='exploded':
            vertices=np.array([list(transform@v.co) for v in obj.data.vertices])
            faces=np.asarray([tuple(p.vertices) for p in obj.data.polygons])
            np.savez(out/(mode+'-'+obj.name+'.npz'),v=vertices,f=faces)
    cam=bpy.data.cameras.new('Review');cam.type='ORTHO'
    cam.ortho_scale=1.58 if mode=='exploded' else 1.24
    eye=bpy.data.objects.new('Camera',cam);scene.collection.objects.link(eye);scene.camera=eye
    target=Vector((0,0,.5));eye.location=target+Vector((0,5,.7))
    eye.rotation_euler=(target-eye.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=460;scene.render.resolution_y=444;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
    scene.display.render_aa='8'
    sh=scene.display.shading;sh.light='STUDIO';sh.studio_light='paint.sl'
    sh.color_type='SINGLE';sh.single_color=(.59,.62,.64);sh.show_shadows=False;sh.show_specular_highlight=True
    scene.view_settings.view_transform='Standard'
    dest=out/mode;dest.mkdir(exist_ok=True)
    for i in range(96):
        pivot.rotation_euler.z=2*math.pi*i/96
        bpy.context.view_layer.update()
        scene.render.filepath=str(dest/f'{i:03}.png')
        bpy.ops.render.render(write_still=True)
