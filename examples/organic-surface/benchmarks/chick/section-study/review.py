"""Blender background review of each exported GLB, using one physical scale and camera."""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("dest",type=Path)
parser.add_argument("--source",type=Path,default=Path(__file__).resolve().parent)
parser.add_argument("--cases",nargs="+")
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
root, dest = args.source.resolve(), args.dest.resolve()
dest.mkdir(exist_ok=True, parents=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
cam = bpy.data.cameras.new("Orthographic review")
cam.type = "ORTHO"
cam.ortho_scale = 1.25
eye = bpy.data.objects.new("Camera", cam)
scene.collection.objects.link(eye)
scene.camera = eye
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 480
scene.render.resolution_y = 460
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.display.render_aa = "8"
shade = scene.display.shading
shade.light = "STUDIO"
shade.studio_light = "paint.sl"
shade.color_type = "OBJECT"
shade.show_shadows = False
shade.show_specular_highlight = True
scene.view_settings.view_transform = "Standard"


def camera(direction):
    target = Vector((0, 0, .50))
    eye.location = target + Vector(direction)
    eye.rotation_euler = (target-eye.location).to_track_quat("-Z","Y").to_euler()


def render(path):
    if path.exists():
        return
    bpy.context.view_layer.update()
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


checks = {}
for case in args.cases or ("voxel","A","B","C","D","R","E64","E128","F","G","H","Hproj","F-lod","G-lod","Hproj-lod","L","L-lod","LR-lod","C-lod","F3","LA-lod"):
    bpy.ops.import_scene.gltf(filepath=str(root/(case+".glb")), merge_vertices=True)
    obj = next(o for o in bpy.context.selected_objects if o.type=="MESH")
    obj.rotation_mode = "XYZ"
    obj.color = (.59,.62,.64,1)
    # Weld UV/normal seam duplicates only in a disposable topology check.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    checks[case] = dict(triangles=len(bm.faces),boundary_edges=sum(e.is_boundary for e in bm.edges),
                        nonmanifold_edges=sum(not e.is_manifold for e in bm.edges),
                        inconsistent_edges=sum(e.is_manifold and not e.is_contiguous for e in bm.edges),
                        degenerate_faces=sum(f.calc_area()<1e-12 for f in bm.faces),
                        signed_volume=bm.calc_volume(signed=True))
    bm.free()
    folder=dest/Path(case).name
    folder.mkdir(exist_ok=True)
    camera((0,5,.7))
    for angle in (0,35,90):
        obj.rotation_euler.z=math.radians(angle)
        render(folder/f"clay-{angle}.png")
    camera((0,.00001,5))
    obj.rotation_euler.z=0
    render(folder/"top.png")
    camera((0,5,.7))
    obj.rotation_euler.z=math.radians(35)
    wire=obj.copy()
    scene.collection.objects.link(wire)
    wire.color=(.038,.046,.05,1)
    mod=wire.modifiers.new("Triangle edges","WIREFRAME")
    mod.thickness=.00115 if case!="E128" else .00055
    mod.offset=1
    render(folder/"wire.png")
    bpy.data.objects.remove(wire,do_unlink=True)
    if case in ("A","G-lod","L-lod","LR-lod"):
        for i in range(96):
            obj.rotation_euler.z=2*math.pi*i/96
            render(folder/f"turn-{i:03}.png")
    bpy.data.objects.remove(obj,do_unlink=True)
(root/"mesh-checks.json").write_text(json.dumps(checks,indent=2)+"\n")
