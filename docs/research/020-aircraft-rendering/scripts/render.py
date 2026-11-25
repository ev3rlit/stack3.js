"""Capture exported GLBs in Blender. All main frames use the same projection."""
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
out = Path(sys.argv[sys.argv.index('--')+1])
out.mkdir(parents=True,exist_ok=True)
cal = json.loads((ROOT/'inputs/camera.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.world = bpy.data.worlds.new('Studio ambient')
s.world.use_nodes = True
background = next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND')
background.inputs[0].default_value=(.45,.49,.57,1)
background.inputs[1].default_value=.24
s.render.film_transparent=True
s.render.image_settings.file_format='PNG'
s.render.image_settings.color_mode='RGBA'
s.view_settings.view_transform='Standard'
s.render.resolution_percentage=100
s.cycles.samples=64
s.cycles.use_denoising=True
s.cycles.device='CPU'
s.eevee.taa_render_samples=32
cam = bpy.data.objects.new('Registered camera',bpy.data.cameras.new('Orthographic'))
s.collection.objects.link(cam)
s.camera=cam
cam.data.type='ORTHO'
cam.data.clip_end=100

def camera():
    w,h=cal['resolution']
    s.render.resolution_x=w
    s.render.resolution_y=h
    _,_,_,scale,cx,cy=cal['parameters']
    u,v,b=map(Vector,cal['basis'])
    target=u*((w/2-cx)/scale)+v*((cy-h/2)/scale)
    cam.location=target+12*b
    cam.rotation_euler=Matrix([u,v,b]).transposed().to_euler()
    cam.data.ortho_scale=w/scale

def light(name,location,power,diameter,color):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=power
    data.shape='DISK'
    data.size=diameter
    data.color=color
    ob=bpy.data.objects.new(name,data)
    s.collection.objects.link(ob)
    ob.location=location
    ob.rotation_euler=(Vector((0,0,.60))-ob.location).to_track_quat('-Z','Y').to_euler()
light('Front softbox',(-3,3,6),250,5,(1,.92,.83))
light('Fill',(4,2,3),95,5,(.76,.84,1))
light('Rear strip',(1,-4,5),300,3.8,(.84,.91,1))
shade=s.display.shading
shade.light='STUDIO'
shade.studio_light='paint.sl'
shade.color_type='SINGLE'
shade.single_color=(.56,.60,.65)
shade.show_shadows=True
shade.show_cavity=True
shade.cavity_type='WORLD'
shade.cavity_ridge_factor=1
shade.cavity_valley_factor=1

def frame(file,engine):
    s.render.engine=engine
    s.render.filepath=str(out/(file+'.png'))
    bpy.ops.render.render(write_still=True)
    print('CAPTURED',file,flush=True)

def render_original_assets():
    for name in ('section-loft','surface-nets-qem','marching-cubes','voxel','surface-nets'):
        camera()
        assert bpy.ops.import_scene.gltf(filepath=str(ROOT/'models'/f'{name}.glb'))=={'FINISHED'}
        obs=list(bpy.context.selected_objects)
        asset=next(o for o in obs if o.type=='MESH')
        mat=asset.data.materials[0]
        nodes=mat.node_tree.nodes
        links=mat.node_tree.links
        shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
        output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
        tex=next(n for n in nodes if n.type=='TEX_IMAGE')
        frame(name+'-eevee','BLENDER_EEVEE')
        frame(name+'-clay','BLENDER_WORKBENCH')
        if name=='section-loft':
            frame(name+'-cycles','CYCLES')
            emission=nodes.new('ShaderNodeEmission')
            links.new(tex.outputs['Color'],emission.inputs['Color'])
            links.new(emission.outputs[0],output.inputs['Surface'])
            frame(name+'-unlit','BLENDER_EEVEE')
            links.new(shader.outputs[0],output.inputs['Surface'])
            s.render.resolution_x=640
            s.render.resolution_y=440
            cam.data.ortho_scale=7.2
            for i in range(12):
                a=math.radians(30*i+40)
                elev=math.radians(27)
                direction=Vector((-math.sin(a)*math.cos(elev),math.cos(a)*math.cos(elev),math.sin(elev)))
                cam.location=Vector((0,0,.70))+10*direction
                cam.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
                frame(f'orbit-{i:02d}','BLENDER_EEVEE')
        for ob in obs:
            bpy.data.objects.remove(ob,do_unlink=True)


if __name__ == "__main__":
    render_original_assets()
