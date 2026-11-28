"""Attribute and UV bindings shared by authoring and game meshes."""
from pathlib import Path
import bpy
import numpy as np

ROOT=Path(__file__).resolve().parent

def linear(rgb):
    c=np.asarray(rgb)/255.
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)

def snout_mesh(path):
    data=np.load(path)
    points=data['v']*[.283,.117,.197]+[0,.458,.588]
    mesh=bpy.data.meshes.new('Rounded snout')
    mesh.from_pydata(points.tolist(),[],data['f'].tolist())
    mesh.update()
    for face in mesh.polygons:face.use_smooth=True
    # Gradually darken the recess. No per-face material switch at the lip.
    depth=data['shade'][:,None]
    colors=linear([248,149,151])*(1-depth)+linear([200,97,109])*depth
    layer=mesh.color_attributes.new(name='Socket tone',type='FLOAT_COLOR',domain='POINT')
    layer.data.foreach_set('color',np.column_stack((colors,np.ones(len(colors)))).astype('f4').ravel())
    mesh.color_attributes.active_color=layer
    return mesh

def color_snout(mat):
    attr=mat.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name='Socket tone'
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    mat.node_tree.links.new(attr.outputs['Color'],shader.inputs['Base Color'])

def ground_soles(mesh):
    # Decimation can move a support vertex slightly. Each sole is fixed at z=0
    # and the sub-millimetre correction fades within the hoof itself.
    anchors=np.array([[-.143,.166],[.143,.166],[-.213,-.282],[.213,-.282]])
    coords=np.array([v.co[:] for v in mesh.vertices])
    nearest=np.argmin(np.linalg.norm(coords[:,None,:2]-anchors[None,:,:],axis=2),axis=1)
    for i in range(len(anchors)):
        group=np.flatnonzero((nearest==i)&(coords[:,2]<.04))
        low=coords[group,2].min()
        t=np.clip((coords[group,2]-low)/(.04-low),0,1)
        heights=coords[group,2]-low*(1-t*t*(3-2*t))
        for idx,z in zip(group,heights):
            mesh.vertices[int(idx)].co.z=float(z)
    mesh.update()


def body_uv(mesh):
    layer=mesh.uv_layers.get('Hoof height') or mesh.uv_layers.new(name='Hoof height')
    for loop in mesh.loops:
        _,y,z=mesh.vertices[loop.vertex_index].co
        layer.data[loop.index].uv=((y+.55)/.9,(z+.015)/.63)

def color_body(mat):
    image=bpy.data.images.load(str(ROOT/'torso/skin-hoof.png'))
    image.colorspace_settings.name='sRGB';image.pack()
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image=image;tex.extension='EXTEND'
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
