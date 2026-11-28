"""Check exported aperture silhouettes and feature depths using Blender BVH ray casting."""
import hashlib
import json
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
if len(args) not in (1, 2):
    raise ValueError("Pass a GLB path and optionally a report JSON path after --")
mesh_path = Path(args[0]).resolve()
fixture = Path(__file__).resolve().parent / "inputs/fixture.json"
SPEC = json.loads(fixture.read_text())
UNIT = SPEC["sceneUnitsPerMillimeter"]

FRONT, BASE_HEIGHT = SPEC["base"]["depth"]/2, SPEC["base"]["height"]


def sample_profile(profile, x, y, at):
    cx, cy = profile["center"]
    if profile["kind"] == "round":
        a, b = profile["range"]
        r, s = profile["radii"]
        radius = r + (s-r)*(at-a)/(b-a)
        return np.hypot(x-cx, y-cy) < radius
    phi = profile["angle"]*pi/180
    vertices = [(cx+profile["radius"]*cos(phi+i*2*pi/profile["sides"]),
                 cy+profile["radius"]*sin(phi+i*2*pi/profile["sides"])) for i in range(profile["sides"])]
    inside = np.ones_like(x, dtype=bool)
    for (ax, ay), (bx, by) in zip(vertices, vertices[1:]+vertices[:1]):
        inside &= (bx-ax)*(y-ay) > (by-ay)*(x-ax)
    return inside


def mesh_bvh(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = np.empty(len(mesh.vertices)*3, np.float32)
    triangles = np.empty(len(mesh.loop_triangles)*3, np.int32)
    mesh.vertices.foreach_get("co", vertices)
    mesh.loop_triangles.foreach_get("vertices", triangles)
    points, remap = np.unique(vertices.reshape(-1,3), axis=0, return_inverse=True)
    faces = remap[triangles.reshape(-1,3)]
    edges = faces[:, [[0,1],[1,2],[2,0]]].reshape(-1,2)
    _, groups, counts = np.unique(np.sort(edges,axis=1),axis=0,return_inverse=True,return_counts=True)
    winding = np.bincount(groups,weights=np.sign(edges[:, 1]-edges[:, 0]))
    a,b,c = points[faces].astype(float).transpose(1,0,2)
    stats = {"triangles":len(faces), "boundaryEdges":int((counts==1).sum()), "nonmanifoldEdges":int((counts>2).sum()),
             "inconsistentEdges":int((winding!=0).sum()), "zeroArea":int((np.linalg.norm(np.cross(b-a,c-a),axis=1)==0).sum())}
    return BVHTree.FromPolygons(points.tolist(), faces.tolist(), all_triangles=True), stats


def overlap(expected, observed):
    return round(float((expected & observed).sum() / (expected | observed).sum()),4)


def connected_at_center(mask, xs, ys, x, y):
    i, j = np.unravel_index(np.argmin((xs - x)**2 + (ys - y)**2), mask.shape)
    region = np.zeros_like(mask)
    if not mask[i, j]:
        return region
    region[i, j] = True
    pending = [(i, j)]
    rows, columns = mask.shape
    while pending:
        r, c = pending.pop()
        for a, b in ((r+1, c), (r-1, c), (r, c+1), (r, c-1)):
            if 0 <= a < rows and 0 <= b < columns and mask[a, b] and not region[a, b]:
                region[a, b] = True
                pending.append((a, b))
    return region


def measure(bvh):
    def front_hit(x,z):
        return bvh.ray_cast(Vector((-x*UNIT,2,z*UNIT)), Vector((0,-1,0)))[0]

    def top_hit(x,y):
        return bvh.ray_cast(Vector((-x*UNIT,y*UNIT,2)),Vector((0,0,-1)))[0]

    cuts, bosses = {}, {}
    for shape in SPEC["cuts"]:
        x,z=shape["center"]
        point=front_hit(x,z)
        radius=max(shape.get("radii",[shape.get("radius",0)]))+0.9
        x0,x1=np.clip([x-radius,x+radius],-29.1,29.1)
        z0,z1=np.clip([z-radius,z+radius],1,38.8)
        xs,zs=np.meshgrid(np.arange(x0,x1+0.01,.29),np.arange(z0,z1+0.01,.29))
        expected=sample_profile(shape,xs,zs,FRONT)
        observed=[]
        for px,pz in zip(xs.ravel(),zs.ravel()):
            hit=front_hit(px,pz)
            observed.append(hit is None or FRONT-hit.y/UNIT>1.1)
        observed = np.array(observed).reshape(xs.shape)
        mouth = connected_at_center(observed, xs, zs, x, z)
        through=bool(shape.get("through"))
        expected_depth = None if through else FRONT-shape["range"][0]
        depth = None if point is None else round(FRONT-point.y/UNIT,4)
        cuts[shape["name"]]={"throughExpected":through,"throughAtCenter":point is None,
                             "expectedDepthMm":expected_depth,"depthMm":depth,
                             "mouthIou":overlap(expected,mouth),
                             "mouthBoundingBoxIou":overlap(expected,observed)}
    for shape in SPEC["bosses"]:
        x,y=shape["center"]
        point=top_hit(x,y)
        height=point.z/UNIT-BASE_HEIGHT if point is not None else 0
        radius=np.max(shape.get("radii",[shape.get("radius",0)]))+1
        xs,ys=np.meshgrid(np.arange(x-radius,x+radius+0.01,.31),np.arange(y-radius,y+radius+0.01,.31))
        expected=sample_profile(shape,xs,ys,BASE_HEIGHT+1)
        observed=[]
        for px,py in zip(xs.ravel(),ys.ravel()):
            hit=top_hit(px,py)
            observed.append(hit is not None and hit.z/UNIT>BASE_HEIGHT+1)
        bosses[shape["name"]]={"heightMm":round(height,4),"expectedHeightMm":shape["range"][1]-BASE_HEIGHT,
                               "footprintIou":overlap(expected,np.array(observed).reshape(xs.shape))}

    # Count detached footprint regions above the base with an independent stack of vertical rays.
    xs,ys=np.meshgrid(np.arange(-29.7,30,0.5),np.arange(-24.7,25,0.5))
    raised=set()
    for i,j in np.ndindex(xs.shape):
        hit=top_hit(xs[i,j],ys[i,j])
        if hit is not None and hit.z/UNIT>BASE_HEIGHT+2:
            raised.add((i,j))
    count=0
    while raised:
        count+=1
        queue=[raised.pop()]
        for i,j in queue:
            for key in ((i+1,j),(i-1,j),(i,j+1),(i,j-1)):
                if key in raised:
                    raised.remove(key)
                    queue.append(key)
    return {"pockets":cuts,"bosses":bosses,"raisedComponents":count}


bpy.ops.wm.read_factory_settings(use_empty=True)
assert bpy.ops.import_scene.gltf(filepath=str(mesh_path)) == {"FINISHED"}
objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(objects) != 1:
    raise ValueError("The benchmark must contain one mesh")
bvh, result = mesh_bvh(objects[0])
result.update(measure(bvh))

errors = [key for key in ("boundaryEdges", "nonmanifoldEdges", "inconsistentEdges", "zeroArea") if result[key]]
if result["triangles"] > 2400:
    errors.append("triangle budget exceeded")
if result["raisedComponents"] != len(SPEC["bosses"]):
    errors.append("raised regions are missing, split or merged")
for name, pocket in result["pockets"].items():
    if pocket["throughAtCenter"] != pocket["throughExpected"]:
        errors.append(name + ": through status changed")
    if pocket["expectedDepthMm"] is not None:
        depth = pocket["depthMm"]
        if depth is None or abs(depth - pocket["expectedDepthMm"]) > 0.1:
            errors.append(name + ": pocket center depth differs by more than 0.1 mm")
    if pocket["mouthIou"] < 0.97:
        errors.append(name + ": mouth IoU fell below 0.97")
for name, boss in result["bosses"].items():
    if abs(boss["heightMm"] - boss["expectedHeightMm"]) > 0.1:
        errors.append(name + ": height differs by more than 0.1 mm")

report = {"blender": bpy.app.version_string, "sha256": hashlib.sha256(mesh_path.read_bytes()).hexdigest(),
          "triangleBudget": 2400, "passes": not errors, "errors": errors, **result}
if len(args) > 1:
    Path(args[1]).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if errors:
    raise ValueError("Benchmark validation failed")
