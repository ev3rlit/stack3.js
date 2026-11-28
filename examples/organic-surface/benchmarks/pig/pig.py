"""Assemble registered piglet parts and fold a single open ear rest mesh with a five-bone chain per side."""
import bpy, bmesh, math, json, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from pathlib import Path

out=Path(__file__).resolve().parent
sys.path.insert(0,str(out))
from surface_materials import ground_soles,body_uv,color_body,color_snout,snout_mesh
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
def material(name,srgb,rough=.52):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    rgb=[((v/255+.055)/1.055)**2.4 for v in srgb]
    m.diffuse_color=(*rgb,1);bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Roughness'].default_value=rough
    return m
skin=material('Rose porcelain',(252,181,182))
earskin=material('Ear blush',(253,169,174))
inner=material('Inner ear',(248,159,164))
coral=material('Snout',(248,149,151))
eye=material('Dark cocoa eyes',(53,35,33),.18)
def newmesh(name,pts,faces,mat):
    me=bpy.data.meshes.new(name);me.from_pydata(pts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);scene.collection.objects.link(ob);me.materials.append(mat)
    for f in me.polygons:f.use_smooth=True
    return ob
def source(part):
    mesh=np.load(out/part/'loft.npz')
    pts=mesh['v']
    return (pts-pts.min(0))/np.ptp(pts,axis=0)-.5,mesh['f'].tolist()
def tree(ob):
    bm=bmesh.new();bm.from_mesh(ob.data);bm.transform(ob.matrix_world)
    t=BVHTree.FromBMesh(bm);bm.free();return t

pts,faces=source('head')
head=newmesh('Head',(pts*[.79,.67,.604]+[0,.135,.634]).tolist(),faces,skin)
unified=np.load(out/'torso/unified.npz')
body_mat=material('Body and hooves',(252,181,182))
color_body(body_mat)
body=newmesh('Torso',unified['v'].tolist(),unified['f'].tolist(),body_mat)
bpy.context.view_layer.objects.active=body
mod=body.modifiers.new('Continuous body surface','DECIMATE')
mod.ratio=2400/len(body.data.polygons)
bpy.ops.object.modifier_apply(modifier=mod.name)
ground_soles(body.data)
body_uv(body.data)
snout=bpy.data.objects.new('Snout',snout_mesh(out/'snout/surface.npz'))
scene.collection.objects.link(snout)
color_snout(coral)
snout.data.materials.append(coral)

headtree=tree(head)
for name,sgn in [('L',1),('R',-1)]:
    hit,n,idx,_=headtree.ray_cast(Vector((sgn*.189,1,.674)),Vector((0,-1,0)))
    assert idx is not None
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=hit-.007*n)
    ob=bpy.context.object;ob.name='Eye.'+name
    ob.rotation_euler=n.to_track_quat('Y','Z').to_euler();ob.scale=(.039,.021,.054)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(eye)
    for f in ob.data.polygons:f.use_smooth=True

# Trace the broadside atlas in LEFT coordinates. A small lateral offset clears the return turn.
controls=np.array([[0,160],[47,186],[92,250],[147,300],[198,296],[269,268],[314,225],[334,166],
                   [324,112],[293,68],[241,44],[190,50],[149,80],[125,126],[128,173],
                   [151,202],[185,211],[214,199],[237,169]],float)
def catmull(p0,p1,p2,p3,t):
    return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
path=[]
for i in range(len(controls)-1):
    for frac in (0.,.5):
        path.append(catmull(controls[max(0,i-1)],controls[i],controls[i+1],controls[min(i+2,len(controls)-1)],frac))
path.append(controls[-1]);path=np.asarray(path)
along=np.array([.55,-.835,0]);sideaxis=np.array([.835,.55,0])
s=np.linspace(0,1,len(path))
center=[.185,-.306,.454]+(path[:,0,None]*.00062)*along+((160-path[:,1,None])*.00058)*[0,0,1]+(.038*s[:,None])*sideaxis
tailv=[];tailf=[];N=8
for i,p in enumerate(center):
    tangent=Vector(center[min(i+1,len(center)-1)]-center[max(i-1,0)]).normalized()
    b=tangent.cross(Vector(sideaxis)).normalized();a=b.cross(tangent).normalized()
    radius=(.024-.009*s[i])*(1-.78*max(0,(s[i]-.84)/.16)**2)
    for j in range(N):tailv.append(tuple(Vector(p)+(a*math.cos(2*math.pi*j/N)+b*math.sin(2*math.pi*j/N))*float(radius)))
    if i:
        for j in range(N):
            v0=(i-1)*N+j;v1=(i-1)*N+(j+1)%N
            tailf.append([v0,v1,v1+N,v0+N])
tailf+=[list(range(N))[::-1],list(range((len(center)-1)*N,len(center)*N))]
tail=newmesh('Curled tail',tailv,tailf,skin)

# Both ears use the same straight source, reflected across X. Ring density is maintained in the bend zone.
rest=np.load(out/'ear/rest.npz');local=rest['v'];layout={}
arm=bpy.data.armatures.new('Piglet ear skeleton');rig=bpy.data.objects.new('Piglet',arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,p,q,parent=None):
    b=arm.edit_bones.new(name);b.head=p;b.tail=q
    if parent:b.parent=arm.edit_bones[parent]
    return b
bone('HeadMount',(0,0,.60),(0,0,.69))
limits=[0,.16,.28,.41,.56,1.]
for suffix,sign in [('L',1),('R',-1)]:
    root=Vector((sign*.225,.108,.824))
    # All hinges follow the same diagonal across the leaf. A shared transverse
    # frame rolls the blade forward and outward without wringing its thin rim.
    w=Vector((.84,-sign*.38,-sign*.36)).normalized()
    raw=Vector((sign*.25,-.25,.937))
    e=(raw-w*raw.dot(w)).normalized()
    front=e.cross(w).normalized()
    axis=e.cross(front).normalized()
    length=.419
    names=['EarRoot.','EarBend.','EarArch.','EarRoll.','EarTip.']
    for i,n in enumerate(names):
        bone(n+suffix,root+length*limits[i]*e,root+length*limits[i+1]*e,names[i-1]+suffix if i else 'HeadMount')
    layout[suffix]=(root,e,w,front,axis,length,sign,names)
bpy.ops.object.mode_set(mode='OBJECT')
def smooth(x):
    t=np.clip(x,0,1);return t*t*(3-2*t)
for suffix,(root,e,w,front,axis,length,sign,names) in layout.items():
    verts=[tuple(root + w*(sign*x*.265) + front*(y*.111) + e*(z*length)) for x,y,z in local]
    faces=rest['f'].tolist()
    if sign<0:faces=[f[::-1] for f in faces]
    ob=newmesh('Ear.'+suffix,verts,faces,earskin);ob.data.materials.append(inner)
    for f in ob.data.polygons:
        if f.normal.dot(front)>.60:f.material_index=1
    ob.parent=rig
    groups=[ob.vertex_groups.new(name=n+suffix) for n in names]
    for ix,(_,_,z) in enumerate(local):
        edges=[smooth((z-(p-.068))/.136) for p in limits[1:-1]]
        weights=[1-edges[0],*[a-b for a,b in zip(edges,edges[1:])],edges[-1]]
        for g,weight in zip(groups,weights):
            if weight>0:g.add([ix],float(weight),'REPLACE')
    mod=ob.modifiers.new('Fold from open rest shape','ARMATURE');mod.object=rig
    for i,n in enumerate(names):
        pb=rig.pose.bones[n+suffix];pb.rotation_mode='QUATERNION'
        local_axis=pb.bone.matrix_local.to_quaternion().inverted() @ axis
        turn=[0,30,35,39,44 if sign==1 else 41][i]
        for frame,value in [(1,1),(13,1),(37,0),(49,0),(73,1),(85,1)]:
            pb.rotation_quaternion=Quaternion(local_axis,math.radians(turn*value))
            pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
action=rig.animation_data.action;action.name='Piglet_EarFold'
scene.render.fps=24;scene.frame_start=1;scene.frame_end=85;scene.frame_set(1)
for obj in list(scene.objects):
    if obj.type=='MESH' and obj.parent is None:obj.parent=rig
for obj in scene.objects:obj.select_set(obj.type in ('MESH','ARMATURE'))
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out/'piglet-rig.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_anim_slide_to_zero=True)
# Bake an explicit folded default for viewers that do not play animation.
deps=bpy.context.evaluated_depsgraph_get();baked=[]
for ob in list(scene.objects):
    if ob.type!='MESH':continue
    evaluated=ob.evaluated_get(deps)
    me=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
    duplicate=bpy.data.objects.new(ob.name+' folded',me);scene.collection.objects.link(duplicate)
    duplicate.matrix_world=ob.matrix_world.copy();baked.append(duplicate)
bpy.ops.object.select_all(action='DESELECT')
for ob in baked:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'piglet-folded.glb'),export_format='GLB',use_selection=True,export_animations=False)
for ob in baked:bpy.data.objects.remove(ob,do_unlink=True)

# Studio inspection is separate from the deform/export scene.
def aim(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
def light(name,pos,power,size,color):
    a=bpy.data.lights.new(name,'AREA');a.energy=power;a.shape='DISK';a.size=size;a.color=color
    ob=bpy.data.objects.new(name,a);scene.collection.objects.link(ob);ob.location=pos;aim(ob,(0,0,.55))
floor=material('Lavender studio',(169,158,173),.84)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001));bpy.context.object.data.materials.append(floor)
light('Window',(-2,3.1,4),245,2.7,(1,.94,.90));light('Fill',(2,2.4,1.7),92,2.4,(.89,.94,1))
light('Edge',(1,-2.4,3.1),196,1.65,(1,.95,.90));light('Catchlight',(1.2,2.4,2.7),17,.45,(1,1,1))
scene.world=bpy.data.worlds.new('Studio sky');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.74,.81,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.30
cd=bpy.data.cameras.new('Piglet portrait');cam=bpy.data.objects.new('Piglet portrait',cd);scene.collection.objects.link(cam)
scene.camera=cam;cam.location=(2.05,4.65,1.54);aim(cam,(0,-.025,.54));cd.type='ORTHO';cd.ortho_scale=1.46
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.view_settings.view_transform='Khronos PBR Neutral'
scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
for name,f in [('Folded',1),('Open rest pose',37),('Folded again',73)]:scene.timeline_markers.new(name,frame=f)
scene.frame_set(1);bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'piglet-ear-rig.blend'))
