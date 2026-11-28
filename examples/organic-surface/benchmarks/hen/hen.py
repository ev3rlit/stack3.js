"""Assemble and reopen the organic CLI meshes, then set up a fixed studio camera."""
from pathlib import Path
import json, math, sys
import bpy,bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent
GAME='--' in sys.argv and 'game' in sys.argv[sys.argv.index('--')+1:]
layout=json.loads((ROOT/'layout.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
root=bpy.data.objects.new('Hen',None);scene.collection.objects.link(root)
def addmesh(name,verts,faces,material,pivot):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    for f in mesh.polygons:f.use_smooth=True
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
    obj.parent=root;obj.location=pivot;mesh.materials.append(material)
    return obj
for part,spec in layout.items():
    bpy.ops.import_scene.gltf(filepath=str(ROOT/part/('part.glb' if GAME else 'studio.glb')),merge_vertices=True)
    src=next(obj for obj in bpy.context.selected_objects if obj.type=='MESH')
    mesh=src.data
    verts=np.array([list(src.matrix_world @ v.co) for v in mesh.vertices])
    verts=(verts-verts.min(0))/np.ptp(verts,axis=0)-.5
    verts*=spec['size']
    if 'lean' in spec:
        a=math.radians(spec['lean']);c,s=math.cos(a),math.sin(a)
        verts=verts@np.array([[c,0,-s],[0,1,0],[s,0,c]])
        verts=((verts-verts.min(0))/np.ptp(verts,axis=0)-.5)*spec['size']
    verts[:,1]+=spec.get('shear_y',0)*verts[:,2]/spec['size'][2]
    if part=='comb':
        a=math.radians(-10)
        c,s=math.cos(a),math.sin(a)
        verts=verts@np.array([[1,0,0],[0,c,s],[0,-s,c]])
        verts[:,2]+=.5*spec['size'][2]-verts[:,2].max()
    if 'yaw_degrees' in spec:
        a=math.radians(spec['yaw_degrees']);c,s=math.cos(a),math.sin(a)
        verts=verts@np.array([[c,s,0],[-s,c,0],[0,0,1]])
    verts+=spec['center']
    if part in ('beak','wattle'):
        bpy.context.view_layer.update()
        shell=scene.objects['Body']
        bm=bmesh.new();bm.from_mesh(shell.data);bm.transform(shell.matrix_world)
        surface=BVHTree.FromBMesh(bm);bm.free()
        if part=='wattle':
            # Register the pair as one volume. Projecting each vertex onto the
            # chest flattens the lower bulbs and erases their measured side depth.
            z=spec['center'][2]-.16*spec['size'][2]
            hit,_,face,_=surface.ray_cast(Vector((0,1,z)),Vector((0,-1,0)))
            assert face is not None
            verts[:,1]+=hit.y+.004-spec['center'][1]
        else:
            minimum=verts[:,1].min();span=np.ptp(verts[:,1])
            for point in verts:
                x,y,z=point
                hit,_,face,_=surface.ray_cast(Vector((x,1,z)),Vector((0,-1,0)))
                if face is not None:
                    q=(y-minimum)/span
                    point[1]+=min(0,hit.y-.013-minimum)*(1-q)**2
    faces=[tuple(f.vertices) for f in mesh.polygons]
    faceuv=[[tuple(mesh.uv_layers.active.data[i].uv) for i in f.loop_indices] for f in mesh.polygons]
    mat=mesh.materials[0];mat.name=part.title()+' | atlas'
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Roughness'].default_value=.43 if part in ('foot','beak') else .56
    for node in mat.node_tree.nodes:
        if node.type=='TEX_IMAGE':node.image.name=part.title()+' pigment';node.image.pack()
    bpy.data.objects.remove(src,do_unlink=True)
    for sign in ((1,-1) if part in ('wing','foot') else (1,)):
        suffix=('.L' if sign==1 else '.R') if part in ('wing','foot') else ''
        mirror=np.array([sign,1,1]);pivot=np.array(spec['pivot'])*mirror
        obj=addmesh(part.title()+suffix,(verts*mirror-pivot).tolist(),[f[::sign] for f in faces],mat,pivot)
        uv=obj.data.uv_layers.new(name='PartAtlas')
        for poly,tex in zip(obj.data.polygons,faceuv):
            for k,coord in zip(poly.loop_indices,tex[::sign]):uv.data[k].uv=coord

bpy.context.view_layer.update()
body=scene.objects['Body']
bm=bmesh.new();bm.from_mesh(body.data);bm.transform(body.matrix_world);tree=BVHTree.FromBMesh(bm);bm.free()
def material(name,color,roughness):
    m=bpy.data.materials.new(name);m.use_nodes=True
    rgb=np.array(color)/255;linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*linear,1);bs.inputs['Roughness'].default_value=roughness
    return m
eye_mat=material('Dark umber', [58,39,32],.19)
for sign in (1,-1):
    hit,n,idx,_=tree.ray_cast(Vector((sign*.128,1,.614)),Vector((0,-1,0)))
    assert idx is not None
    tangent=Vector((0,0,1)).cross(n).normalized();up=n.cross(tangent).normalized()
    v=[tuple(n*.023)];f=[];normals=[tuple(n)];segments=16
    for r in (.68,1.):
        for j in range(segments):
            a=2*math.pi*j/segments;x=r*math.cos(a);z=r*math.sin(a);y=math.sqrt(1-r*r)
            v.append(tuple(tangent*(.039*x)+up*(.049*z)+n*(.023*y)))
            normals.append(tuple((tangent*(x/.039)+up*(z/.049)+n*(y/.023)).normalized()))
    v.append(tuple(-n*.023));normals.append(tuple(-n))
    for j in range(segments):
        k=(j+1)%segments;i1,i2=1+j,1+k;o1,o2=1+segments+j,1+segments+k
        f.extend([(0,i1,i2),(i1,o1,o2),(i1,o2,i2),(len(v)-1,o2,o1)])
    obj=addmesh('Eye.'+('L' if sign==1 else 'R'),v,f,eye_mat,hit-.007*n)
    obj.data.normals_split_custom_set_from_vertices(normals)
    lens_uv=obj.data.uv_layers.new(name='LensUV')
    for poly in obj.data.polygons:
        rear=(len(v)-1) in poly.vertices[:]
        for i in poly.loop_indices:
            pos=obj.data.vertices[obj.data.loops[i].vertex_index].co
            u=pos.dot(tangent)/.039;vv=pos.dot(up)/.049
            lens_uv.data[i].uv=((.75 if rear else .25)+(-.23 if rear else .23)*u,.5+.46*vv)

asset=ROOT/('hen-game.glb' if GAME else 'hen.glb')
bpy.ops.export_scene.gltf(filepath=str(asset),export_format='GLB',export_animations=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(asset),merge_vertices=True)
scene=bpy.context.scene
meshes={o.name:o for o in scene.objects if o.type=='MESH'}
qa={'parts':{},'contacts':{},'packed_textures':len([im for im in bpy.data.images if im.packed_file])}
trees={}
for name,o in meshes.items():
    bm=bmesh.new();bm.from_mesh(o.data);bm.transform(o.matrix_world)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    trees[name]=BVHTree.FromBMesh(bm)
    q=dict(triangles=len(bm.faces),volume=bm.calc_volume(signed=True),floor=min(v.co.z for v in bm.verts),
           unclosed=sum(not e.is_manifold for e in bm.edges),bad_winding=sum(not e.is_contiguous for e in bm.edges),
           degenerate=sum(f.calc_area()<1e-12 for f in bm.faces))
    bm.free();qa['parts'][name]=q
for name,other in trees.items():
    if name!='Body':qa['contacts'][name]=len(other.overlap(trees['Body']))
qa['contacts']['Wattle-Beak']=len(trees['Wattle'].overlap(trees['Beak']))
qa['triangles']=sum(q['triangles'] for q in qa['parts'].values())
(ROOT/('game-checks.json' if GAME else 'geometry-checks.json')).write_text(json.dumps(qa,indent=2)+'\n')

assert len(meshes)==10 and qa['packed_textures']==6
assert all(c>0 for c in qa['contacts'].values()),qa['contacts']
assert all(q['volume']>0 and not any(q[k] for k in ('unclosed','bad_winding','degenerate')) for q in qa['parts'].values())
assert all(abs(qa['parts']['Foot.'+side]['floor'])<1e-5 for side in ('L','R'))
if GAME:
    assert qa['triangles']<=1600
    sys.exit(0)

floor=material('Lavender-grey studio',[164,153,169],.85)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001));bpy.context.object.data.materials.append(floor)
def aim(obj,pt):obj.rotation_euler=(Vector(pt)-obj.location).to_track_quat('-Z','Y').to_euler()
def light(name,pos,energy,size,color):
    data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.size=size;data.shape='DISK';data.color=color
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=pos;aim(ob,(0,0,.53))
light('Window',(-2.1,3.1,3.9),236,2.6,(1,.94,.87))
light('Fill',(2.3,2.25,1.7),80,2.7,(.88,.92,1))
light('Rim',(1.05,-2.5,2.9),180,1.8,(1,.92,.82))
light('Eyes',(1.2,2.5,2.65),16,.43,(1,.98,.95))
scene.world=bpy.data.worlds.new('Soft ambient');scene.world.use_nodes=True
bg=scene.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(.7,.72,.80,1);bg.inputs[1].default_value=.30
cam=bpy.data.cameras.new('Portrait');eye=bpy.data.objects.new('Portrait',cam);scene.collection.objects.link(eye)
scene.camera=eye;cam.type='ORTHO';cam.ortho_scale=1.29
eye.location=(2.55,4.30,1.57);aim(eye,(0,0,.49))
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.view_settings.view_transform='Khronos PBR Neutral'
scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'hen-studio.blend'))
print(json.dumps(qa))
