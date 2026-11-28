"""Inspect actual exported triangles and measure changes of slope across the two nostril rims."""
import json
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:]
path=Path(args[0]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)
objects={o.name.removesuffix(' folded'):o for o in bpy.context.scene.objects if o.type=='MESH'}
report={}
trees={}
for name in ('Torso','Snout'):
    ob=objects[name]
    bm=bmesh.new();bm.from_mesh(ob.data);bm.transform(ob.matrix_world)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    vertices=np.array([v.co[:] for v in bm.verts])
    pending=set(bm.verts);components=0
    while pending:
        components+=1
        frontier=[pending.pop()]
        while frontier:
            v=frontier.pop()
            for edge in v.link_edges:
                w=edge.other_vert(v)
                if w in pending:
                    pending.remove(w);frontier.append(w)
    info=dict(components=components,unclosed_edges=sum(not e.is_manifold for e in bm.edges),
              bad_winding=sum(e.is_manifold and not e.is_contiguous for e in bm.edges),
              zero_area=sum(f.calc_area()<1e-12 for f in bm.faces),signed_volume=bm.calc_volume(signed=True))
    if name=='Torso' and not any('Leg.' in k for k in objects):
        feet=[]
        for x in [-1,1]:
            for cx,cy in [(.143,.166),(.213,-.282)]:
                ix=np.hypot(vertices[:,0]-x*cx,vertices[:,1]-cy)<.10
                feet.append(float(vertices[ix,2].min()))
        info['local_floor_z']=feet
        loops={}
        for height in (.0263,.0633):
            graph={}
            for face in bm.faces:
                hits=[]
                for loop in face.loops:
                    a=loop.vert.co; b=loop.link_loop_next.vert.co
                    if (a.z<height)!=(b.z<height):
                        xy=a.lerp(b,(height-a.z)/(b.z-a.z))
                        hits.append((round(xy.x,6),round(xy.y,6)))
                if len(hits)==2 and hits[0]!=hits[1]:
                    a,b=hits;graph.setdefault(a,set()).add(b);graph.setdefault(b,set()).add(a)
            unvisited=set(graph);count=0
            while unvisited:
                frontier=[unvisited.pop()];count+=1
                while frontier:
                    for nb in graph[frontier.pop()]:
                        if nb in unvisited: unvisited.remove(nb);frontier.append(nb)
            loops[str(height)]=count
        info['lower_leg_sections']=loops
    report[name]=info
    trees[name]=BVHTree.FromBMesh(bm)
    bm.free()
def front(x,z):
    hit=trees['Snout'].ray_cast(Vector((x,1,z)),Vector((0,-1,0)))[0]
    if hit is None:raise ValueError('snout ray missed')
    return hit.y
checks=[]
for cx,cz,rx,rz in json.loads((root/'snout/sockets.json').read_text()):
    x,z=cx*.283,.588+cz*.197
    a,b=np.clip(rx*1.23,.076,.10)*.283,np.clip(rz*1.12,.135,.18)*.197
    changes=[];depths=[]
    for theta in np.arange(32)*2*np.pi/32:
        dx,dz=a*np.cos(theta),b*np.sin(theta)
        r=np.linspace(.65,1.60,25)
        y=np.array([front(x+t*dx,z+t*dz) for t in r])
        angles=np.rad2deg(np.arctan(np.diff(y)/(np.diff(r)*np.hypot(dx,dz))))
        changes.append(max(abs(np.diff(angles))))
        depths.append(y[-1]-front(x,z))
    checks.append(dict(depth=float(np.median(depths)),rim_turn_p50_deg=float(np.median(changes))))
report['sockets']=checks
report['body_part_objects']=[k for k in objects if k=='Torso' or 'Leg.' in k]
if len(args)>2 and args[2]=='new':
    for k in ('Torso','Snout'):
        v=report[k];assert v['components']==1 and v['signed_volume']>0 and not any(v[n] for n in ('bad_winding','zero_area','unclosed_edges')), v
    assert max(abs(x) for x in report['Torso']['local_floor_z'])<.0015
    assert all(n==4 for n in report['Torso']['lower_leg_sections'].values())
    assert min(s['depth'] for s in checks)>.025
Path(args[1]).write_text(json.dumps(report,indent=2)+'\n')
print(report)
