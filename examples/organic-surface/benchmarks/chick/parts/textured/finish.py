"""UV-map atlas colors, add two separate eye lenses, export, reopen and render."""
import bpy, bmesh, math, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
out=Path(__file__).resolve().parent;root=out.parent
import sys
sys.path.insert(0,str(out))
from uv_bake import bake
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'chick-separated.glb'),merge_vertices=True)
group=bpy.data.objects['Chick']
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']

def surface(name, color, roughness):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=roughness
    return mat,shader

materials={}
for obj in meshes:
    part=obj.name.split('.')[0].lower()
    if part not in materials:
        mat,shader=surface(part.title()+' · atlas',(.8,.6,.1),.49 if part in ('body','crest','wing') else .40)
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
        original=bpy.data.images.load(str(out/(part+'-basecolor.png')))
        original.colorspace_settings.name='sRGB'
        # The atlas is baked on the positive-side instance. Mirrored twins have
        # matching triangle order and receive the same UVs in reversed winding.
        canonical=next(m for m in meshes if m.name==part.capitalize()+'.L') if part in ('wing','leg') else obj
        tex.image=bake(canonical,original,out)
        mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
        if part in ('wing','leg'):
            mirror=next(m for m in meshes if m.name==part.capitalize()+'.R')
            src_uv=canonical.data.uv_layers.active
            target=mirror.data.uv_layers.new(name='AtlasUV')
            # glTF import may reorder vertices and triangles. Match reflected
            # positions, then assign each polygon its own canonical chart.
            def key(mesh,vertex,side):
                x,y,z=mesh.vertices[vertex].co
                return tuple(round(v,5) for v in (side*x,y,z))
            charts={}
            for f in canonical.data.polygons:
                points={key(canonical.data,canonical.data.loops[k].vertex_index,1):src_uv.data[k].uv[:] for k in f.loop_indices}
                charts[frozenset(points)]=points
            for f in mirror.data.polygons:
                keys=[key(mirror.data,mirror.data.loops[k].vertex_index,-1) for k in f.loop_indices]
                points=charts[frozenset(keys)]
                for k,point in zip(f.loop_indices,keys):target.data[k].uv=points[point]
        materials[part]=mat
    obj.data.materials.clear();obj.data.materials.append(materials[part])

body=bpy.data.objects['Body']
bm=bmesh.new();bm.from_mesh(body.data);bm.transform(body.matrix_world);tree=BVHTree.FromBMesh(bm);bm.free()
eye_mat,eye_shader=surface('Eyes · espresso lacquer',(.037,.016,.009),.17)
eye_shader.inputs['IOR'].default_value=1.49
eye_shader.inputs['Coat Weight'].default_value=.23
eye_shader.inputs['Coat Roughness'].default_value=.12
for name,u,v in [('Eye.L',327.5,193.5),('Eye.R',150.0,194.5)]:
    x=(u/480-.5)*.853416063247977;z=1-v/547
    location,normal,face,_=tree.ray_cast(Vector((x,1,z)),Vector((0,-1,0)))
    assert face is not None
    n=normal.normalized();t=Vector((0,0,1)).cross(n).normalized();up=n.cross(t).normalized()
    center=location-n*.009
    rx,rz,depth=.046,.061,.024
    coords=[];normals=[]
    def vertex(a,b,c):
        coords.append(tuple(t*(rx*a)+up*(rz*b)+n*(depth*c)))
        normals.append(tuple((t*(a/rx)+up*(b/rz)+n*(c/depth)).normalized()))
    vertex(0,0,1)
    count=20
    for rad in [.68,1.0]:
        for i in range(count):
            angle=2*math.pi*i/count;vertex(rad*math.cos(angle),rad*math.sin(angle),math.sqrt(1-rad*rad))
    vertex(0,0,-1)
    faces=[]
    for i in range(count):
        k=(i+1)%count;inner=1+i;next_inner=1+k;outer=1+count+i;next_outer=1+count+k
        faces.extend([(0,inner,next_inner),(inner,outer,next_outer),(inner,next_outer,next_inner),(len(coords)-1,next_outer,outer)])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(coords,[],faces);mesh.update()
    for f in mesh.polygons:f.use_smooth=True
    mesh.normals_split_custom_set_from_vertices(normals)
    eye=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(eye)
    eye.parent=group;eye.location=center;mesh.materials.append(eye_mat)

asset=out/'chick-textured.glb'
bpy.ops.export_scene.gltf(filepath=str(asset),export_format='GLB',export_animations=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(asset),merge_vertices=True)
scene=bpy.context.scene
models=[o for o in scene.objects if o.type=='MESH']
assert len(models)==9 and len([o for o in models if o.name.startswith('Eye.')])==2
images=[i for i in bpy.data.images if i.packed_file]
assert len(images)==5
qa={'objects':{},'embedded_images':[i.name for i in images]}
trees={}
for o in models:
    bm=bmesh.new();bm.from_mesh(o.data);bm.transform(o.matrix_world)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    trees[o.name]=BVHTree.FromBMesh(bm)
    qa['objects'][o.name]=dict(triangles=len(bm.faces),boundary=sum(e.is_boundary for e in bm.edges),
                             nonmanifold=sum(not e.is_manifold for e in bm.edges),volume=bm.calc_volume(signed=True))
    bm.free()
    assert qa['objects'][o.name]['volume']>0 and not qa['objects'][o.name]['nonmanifold']
for name,bst in trees.items():
    if name!='Body':
        contacts=len(trees['Body'].overlap(bst))
        qa['objects'][name]['body_contact_pairs']=contacts
        assert contacts>0,name
(out/'render-checks.json').write_text(json.dumps(qa,indent=2)+'\n')
# Studio on a continuous ground plane, with real area-light reflections in the eyes.
floor,shader=surface('Backdrop · lavender grey',(.32,.275,.34),.85)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
bpy.context.object.data.materials.append(floor)
def aim(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
def light(name,pos,energy,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos;aim(obj,(0,0,.5))
light('Softbox',(-2.3,2.8,3.7),205,2.5,(1,.94,.85))
light('Fill',(2.2,2.6,1.65),85,2.6,(.87,.91,1))
light('Eye catchlight',(1.25,2.6,2.7),18,.48,(1,.98,.94))
light('Rim',(1.4,-2.2,2.8),165,1.9,(1,.92,.81))
world=bpy.data.worlds.new('Soft ambient');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.67,.71,.8,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.27
cam=bpy.data.cameras.new('Product portrait');camera=bpy.data.objects.new('Product portrait',cam);scene.collection.objects.link(camera);scene.camera=camera
cam.type='ORTHO';cam.ortho_scale=1.38
bpy.context.preferences.filepaths.save_version=0
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.view_settings.view_transform='Khronos PBR Neutral'
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
for name,pos in [('hero',(1.65,3.9,1.34)),('front',(0,4.5,.81)),('side',(-4.5,0,.79))]:
    camera.location=pos;aim(camera,(0,0,.48))
    scene.render.filepath=str(out/(name+'.png'))
    if name=='hero':bpy.ops.wm.save_as_mainfile(filepath=str(out/'chick-studio.blend'))
    bpy.ops.render.render(write_still=True)
