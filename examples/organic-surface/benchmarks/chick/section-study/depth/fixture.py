"""Add known depth relief to the recovered chick for a synthetic capture regression."""
from pathlib import Path
import bpy
import math

here=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(here.parent/"L.glb"),merge_vertices=True)
obj=next(o for o in bpy.context.scene.objects if o.type=="MESH")
for v in obj.data.vertices:
    p=obj.matrix_world @ v.co
    x,y,z=p
    # Two inset wing rims and a shallow indentation on the front of the head.
    r=math.hypot((y-.015)/.14,(z-.42)/.108)
    rim=-.037*math.exp(-((r-1)/.24)**2) + .018*math.exp(-(r/.76)**4)
    p.x+=math.copysign(1,x)*rim*max(0,min(1,(abs(x)-.18)/.10))
    p.y-=.042*math.exp(-((x-.055)/.087)**2-((z-.75)/.052)**2)*max(0,min(1,(y-.09)/.09))
    v.co=obj.matrix_world.inverted() @ p
obj.data.update()
obj.data.materials.clear()
bpy.ops.export_scene.gltf(filepath=str(here/"synthetic-reference.glb"),export_format="GLB",use_selection=True,export_animations=False)
