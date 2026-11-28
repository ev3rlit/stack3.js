"""Export the chosen shape with one neutral material, keeping geometry and UVs."""
from pathlib import Path
import bpy
import sys

root = Path(__file__).resolve().parent
args = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
source, path = map(Path,args) if args else (root/"L-lod.glb",root/"chick-contour-loft-1600.glb")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source.resolve()), merge_vertices=True)
obj = next(o for o in bpy.context.selected_objects if o.type=="MESH")
clay = bpy.data.materials.new("Neutral clay")
clay.diffuse_color = (.59,.62,.64,1)
clay.roughness = .72
obj.data.materials.clear()
obj.data.materials.append(clay)
path = path.resolve()
bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,export_animations=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)
mesh=next(o.data for o in bpy.context.selected_objects if o.type=="MESH")
mesh.calc_loop_triangles()
assert len(mesh.loop_triangles)==1600
