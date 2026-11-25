"""Run in a fresh background Blender: blender -b -P blender_check.py -- OUTPUT_DIR."""

import json
import os
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

out = Path(sys.argv[sys.argv.index("--") + 1])
rows = json.loads((out / "measurements.json").read_text())
results = {}
for name, row in rows.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = out / (name + ".glb")
    assert bpy.ops.import_scene.gltf(filepath=str(path)) == {"FINISHED"}
    (obj,) = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    mesh = obj.data
    raw = path.read_bytes()
    (n,) = struct.unpack_from("<I", raw, 12)
    doc = json.loads(raw[20 : 20 + n])
    extra = doc["nodes"][0]["extras"]
    assert np.allclose(obj["pivot"], extra["pivot"]) and np.allclose(obj["size"], extra["size"])
    assert np.allclose(np.array(obj.matrix_world), np.eye(4))
    mesh.calc_loop_triangles()
    vertices = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get("co", vertices)
    p, ids = np.unique(vertices.reshape(-1, 3), axis=0, return_inverse=True)
    tri = np.empty(len(mesh.loop_triangles) * 3, np.int32)
    mesh.loop_triangles.foreach_get("vertices", tri)
    f = ids[tri.reshape(-1, 3)]
    edges = f[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2)
    _, groups, counts = np.unique(np.sort(edges, axis=1), axis=0, return_inverse=True, return_counts=True)
    winding = np.bincount(groups, weights=np.sign(edges[:, 1] - edges[:, 0]))
    a, b, c = p[f].astype(float).transpose(1, 0, 2)
    area = np.cross(b - a, c - a)
    volume = np.einsum("ij,ij->", a, np.cross(b, c)) / 6
    (image,) = [node.image for node in mesh.materials[0].node_tree.nodes if node.type == "TEX_IMAGE"]
    lo = np.array(doc["accessors"][0]["min"])
    hi = np.array(doc["accessors"][0]["max"])
    assert np.allclose(p.min(axis=0), [lo[0], -hi[2], lo[1]]) and np.allclose(
        p.max(axis=0), [hi[0], -lo[2], hi[1]]
    )
    assert image.packed_file and len(mesh.uv_layers) == 1
    checks = {
        "triangles": len(f),
        "dimensions": list(obj.dimensions),
        "pivot": list(obj["pivot"]),
        "texture": list(image.size),
        "boundary": int((counts == 1).sum()),
        "nonmanifold": int((counts > 2).sum()),
        "reversed_edges": int((winding != 0).sum()),
        "zero_area": int((np.linalg.norm(area, axis=1) == 0).sum()),
        "signed_volume": volume,
    }
    results[name] = checks
    (out / "blender.json").write_text(json.dumps(results, indent=2) + "\n")
    assert (
        len(f) == row["triangles"]
        and np.isclose(volume, row["volume"])
        and all(checks[k] == 0 for k in ("boundary", "nonmanifold", "reversed_edges", "zero_area"))
    ), (name, checks)
    if name == "blocks-monotone" and os.environ.get("STACK3_QA_SCRIPTS"):
        sys.path.insert(0, os.environ["STACK3_QA_SCRIPTS"])
        import qa_check
        import review_shots

        (out / "asset-qa.json").write_text(
            json.dumps(qa_check.run(objects=[obj.name], profile="game"), default=str)
        )
        for mode in ("solid", "wire"):
            review_shots.run(objects=[obj.name], mode=mode, out=str(out / f"block-{mode}.png"), res=160)
    if name.split("-")[0] in ("canard", "wing", "canopy"):
        # Frame from the common saved stack, not each candidate's fitted bounds.
        scene = bpy.context.scene
        size = np.array(extra["size"])
        center = Vector((0, 0, size[2] / 2)) - Vector(extra["pivot"])
        direction = Vector((1.2, -1.8, 1)).normalized()
        cam = bpy.data.objects.new("Review", bpy.data.cameras.new("Review"))
        scene.collection.objects.link(cam)
        cam.location = center + direction * size.max() * 3
        cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size.max() * 1.35
        scene.camera = cam
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.color_type = "TEXTURE"
        scene.display.shading.light = "STUDIO"
        scene.render.resolution_percentage = 100
        scene.render.resolution_x = scene.render.resolution_y = 160
        scene.render.filepath = str(out / (name + ".png"))
        bpy.ops.render.render(write_still=True)
print(f"Verified {len(results)} Blender imports")
