"""Build a portable Blender scene from a stack3 bundle validated by the calling CLI."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

folder, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
meta = json.loads((folder / 'stack.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
atlas = bpy.data.images.load(str(folder / 'stack.png'))
atlas.pack()
width, depth = meta['width'], meta['depth']
sx, sy, _ = meta['size']
px, py, pz = meta['pivot']
spacing = meta['spacing']
aw, ah = atlas.size
verts, faces, uvs = [], [], []
for layer in range(meta['layers']):
    left = (layer % meta['columns']) * width
    top = (layer // meta['columns']) * depth
    z = (layer + .5) * spacing - pz
    start = len(verts)
    faces.append((start, start + 1, start + 2, start + 3))
    for x, y in ((0, 0), (1, 0), (1, 1), (0, 1)):
        verts.append(((x - .5) * sx - px, (y - .5) * sy - py, z))
        uvs.extend(((left + .5 + x * (width - 1)) / aw,
                    1 - (top + .5 + y * (depth - 1)) / ah))

mesh = bpy.data.meshes.new('Sprite slices')
mesh.from_pydata(verts, [], faces)
mesh.update()
mesh.uv_layers.new(name='Stack atlas').uv.foreach_set('vector', uvs)
stack = bpy.data.objects.new(folder.name, mesh)
scene.collection.objects.link(stack)
mat = bpy.data.materials.new('Sprite color and coverage')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
nodes.clear()
tex = nodes.new('ShaderNodeTexImage')
tex.image = atlas
tex.extension = 'CLIP'
color = nodes.new('ShaderNodeEmission')
links.new(tex.outputs['Color'], color.inputs['Color'])
cutoff = nodes.new('ShaderNodeMath')
cutoff.operation = 'GREATER_THAN'
cutoff.inputs[1].default_value = .5
links.new(tex.outputs['Alpha'], cutoff.inputs[0])
mix = nodes.new('ShaderNodeMixShader')
links.new(cutoff.outputs[0], mix.inputs[0])
links.new(nodes.new('ShaderNodeBsdfTransparent').outputs[0], mix.inputs[1])
links.new(color.outputs[0], mix.inputs[2])
links.new(mix.outputs[0], nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
mesh.materials.append(mat)

scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
extent = meta['layers'] * spacing
center = Vector((-px, -py, extent / 2 - pz))
radius = math.hypot(sx, sy, extent) / 2
cam = bpy.data.objects.new('Preview camera', bpy.data.cameras.new('Orthographic'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.15 * radius
direction = Vector((1, 1.4, .85)).normalized()
cam.location = center + direction * (3 * radius)
cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
cam.data.clip_start = radius * .01
cam.data.clip_end = radius * 6
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            view = area.spaces.active
            view.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
            view.region_3d.view_perspective = 'ORTHO'
            view.region_3d.view_distance = 3 * radius
            view.region_3d.view_location = center
            view.shading.type = 'MATERIAL'
            view.overlay.show_overlays = False
bpy.context.view_layer.objects.active = stack
stack.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
