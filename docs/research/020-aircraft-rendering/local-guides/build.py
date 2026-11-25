"""Subtract the surface reconstructed from the local RGBA stack, keeping the base GLB intact."""
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

here=Path(__file__).resolve().parent
work=Path(sys.argv[sys.argv.index('--')+1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(here.parent/'guide-comparison/models/guide-on.glb'),merge_vertices=True)
base=next(o for o in bpy.context.scene.objects if o.type=='MESH')
base.name='Section-guided airframe'
values=np.load(work/'cutter.npz')
cm=bpy.data.meshes.new('RGBA section cuts')
cm.from_pydata(values['vertices'].tolist(),[],values['faces'].tolist())
cm.update()
tool=bpy.data.objects.new('Subtractive stack',cm)
bpy.context.collection.objects.link(tool)

def interior_material(name,source=None):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Metallic'].default_value=.22
    shader.inputs['Roughness'].default_value=.55
    shader.inputs['Base Color'].default_value=(.033,.041,.050,1)
    img=mat.node_tree.nodes.new('ShaderNodeTexImage')
    path=here.parent/f'inputs/{source}.png' if source else work/'liner.png'
    img.image=bpy.data.images.load(str(path))
    mat.node_tree.links.new(img.outputs['Color'],shader.inputs['Base Color'])
    return mat

for mat in (interior_material('Recess wall'),interior_material('Intake floor','top'),interior_material('Outlet back','rear')):
    cm.materials.append(mat)
uv=cm.uv_layers.new(name=base.data.uv_layers.active.name)
unit=6/583
size_x=4.703259005145798
for f in cm.polygons:
    # A floor and its sidewall choose different materials so the baked rim stays on the rim.
    y=f.center.y/unit+291.5
    rear=y<60
    if rear:
        f.material_index=2 if y>24 and f.normal.y>.55 else 0
    else:
        f.material_index=1 if f.normal.z<-.55 else 0
    f.use_smooth=True
    for loop in f.loop_indices:
        p=cm.vertices[cm.loops[loop].vertex_index].co
        x=(p.x+size_x/2)/unit
        t=p.y/unit+291.5
        z=p.z/unit
        if f.material_index==0:
            # Solid-color liner, use its most face-on projection to keep nonzero UV area.
            coords=(x/457,t/583,z/175)
            axis=max(range(3),key=lambda a:abs(f.normal[a]))
            u,v=(coords[(axis+1)%3],coords[(axis+2)%3])
        elif rear:
            cx,ref=(199.,258.) if x<225.9 else (256.,198.)
            # Reproject the central end-view disc onto the back of the new cup.
            u=(ref-(x-cx)*1.12)/457
            v=1-(113.5-(z-61.5)*1.04)/175
        else:
            u=x/457
            v=1-t/583
        uv.data[loop].uv=(u,v)
# On exterior faces, keep the normal field of the accepted mesh. A Boolean cut can
# change vertex valence and introduce a long shading seam across an otherwise flat panel.
original=base.data
original.calc_loop_triangles()
positions=[v.co.copy() for v in original.vertices]
indices=[tuple(t.vertices) for t in original.loop_triangles]
corner_normals=[[original.corner_normals[i].vector.copy() for i in t.loops] for t in original.loop_triangles]
outer_bvh=BVHTree.FromPolygons(positions,indices,all_triangles=True)
mod=base.modifiers.new('Local negative sections','BOOLEAN')
mod.operation='DIFFERENCE'
mod.solver='EXACT'
mod.object=tool
mod.material_mode='TRANSFER'
bpy.context.view_layer.objects.active=base
assert bpy.ops.object.modifier_apply(modifier=mod.name)=={'FINISHED'}
result=base.data
normals=[n.vector.copy() for n in result.corner_normals]
for face in result.polygons:
    if face.material_index!=0: continue
    for i in face.loop_indices:
        pos=result.vertices[result.loops[i].vertex_index].co
        nearest,_,triangle,distance=outer_bvh.find_nearest(pos)
        assert distance<2e-5
        a,b,c=(positions[k] for k in indices[triangle])
        normals[i]=barycentric_transform(nearest,a,b,c,*corner_normals[triangle]).normalized()
result.normals_split_custom_set(normals)
bpy.data.objects.remove(tool,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
base.select_set(True)
res=bpy.ops.export_scene.gltf(filepath=str(here/'aircraft.glb'),export_format='GLB',use_selection=True,
    export_animations=False,export_normals=True,export_texcoords=True,export_materials='EXPORT')
assert res=={'FINISHED'}
print('EXPORTED',base.name,len(base.data.polygons),[m.name for m in base.data.materials])
