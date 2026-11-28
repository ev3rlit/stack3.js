"""Run topology-changing operations in a disposable headless Blender process."""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def dissolve(bm, angle):
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(angle), verts=list(bm.verts), edges=list(bm.edges))
    bm.normal_update()


def bevel(bm, options):
    dissolve(bm, 0.001)
    edges = [edge for edge in bm.edges if edge.is_manifold and edge.calc_face_angle(0) > math.radians(40)]
    if edges:
        bevel_edges(bm, edges, options)
    print(f"bevel: {len(edges)} candidate creases")


def bevel_edges(bm, edges, options):
    return bmesh.ops.bevel(bm, geom=edges, offset=options["bevelWidth"], segments=options.get("bevelSegments", 2),
                          affect="EDGES", profile=0.5, clamp_overlap=True, loop_slide=True)


def mesh_arrays(mesh):
    mesh.calc_loop_triangles()
    vertices = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    faces = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.vertices.foreach_get("co", vertices)
    mesh.loop_triangles.foreach_get("vertices", faces)
    return vertices.reshape(-1, 3), faces.reshape(-1, 3)


def topology(mesh):
    vertices, faces = mesh_arrays(mesh)
    if not len(faces) or not np.isfinite(vertices).all():
        return None
    # Blender's triangle area can round a valid, thin triangle to zero.
    a, b, c = vertices[faces].astype(np.float64).transpose(1, 0, 2)
    if np.any(np.all(np.cross(b - a, c - a) == 0, axis=1)):
        return None
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        if any(not edge.is_manifold or not edge.is_contiguous for edge in bm.edges):
            return None
        pending = {vert for vert in bm.verts if vert.link_faces}
        euler = len(pending) - len(bm.edges) + len(bm.faces)
        components = 0
        while pending:
            components += 1
            frontier = [pending.pop()]
            while frontier:
                vert = frontier.pop()
                for edge in vert.link_edges:
                    neighbor = edge.other_vert(vert)
                    if neighbor in pending:
                        pending.remove(neighbor)
                        frontier.append(neighbor)
        return components, euler
    finally:
        bm.free()


def edit_mesh(mesh, operation):
    candidate = bpy.data.meshes.new("stack3-edited")
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()
        operation(bm)
        bm.to_mesh(candidate)
    finally:
        bm.free()
    candidate.update()
    return candidate


def keep_closed(previous, candidate, signature, name):
    if candidate is previous or topology(candidate) == signature:
        return candidate
    print(f"{name}: retained previous geometry because the result changed the closed topology")
    return previous


def simplify(mesh, budget):
    mesh.calc_loop_triangles()
    if len(mesh.loop_triangles) <= budget:
        return mesh
    obj = bpy.data.objects.new("stack3-surface", mesh)
    bpy.context.scene.collection.objects.link(obj)
    modifier = obj.modifiers.new("Quadric simplification", "DECIMATE")
    modifier.ratio = budget / len(mesh.loop_triangles)
    modifier.use_collapse_triangulate = True
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return bpy.data.meshes.new_from_object(evaluated)


def bevel_rim(mesh, rim, options, signature):
    axis = "xyz".index(rim["axis"])
    u, v = (i for i in range(3) if i != axis)
    center = rim["center"]

    def near_rim(vertex):
        point = vertex.co
        distance = math.hypot(point[u] - center[u], point[v] - center[v])
        return (abs(distance - rim["radius"]) < rim["radialTolerance"]
                and abs(point[axis] - center[axis]) < rim["axialTolerance"])

    def operation(bm):
        edges = [edge for edge in bm.edges
                 if edge.is_manifold and edge.calc_face_angle(0) > math.radians(26)
                 and all(near_rim(vertex) for vertex in edge.verts)]
        if not edges:
            raise ValueError(f'LOD bevel rim {rim["id"]}: no matching crease edges')
        faces = bevel_edges(bm, edges, options)["faces"]
        if not faces:
            raise ValueError(f'LOD bevel rim {rim["id"]}: bevel created no faces')
        print(f'LOD bevel rim {rim["id"]}: {len(edges)} edges, {len(faces)} bevel faces', flush=True)

    candidate = edit_mesh(mesh, operation)
    if topology(candidate) != signature:
        raise ValueError(f'LOD bevel rim {rim["id"]}: bevel changed the closed topology')
    return candidate


def lod_bevel(mesh, options, signature):
    if "dissolveAngle" in options:
        mesh = keep_closed(mesh, edit_mesh(mesh, lambda bm: dissolve(bm, options["dissolveAngle"])), signature, "planar dissolve")
    plan = options["lodBevel"]
    mesh = simplify(mesh, plan["preTriangleBudget"])
    if topology(mesh) != signature or len(mesh.loop_triangles) > plan["preTriangleBudget"]:
        raise ValueError("LOD bevel: pre-bevel QEM did not meet its triangle budget with closed topology")
    print(f"LOD bevel: pre-QEM {len(mesh.loop_triangles)} triangles", flush=True)
    for rim in plan["rims"]:
        mesh = bevel_rim(mesh, rim, options, signature)
    triangles, budget = len(mesh.loop_triangles), options["triangleBudget"]
    if triangles > budget:
        raise ValueError(f"LOD bevel: {triangles} triangles exceed finish.triangleBudget {budget}; lower preTriangleBudget to leave room for bevels")
    return mesh


def ambient_occlusion(mesh, vertices, triangles, radius):
    bvh = BVHTree.FromPolygons(vertices.tolist(), triangles.tolist(), all_triangles=True)
    epsilon = max(float(np.ptp(vertices, axis=0).max()) * 1e-6, 1e-8)
    count = 16
    offsets = []
    for i in range(count):
        z = math.sqrt((i + 0.5) / count)
        phi = i * math.pi * (3 - math.sqrt(5))
        radial = math.sqrt(1 - z * z)
        offsets.append((math.cos(phi) * radial, math.sin(phi) * radial, z))
    values = np.empty(len(vertices), dtype=np.float32)
    for vertex in mesh.vertices:
        n = vertex.normal
        if n.length < 0.5:
            values[vertex.index] = 1
            continue
        tangent = n.cross(Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))).normalized()
        bitangent = n.cross(tangent)
        launch = vertex.co + n * epsilon
        occluded = sum(bvh.ray_cast(launch, x * tangent + y * bitangent + z * n, radius)[0] is not None for x, y, z in offsets)
        values[vertex.index] = 1 - occluded / count
    return values


def main(folder):
    options = json.loads((folder / "input.json").read_text())["finish"]
    file = folder / "geometry.npz"
    with np.load(file, allow_pickle=False) as data:
        vertices, triangles = data["vertices"], data["faces"]
    mesh = bpy.data.meshes.new("stack3-surface")
    mesh.from_pydata(vertices.tolist(), [], triangles.tolist())
    mesh.update()
    signature = topology(mesh)
    if signature is None:
        raise ValueError("input is not a closed, nondegenerate Blender surface")
    if "lodBevel" in options:
        mesh = lod_bevel(mesh, options, signature)
    else:
        if "bevelWidth" in options:
            mesh = keep_closed(mesh, edit_mesh(mesh, lambda bm: bevel(bm, options)), signature, "bevel")
        if "dissolveAngle" in options:
            mesh = keep_closed(mesh, edit_mesh(mesh, lambda bm: dissolve(bm, options["dissolveAngle"])), signature, "planar dissolve")
        if "triangleBudget" in options:
            mesh = keep_closed(mesh, simplify(mesh, options["triangleBudget"]), signature, "QEM")
    vertices, faces = mesh_arrays(mesh)
    output = {"vertices": vertices, "faces": faces}
    if "aoRadius" in options:
        output["occlusion"] = ambient_occlusion(mesh, vertices, faces, options["aoRadius"])
    print(f"finished surface: {len(faces)} triangles")
    np.savez(file, **output)


main(Path(sys.argv[sys.argv.index("--") + 1]))
