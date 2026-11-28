"""Bake the chick's showcase to a single armature action and export its textured GLB."""
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

OUT = Path(__file__).resolve().parent
FPS, LENGTH = 24, 156
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, LENGTH + 1
chick = bpy.data.objects["Chick"]
objects = list(chick.children)
rest = {o.name: o.matrix_world.copy() for o in objects}
vertices = {o.name: [rest[o.name] @ v.co for v in o.data.vertices] for o in objects}
body = bpy.data.objects["Body"]
body_surface = BVHTree.FromPolygons(vertices["Body"], [f.vertices[:] for f in body.data.polygons])
chest = Vector((0, -.035, .45))
toes = {side:Vector((rest["Leg."+side].translation.x, -.01, .035)) for side in ("L","R")}
ankles = {side:Vector((toes[side].x,-.047,.145)) for side in toes}
rad = math.radians

armature = bpy.data.armatures.new("Chick skeleton")
rig = bpy.data.objects.new("Chick Rig", armature)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
def bone(name, head, length, parent=None):
    b=armature.edit_bones.new(name)
    b.head=head; b.tail=Vector(head)+Vector((0,length,0))
    if parent: b.parent=armature.edit_bones[parent]
bone("Root",(0,0,0),.12)
bone("Trunk",chest,.14,"Root")
for name in ("Beak","Crest","Wing.L","Wing.R","Eye.L","Eye.R"):
    bone(name,rest[name].translation,.05,"Trunk")
for side in toes:
    bone("Foot."+side,toes[side],.10,"Root")
    bone("Ankle."+side,ankles[side],.045,"Foot."+side)
bpy.ops.object.mode_set(mode="OBJECT")
for o in objects:
    o.parent = rig
    o.data.transform(rest[o.name])
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.matrix_basis = Matrix.Identity(4)
    if o.name.startswith("Leg."):
        side=o.name[-1]
        foot=o.vertex_groups.new(name="Foot."+side)
        shin=o.vertex_groups.new(name="Ankle."+side)
        for v in o.data.vertices:
            t=max(0.,min(1.,(v.co.z-.054)/.082))
            w=t*t*(3-2*t)
            if w<1: foot.add([v.index],1-w,"REPLACE")
            if w>0: shin.add([v.index],w,"REPLACE")
    else:
        g=o.vertex_groups.new(name="Trunk" if o.name=="Body" else o.name)
        g.add(list(range(len(o.data.vertices))),1.,"REPLACE")
    mod=o.modifiers.new("Chick skeleton","ARMATURE")
    mod.object=rig
bpy.data.objects.remove(chick,do_unlink=True)

def ease(x):
    x=max(0,min(1,x))
    return x*x*(3-2*x)
def ramp(t,a,b): return ease((t-a)/(b-a))
def pulse(t,a,b):
    return math.sin(math.pi*(t-a)/(b-a))**2 if a<t<b else 0.
def curve(t,keys):
    for (a,v),(b,w) in zip(keys,keys[1:]):
        if t<=b: return v+(w-v)*ramp(t,a,b)
    return keys[-1][1]
def rot(x=0.,y=0.,z=0.):
    return Matrix.Rotation(rad(z),4,"Z") @ Matrix.Rotation(rad(y),4,"Y") @ Matrix.Rotation(rad(x),4,"X")
def diag(s):return Matrix.Diagonal(Vector((*s,1)))
def about(origin,R,delta):
    return Matrix.Translation(origin+delta) @ R @ Matrix.Translation(-origin)

STEPS=[("L",16,29,.145),("R",29,42,.31),("L",42,56,.185)]
PECK=[(0,0),(55,0),(63,12),(69,5),(79,81),(81,76),(90,15),
      (94,22),(99,81),(101,70),(108,-4),(115,0)]
WINGS=[(0,0),(60,0),(78,14),(88,3),(99,10),(109,0),
       (115,13),(119,75),(123,18),(127,95),(131,10),(135,40),(139,13),(146,0)]
CROUCH=[(0,0),(108,0),(116,1),(120,-.45),(126,0),(134,-.12),(138,1.0),(148,0)]
def attitude(n):
    swing=sum((1 if side=="R" else -1)*pulse(n,a,b) for side,a,b,_ in STEPS)
    walk=sum(pulse(n,a,b) for _,a,b,_ in STEPS)
    pitch=curve(n,PECK) + 5*walk
    roll=8*swing + 5*pulse(n,55,68) - 3*pulse(n,142,151)
    yaw=7*swing + 7*pulse(n,56,73)
    return pitch,roll,yaw,walk,swing

def set_pose(name,f,delta=(0,0,0),rotation=None,scale=(1,1,1)):
    pb=rig.pose.bones[name];pb.rotation_mode="QUATERNION"
    pb.location=delta;pb.rotation_quaternion=(rotation or Matrix.Identity(4)).to_quaternion();pb.scale=scale
    for attr in ("location","rotation_quaternion","scale"):
        pb.keyframe_insert(data_path=attr,frame=f,group=name)

beak_local=[v-chest for v in vertices["Beak"]]
root0=Vector((0,0,0))
for n in range(LENGTH+1):
    f=n+1
    progress=ramp(n,117,135)
    u=max(0.,min(1.,(n-117)/18))
    flight=4*u*(1-u)
    step_y={side:sum(d*ramp(n,a,b) for s,a,b,d in STEPS if s==side)*(1-progress) for side in toes}
    root_y=sum(step_y.values())*.5
    root_h=.226*flight
    set_pose("Root",f,(0,root_y,root_h))
    pitch,roll,yaw,walk,swing=attitude(n)
    bend=max(0.,min(1.,pitch/81))
    squash=curve(n,CROUCH)
    breathe=.007*(1-math.cos(2*math.pi*n/52))*.5
    s=(1+.075*squash-.4*breathe,1+.065*squash-.4*breathe,1-.14*squash+breathe)
    r=rot(-pitch,roll,yaw)
    scaled=r @ diag(s)
    target_z=-min((scaled@v).z for v in beak_local)+.0004
    # At peak pitch solve the actual beak-tip height, not a nominal pivot.
    dz=(target_z-chest.z)*bend**2 + .021*walk - .050*squash
    delta=Vector((.041*swing,.108*bend+.015*walk,dz))
    body_matrix=about(chest,scaled,delta)
    set_pose("Trunk",f,delta,r,s)
    for side,sign in (("L",1),("R",-1)):
        flap=curve(n,WINGS)+8*walk
        set_pose("Wing."+side,f,rotation=rot(6*swing*sign+7*flight,-sign*flap,sign*(5*walk+11*flight)))
        # A fixed support foot stays in world space while the root advances.
        arc=sum(pulse(n,a,b) for ss,a,b,_ in STEPS if ss==side)
        progress_in_step=next(((n-a)/(b-a) for ss,a,b,_ in STEPS if ss==side and a<n<b),0.)
        rf=rot(21*arc*math.cos(math.pi*progress_in_step)-21*flight,sign*3*arc)
        toe=toes[side]
        bottom=min((rf@(v-toe)).z+toe.z for v in vertices["Leg."+side])
        fd=Vector((sign*.013*arc, step_y[side]-root_y, .077*arc+.038*flight-bottom))
        set_pose("Foot."+side,f,fd,rf)
        foot_matrix=about(toe,rf,fd)
        top=foot_matrix@ankles[side]
        near=body_surface.find_nearest(body_matrix.inverted()@top)
        correction=Vector((0.,0.,0.))
        if near[0] is not None:
            loc,norm,_,_=near
            offset=(body_matrix.inverted()@top-loc).dot(norm)
            if offset>-.014:
                correction=rf.to_3x3().inverted()@(body_matrix@(loc-.014*norm)-top)
        set_pose("Ankle."+side,f,correction)
    delayed_p,delayed_r,_,_,_=attitude(max(0,n-3))
    set_pose("Crest",f,rotation=rot(.17*(pitch-delayed_p)+9*pulse(n,136,141)-4*pulse(n,141,148),
                                     .23*(delayed_r-roll)))
    blink=max(pulse(n,5,11),pulse(n,74,81),pulse(n,96,102),pulse(n,140,146))
    for eye in ("Eye.L","Eye.R"):set_pose(eye,f,scale=(1,1-.20*blink,1-.93*blink))
# Linear per-frame samples preserve planted contacts and the choreography in glTF.
action=rig.animation_data.action;action.name="Chick_Showcase"
for layer in action.layers:
    for strip in layer.strips:
        for cb in strip.channelbags:
            for fc in cb.fcurves:
                for key in fc.keyframe_points:key.interpolation="LINEAR"
for name,n in [("Idle",0),("Step L",16),("Step R",29),("Step L",42),("Look down",56),
               ("Peck 1",79),("Peck 2",99),("Takeoff",117),("Land",135),("Idle",148)]:
    scene.timeline_markers.new(name,frame=n+1)
scene.frame_set(1)
for ob in scene.objects:ob.select_set(False)
for ob in [rig,*objects]:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/"chick-showcase.glb"),export_format="GLB",use_selection=True,
    export_animations=True,export_animation_mode="ACTIONS",export_force_sampling=True,
    export_anim_slide_to_zero=True,export_frame_range=True,export_optimize_animation_size=False)
scene.frame_end=LENGTH
camera=scene.camera
camera.location=(3.45,3.55,1.65)
camera.rotation_euler=(Vector((0,.12,.53))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.ortho_scale=2.00
scene.render.resolution_x=864;scene.render.resolution_y=648;scene.render.resolution_percentage=100
scene.render.fps=FPS
scene.render.image_settings.file_format="PNG";scene.render.image_settings.color_mode="RGB"
scene.render.engine='CYCLES';scene.cycles.samples=14;scene.cycles.use_denoising=True
scene.render.use_persistent_data=True
scene.render.filepath="//frames/"
scene.frame_set(1)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"chick-showcase.blend"))
