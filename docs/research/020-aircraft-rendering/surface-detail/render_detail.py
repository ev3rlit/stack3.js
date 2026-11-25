"""Study material cues independently on the same previously reconstructed aircraft mesh."""
import json
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from render import s,cam,camera,cal,frame,light,out
src=HERE.parent/'guide-comparison/models/guide-on.glb'
bpy.ops.import_scene.gltf(filepath=str(src),merge_vertices=True)
obj=next(o for o in bpy.context.selected_objects if o.type=='MESH')
mesh=obj.data
mat=mesh.materials[0]
tree=mat.node_tree
shader=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
assert abs(shader.inputs['Roughness'].default_value-.48)<1e-5
# Explicitly preserve the original baked-color UV when adding a second, plan-mapped UV.
original=mesh.uv_layers.active.name
base_uv=tree.nodes.new('ShaderNodeUVMap');base_uv.uv_map=original
base=next(n for n in tree.nodes if n.type=='TEX_IMAGE')
tree.links.new(base_uv.outputs['UV'],base.inputs['Vector'])
plan=mesh.uv_layers.new(name='Registered_TOP')
mw=obj.matrix_world.copy()
inv=mw.inverted()
size=np.array([4.703259005145798,6,1.8010291595197256])
verts=np.array([tuple(mw@v.co) for v in mesh.vertices])
plan_uv=np.column_stack((verts[:,0]/size[0]+.5,.5-verts[:,1]/size[1]))
loop_ids=np.array([l.vertex_index for l in mesh.loops])
plan.uv.foreach_set('vector',plan_uv[loop_ids].astype('float32').ravel())
uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map=plan.name
def mapped(name):
    n=tree.nodes.new('ShaderNodeTexImage')
    n.image=bpy.data.images.load(str(out/(name+'.png')))
    n.image.colorspace_settings.name='Non-Color'
    n.extension='EXTEND'
    tree.links.new(uv.outputs['UV'],n.inputs['Vector'])
    return n.outputs['Color']
rough=mapped('roughness')
height=mapped('panel-height')
bump=tree.nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value=.78
bump.inputs['Distance'].default_value=.016
tree.links.new(height,bump.inputs['Height'])
# Warp only the main wing skin on this display copy, smoothly fading near its tip and root.
def smooth(lo,hi,x):
    t=np.clip((x-lo)/(hi-lo),0,1)
    return t*t*(3-2*t)
x,y,z=verts.T
dx=np.abs((x/size[0]+.5)*457-225.9)
row=(y/size[1]+.5)*583
mid=(56-7*np.clip((dx-40)/174,0,1))*size[2]/175
weight=smooth(72,105,dx)*(1-smooth(175,212,dx))*smooth(56,68,row)*(1-smooth(258,273,row))
weight*=1-smooth(.115,.21,np.abs(z-mid))
basis=obj.shape_key_add(name='Input mesh')
thick=obj.shape_key_add(name='Outer wing section 1.7x')
for index in np.flatnonzero(weight):
    x0,y0,z0=verts[index]
    thick.data[int(index)].co=inv@Vector((x0,y0,mid[index]+(z0-mid[index])*(1+.7*weight[index])))
# Broad grazing reflection shared by every variant makes roughness and relief legible.
light('Long grazing softbox',(-4,-2,2.1),125,3.2,(.87,.92,1))
def set_state(roughness=False,relief=False,geometry=False):
    for socket in (shader.inputs['Roughness'],shader.inputs['Normal']):
        for link in list(socket.links): tree.links.remove(link)
    if roughness:tree.links.new(rough,shader.inputs['Roughness'])
    if relief:tree.links.new(bump.outputs['Normal'],shader.inputs['Normal'])
    thick.value=float(geometry)
    bpy.context.view_layer.update()
def shot(view):
    camera()
    if view=='hero':return
    if view=='canopy':
        target=Vector((0,.92,.98));span=2.20
    elif view=='panel':
        target=Vector((-1.40,-1.86,.57));span=2.05
    elif view=='edge':
        target=Vector((-1.38,0,.59));span=2.22
    if view=='edge':
        back=Vector((0,1,0))
        cam.rotation_euler=(-back).to_track_quat('-Z','Y').to_euler()
    else:
        back=Vector(cal['basis'][2])
    cam.location=target+12*back
    cam.data.ortho_scale=span
    s.render.resolution_x=1000;s.render.resolution_y=440
def section_thickness():
    # Intersect both skins at a point well inside the section with full test weight.
    x=(94/457-.5)*size[0];y=(105/583-.5)*size[1]
    ob=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    hits=[]
    for z0,dz in [(4,-1),(-2,1)]:
        hit,p,_,_=ob.ray_cast(inv@Vector((x,y,z0)),inv.to_3x3()@Vector((0,0,dz)))
        assert hit
        hits.append((mw@p).z)
    return hits[0]-hits[1]
metrics={}
for name,state,views in [
    ('base',(False,False,False),('hero','canopy','panel','edge')),
    ('roughness',(True,False,False),('canopy',)),
    ('bump',(False,True,False),('panel','edge')),
    ('thickness',(False,False,True),('edge',)),
    ('combined',(True,True,False),('hero','edge'))]:
    set_state(*state)
    if name=='combined':
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        final_positions=np.array([tuple(evaluated.matrix_world@v.co) for v in evaluated.data.vertices])
        assert np.array_equal(verts,final_positions), 'The material study must preserve every input vertex'
    metrics[name]=section_thickness()
    for view in views:
        shot(view)
        frame(name+'-'+view,'BLENDER_EEVEE')
(out/'section.json').write_text(json.dumps(metrics,indent=2)+'\n')
