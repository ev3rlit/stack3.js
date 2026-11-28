"""Place closed local meshes in the reference atlas coordinate frame and export a clay GLB."""
import json
import math
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parent
layout=json.loads((root/'layout.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
clay=bpy.data.materials.new('Neutral clay')
clay.diffuse_color=(.63,.65,.66,1)
clay.roughness=.72
group=bpy.data.objects.new('Chick',None)
bpy.context.scene.collection.objects.link(group)
for kind, spec in layout.items():
    bpy.ops.import_scene.gltf(filepath=str(root/kind/spec.get('mesh','part.glb')),merge_vertices=True)
    imported=next(o for o in bpy.context.selected_objects if o.type=='MESH')
    points=np.array([list(imported.matrix_world @ v.co) for v in imported.data.vertices])
    faces=[tuple(p.vertices) for p in imported.data.polygons]
    bpy.data.objects.remove(imported,do_unlink=True)
    points=(points-points.min(axis=0))/np.ptp(points,axis=0)-.5
    points*=spec['size']
    if 'lean' in spec:
        angle=math.radians(spec['lean'])
        c,s=math.cos(angle),math.sin(angle)
        points=points@np.array([[c,0,-s],[0,1,0],[s,0,c]])
        points=(points-points.min(axis=0))/np.ptp(points,axis=0)-.5
        points*=spec['size']
    points+=spec['center']
    for sign in ([1,-1] if kind in ('wing','leg') else [1]):
        name=kind.capitalize()+('.L' if sign==1 else '.R') if kind in ('wing','leg') else kind.capitalize()
        reflection=np.array([sign,1,1])
        pivot=np.array(spec['pivot'])*reflection
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata((points*reflection-pivot).tolist(),[],faces if sign==1 else [f[::-1] for f in faces])
        mesh.update()
        for f in mesh.polygons:f.use_smooth=True
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location=pivot
        obj.parent=group
        mesh.materials.append(clay)

out=root/'chick-separated.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(out),merge_vertices=True)
report={}; trees={}
for obj in bpy.context.scene.objects:
    if obj.type!='MESH':continue
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    trees[obj.name]=BVHTree.FromBMesh(bm)
    report[obj.name]=dict(triangles=len(bm.faces),boundary=sum(e.is_boundary for e in bm.edges),
        nonmanifold=sum(not e.is_manifold for e in bm.edges),flipped=sum(not e.is_contiguous for e in bm.edges),
        degenerate=sum(f.calc_area()<1e-11 for f in bm.faces),floor=min(v.co.z for v in bm.verts),volume=bm.calc_volume(signed=True))
    bm.free()
for n in trees:
    if n!='Body': report[n]['body_intersection_pairs']=len(trees[n].overlap(trees['Body']))
(root/'geometry-checks.json').write_text(json.dumps(report,indent=2)+'\n')
print('QA',report)
assert len(report)==7 and all(r['volume']>0 and not any(r[k] for k in ('boundary','nonmanifold','degenerate','flipped')) for r in report.values())
assert all(report[n]['body_intersection_pairs'] for n in trees if n!='Body')
assert all(abs(report[n]['floor'])<1e-6 for n in ['Leg.L','Leg.R'])
