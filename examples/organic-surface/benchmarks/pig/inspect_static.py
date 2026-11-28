import bpy,sys,numpy as np
from pathlib import Path
root=Path.cwd()
p=Path(sys.argv[-1]);p.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'piglet-folded.glb'),merge_vertices=True)
for obj in bpy.context.scene.objects:
 if obj.type!='MESH':continue
 obj.data.calc_loop_triangles()
 np.savez(p/(obj.name.removesuffix(' folded')+'.npz'),v=np.array([obj.matrix_world@v.co for v in obj.data.vertices]),f=np.array([f.vertices[:] for f in obj.data.loop_triangles]))
