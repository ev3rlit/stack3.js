"""Capture both builds with the existing calibrated studio. Unlit bypasses the BSDF."""
import sys
from pathlib import Path

import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from render import camera,frame,s

for guide in ('off','on'):
    camera()
    bpy.ops.import_scene.gltf(filepath=str(HERE/'models'/f'guide-{guide}.glb'))
    objects=list(bpy.context.selected_objects)
    mesh=next(o for o in objects if o.type=='MESH')
    mat=mesh.data.materials[0]
    tree=mat.node_tree
    shader=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    output=next(n for n in tree.nodes if n.type=='OUTPUT_MATERIAL')
    tex=next(n for n in tree.nodes if n.type=='TEX_IMAGE')
    emit=tree.nodes.new('ShaderNodeEmission')
    tree.links.new(tex.outputs['Color'],emit.inputs['Color'])
    for name,engine in [('eevee','BLENDER_EEVEE'),('cycles','CYCLES')]:
        for label,node in [('off',emit),('on',shader)]:
            tree.links.new(node.outputs[0],output.inputs['Surface'])
            frame(f'{guide}-{name}-{label}',engine)
    frame(f'{guide}-clay-on','BLENDER_WORKBENCH')
    for ob in objects:
        bpy.data.objects.remove(ob,do_unlink=True)
