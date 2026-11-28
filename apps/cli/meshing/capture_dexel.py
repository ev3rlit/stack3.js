"""Blender background tool: registered closed GLB solids -> ordered XYZ depth/normal intervals."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def import_solids(source, origin, upper):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=True)
    trees = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            bm.transform(obj.matrix_world)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
            if not bm.faces or any(not e.is_manifold or not e.is_contiguous for e in bm.edges) or bm.calc_volume(signed=True) <= 0:
                raise ValueError(f"{obj.name} needs a closed, consistently outward-oriented solid")
            coords = np.array([list(v.co) for v in bm.verts])
            if np.any(coords.min(axis=0) < origin) or np.any(coords.max(axis=0) > upper):
                raise ValueError(f"{obj.name} exceeds the registered stack bounds")
            bm.normal_update()
            trees.append(BVHTree.FromBMesh(bm))
        finally:
            bm.free()
    if not trees:
        raise ValueError("no meshes in capture source")
    return trees


def scan(trees, axis, grid, origin, step):
    other = [i for i in range(3) if i != axis]
    direction = np.eye(3)[axis]
    unit = Vector(direction)
    span = grid[axis]*step[axis]
    epsilon = float(min(step) * 1e-4)
    offsets, depth, normals = [0], [], []
    for uv in np.ndindex(*(grid[other])):
        start = origin.copy()
        start[other] += (np.array(uv)+.5)*step[other]
        start[axis] -= step[axis]
        intervals = []
        for tree in trees:
            point = Vector(start)
            entry = None
            for _ in range(8192):
                hit, normal, face, _ = tree.ray_cast(point, unit, span+2*step[axis])
                if face is None:
                    break
                t = float(np.clip(hit[axis]-origin[axis], 0, span))
                if normal[axis] < -1e-7 and entry is None:
                    entry = (t, list(normal))
                elif normal[axis] > 1e-7 and entry is not None:
                    if t > entry[0]:
                        intervals.append((entry[0],t,entry[1],list(normal)))
                    entry = None
                elif abs(normal[axis]) > 1e-7:
                    raise ValueError(f"unpaired intersection on axis {axis}, ray {uv}")
                point = hit + epsilon*unit
            else:
                raise ValueError("too many hits on a capture ray")
            if entry is not None:
                raise ValueError(f"open interval on axis {axis}, ray {uv}")
        union = []
        for lo, hi, enter, leave in sorted(intervals,key=lambda row:row[0]):
            if union and lo <= union[-1][1]+epsilon:
                if hi > union[-1][1]:
                    union[-1][1], union[-1][3] = hi, leave
            else:
                union.append([lo,hi,enter,leave])
        for lo,hi,enter,leave in union:
            depth.extend((lo,hi))
            normals.extend((enter,leave))
        offsets.append(len(depth))
    return np.array(offsets,np.uint32), np.asarray(depth,float), np.asarray(normals,float).reshape(-1,3)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("stack",type=Path)
    parser.add_argument("source",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    meta=json.loads((args.stack/"stack.json").read_text())
    grid=np.array([meta[key] for key in ("width","depth","layers")])
    size=np.array([*meta["size"][:2],meta["layers"]*meta["spacing"]])
    step=size/grid
    origin=-size*[.5,.5,0]-meta["pivot"]
    trees=import_solids(args.source.resolve(),origin,origin+size)
    data=dict(version=np.array(1),grid=grid,origin=origin,step=step,
              source_sha256=np.array(hashlib.sha256(args.source.read_bytes()).hexdigest()))
    for axis,name in enumerate("xyz"):
        offsets,depth,normals=scan(trees,axis,grid,origin,step)
        for key,value in (("offsets",offsets),("depth",depth),("normals",normals)):
            data[name+"_"+key]=value
        print(f"{name}: {len(depth)} hits, {np.count_nonzero(np.diff(offsets)>2)} multi-interval rays")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    # Write only after all three captures complete, replace atomically on retry.
    import tempfile
    with tempfile.NamedTemporaryFile(dir=args.output.parent,suffix=".npz",delete=False) as tmp:
        name=Path(tmp.name)
    try:
        np.savez_compressed(name,**data)
        name.replace(args.output)
    finally:
        name.unlink(missing_ok=True)


main()
