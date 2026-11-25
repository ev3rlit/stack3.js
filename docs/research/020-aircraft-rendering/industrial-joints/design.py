"""Native Blender cosmetic pass on a copy of the studio aircraft. No change to wing vertices."""
from pathlib import Path
import sys, math
import numpy as np
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
here=Path(__file__).resolve().parent;w=Path(sys.argv[-1])
s=bpy.context.scene;s.frame_set(0);bpy.context.view_layer.update()
u=6/583;cx=225.9
def world(sign,r,y,z):return Vector(((cx+sign*r-228.5)*u,(y-291.5)*u,z*u))
def height(o,sign,r,y):
    inv=o.matrix_world.inverted()
    hit,p,_,_=o.ray_cast(inv@world(sign,r,y,200), inv.to_3x3()@Vector((0,0,-1)))
    return (o.matrix_world@p).z/u if hit else None
def mat(name,base,rough,metal):
    m=bpy.data.materials.new(name);b=m.node_tree.nodes.get('Principled BSDF')
    for k,v in [('Base Color',(*base,1)),('Roughness',rough),('Metallic',metal)]:b.inputs[k].default_value=v
    return m
paint=mat('Shoulder cover · graphite ceramic',(.084,.098,.112),.46,.33)
lip=mat('Shoulder edge · satin graphite',(.105,.12,.132),.44,.40)
reveal=mat('Recess · shaded joint',(.019,.023,.028),.67,.05)
trim=mat('Wing edge · brushed titanium',(.095,.112,.129),.50,.44)
wmat=bpy.data.objects['Wing_R'].data.materials[0];tree=wmat.node_tree
bs=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
rought=bs.inputs['Roughness'].links[0].from_socket
base=bs.inputs['Base Color'].links[0].from_socket
mask=tree.nodes.new('ShaderNodeMath');mask.operation='LESS_THAN';mask.inputs[1].default_value=.38;tree.links.new(rought,mask.inputs[0])
mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[2].default_value=(.49,.52,.56,1)
tree.links.new(mask.outputs[0],mix.inputs[0]);tree.links.new(base,mix.inputs[1]);tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
minimum=tree.nodes.new('ShaderNodeMath');minimum.operation='MAXIMUM';minimum.inputs[1].default_value=.47
tree.links.new(rought,minimum.inputs[0]);tree.links.new(minimum.outputs[0],bs.inputs['Roughness'])
def add_line(material):
    if material.get('cover seam'):return
    material['cover seam']=True
    tree=material.node_tree;bs=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map='CoverPlan'
    for asset in ('joint-color','joint-height'):
        t=tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(w/(asset+'.png')),check_existing=True)
        t.image.colorspace_settings.name='sRGB' if asset=='joint-color' else 'Non-Color';t.image.pack();t.extension='EXTEND'
        tree.links.new(uv.outputs['UV'],t.inputs['Vector'])
        if asset=='joint-color':
            m=tree.nodes.new('ShaderNodeMixRGB');m.blend_type='MULTIPLY';m.inputs[0].default_value=.86
            if bs.inputs['Base Color'].is_linked:tree.links.new(bs.inputs['Base Color'].links[0].from_socket,m.inputs[1])
            else:m.inputs[1].default_value=bs.inputs['Base Color'].default_value
            tree.links.new(t.outputs['Color'],m.inputs[2]);tree.links.new(m.outputs[0],bs.inputs['Base Color'])
        else:
            b=tree.nodes.new('ShaderNodeBump');b.inputs['Distance'].default_value=.010;b.inputs['Strength'].default_value=.62
            tree.links.new(t.outputs['Color'],b.inputs['Height']);tree.links.new(b.outputs['Normal'],bs.inputs['Normal'])
# Longitudinal stations at the wing/body junction. The outer seam changes direction once.
rows=[(78,50.4,54.3),(83,48.5,58.0),(92,47.3,61.0),(109,46.8,63.1),
      (128,46.3,64.6),(141,46.0,65.5),(149,45.5,63.5),(167,44.8,60.5),
      (181,43.4,57.3),(193,42,54.7),(205,40.8,51.0),(215,40.2,46.6)]
for side,sign in [('L',-1),('R',1)]:
    pod=bpy.data.objects['Nacelle_'+side];wing=bpy.data.objects['Wing_'+side];wing.data.materials[1]=trim
    mw=pod.matrix_world.copy();inv=mw.inverted()
    original=pod.data;original.calc_loop_triangles()
    pos=[v.co.copy() for v in original.vertices];faces=[tuple(t.vertices) for t in original.loop_triangles]
    ns=[[original.corner_normals[i].vector.copy() for i in t.loops] for t in original.loop_triangles]
    bvh=BVHTree.FromPolygons(pos,faces,all_triangles=True)
    orig_uv=original.uv_layers.active.name
    for m in original.materials:
        for n in list(m.node_tree.nodes):
            if n.type=='TEX_IMAGE' and not n.inputs['Vector'].is_linked:
                uv=m.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map=orig_uv;m.node_tree.links.new(uv.outputs['UV'],n.inputs['Vector'])
    verts=[];polys=[];mats=[]
    # Interpolate stations before sampling the triangulated base for a continuous fitted lip.
    ys=np.unique(np.r_[np.arange(78,215,6.2),[r[0] for r in rows]]);stations=np.array(rows)
    for y in ys:
        a=np.interp(y,stations[:,0],stations[:,1]);b=np.interp(y,stations[:,0],stations[:,2]);width=b-a
        e=height(pod,sign,a,y);q=height(wing,sign,b,y)
        assert e and q
        ring=[]
        for f in [0,.12,.28,.46,.65,.82,.96,1]:
            r=a+width*f
            roof=height(pod,sign,r,y)
            top=max(q+1.15+(e-q)*((1-f)**1.45),roof+.47 if roof else -100)
            ring.append((r,y,top))
        ring += [(b,y,q+.67),(b-.42,y,q+.53),(b-.42,y,q-.70),(a,y,q-1.25)]
        verts.extend(tuple(inv@world(sign,*pt)) for pt in ring)
    n=len(ring)
    for i in range(len(ys)-1):
        for j in range(n):
            polys.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j));mats.append(0 if j<7 else 1 if j==7 else 2)
    polys.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+j for j in range(n))]);mats.extend([1,1])
    mesh=bpy.data.meshes.new('Overlap cover');mesh.from_pydata(verts,[],polys);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:]);bm.to_mesh(mesh);bm.free()
    for m in (paint,lip,reveal):mesh.materials.append(m)
    for f,idx in zip(mesh.polygons,mats):f.material_index=idx;f.use_smooth=(idx==0)
    unwrap=mesh.uv_layers.new(name=orig_uv)
    for face in mesh.polygons:
        if face.index<(len(ys)-1)*n:
            row,edge=divmod(face.index,n)
            for li in face.loop_indices:
                vi=mesh.loops[li].vertex_index
                t,j=divmod(vi,n)
                if j==0 and edge==n-1:j=n
                unwrap.uv[li].vector=(.03+.94*t/(len(ys)-1),.17+.80*j/n)
        else:
            pts=np.array([[mesh.vertices[mesh.loops[li].vertex_index].co[k] for k in (0,2)] for li in face.loop_indices])
            pts-=pts.min(0);pts/=np.maximum(pts.max(0),1e-8)
            for li,xy in zip(face.loop_indices,pts):
                unwrap.uv[li].vector=(.03+.44*xy[0]+.5*(face.index==(len(ys)-1)*n+1),.02+.13*xy[1])
    cover=bpy.data.objects.new('Form shoulder step',mesh);s.collection.objects.link(cover);cover.matrix_world=mw
    # Exterior step is part of the engine cover and travels with it on the existing clip.
    bpy.context.view_layer.objects.active=pod
    mod=pod.modifiers.new('Overlapping shoulder','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=cover;mod.material_mode='TRANSFER'
    assert bpy.ops.object.modifier_apply(modifier=mod.name)=={'FINISHED'}
    bpy.data.objects.remove(cover,do_unlink=True)
    result=pod.data;normals=[n.vector.copy() for n in result.corner_normals]
    uv=result.uv_layers.new(name='CoverPlan')
    for f in result.polygons:
        m=result.materials[f.material_index];exterior=m not in (paint,lip,reveal)
        for i in f.loop_indices:
            v=result.vertices[result.loops[i].vertex_index].co;p=mw@v
            uv.uv[i].vector=((p.x/u+228.5-cx)*sign/80,1-(p.y/u+291.5-60)/170)
            if exterior:
                q,_,k,dist=bvh.find_nearest(v)
                assert dist<1e-5
                normals[i]=barycentric_transform(q,*[pos[j] for j in faces[k]],*ns[k]).normalized()
    result.normals_split_custom_set(normals)
    # Keep the base UV active for any legacy, implicit image lookups.
    result.uv_layers.active=result.uv_layers[orig_uv];result.uv_layers[orig_uv].active_render=True
    add_line(result.materials[0]);add_line(paint)
s.name='Aircraft · industrial joint study';s.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=bpy.data.objects['Fuselage']
bpy.context.preferences.filepaths.save_version=0
assert bpy.ops.wm.save_as_mainfile(filepath=str(here/'Aircraft-Industrial.blend'),compress=True)=={'FINISHED'}
