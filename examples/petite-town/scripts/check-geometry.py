"""Verify the GLBs with independent ray/vertex queries and actual browser scene matrices."""

from pathlib import Path
import json
import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "verification"
models = {
    p.stem: trimesh.load(p, force="mesh", process=False)
    for p in (ROOT / "models").glob("*.glb")
}
groups = {}
ground = {}
for entry in json.loads((QA / "scene-matrices.json").read_text()):
    mesh = models[entry["part"]].copy()
    mesh.apply_transform(np.array(entry["matrix"]).reshape(4, 4).T)
    groups.setdefault(entry["item"], []).append((entry["part"], mesh))
for name, parts in groups.items():
    vertices = np.concatenate([m.vertices for _, m in parts])
    floor = vertices[:, 1].min()
    feet = vertices[vertices[:, 1] <= floor + 0.012]
    x, z = feet[:, 0], feet[:, 2]
    edge = 4.2 * np.maximum(0, 1 - (z / 5.18) ** 2) ** 0.37
    river = edge * (0.40 + 0.07 * np.sin(z * 1.13))
    channel = 0.57 * np.minimum(1, edge / 1.6)
    east = edge + 0.64 * np.exp(-(((z + 2.4) / 1.6) ** 2)) * np.minimum(1, edge)
    dry = (x >= -edge) & (x <= east) & (np.abs(x - river) >= channel)
    ground[name] = {
        "minimumY": round(float(floor), 5),
        "bankSupportFraction": round(float(dry.mean()), 4),
    }
    assert abs(floor) < 0.002 and dry.mean() > 0.97, (name, ground[name])


def mesh_rays(mesh, axis, probes):
    extent = mesh.extents
    result = []
    for u, v in probes:
        point = mesh.bounds[0].copy()
        axes = [i for i in range(3) if i != axis]
        point[axes[0]] += u * extent[axes[0]]
        point[axes[1]] += v * extent[axes[1]]
        point[axis] = mesh.bounds[1, axis] + 1
        ray = np.zeros(3)
        ray[axis] = -1
        hit, _, _ = mesh.ray.intersects_location([point], [ray])
        result.append(
            None
            if len(hit) == 0
            else round(
                float((hit[:, axis].max() - mesh.bounds[0, axis]) / extent[axis]), 4
            )
        )
    return result


def rays(name, axis, probes):
    return mesh_rays(models[name], axis, probes)


def bridge_profiles(parts):
    # Project complete triangles at one common scale, including both landing shoulders.
    width = 1500
    vertices = np.concatenate([mesh.vertices for _, mesh in parts])
    left, bottom = vertices.min(axis=0)[:2]
    right, top = vertices.max(axis=0)[:2]
    scale = width / (right - left)

    def silhouette(mesh):
        image = Image.new("1", (width + 3, round((top - bottom) * scale) + 3))
        xy = mesh.vertices[:, :2]
        pixels = np.column_stack(((xy[:, 0] - left) * scale, (top - xy[:, 1]) * scale))
        coords = np.rint(pixels + 1).astype(int)
        paint = ImageDraw.Draw(image)
        for triangle in coords[mesh.faces]:
            paint.polygon(triangle.ravel().tolist(), fill=1)
        return np.asarray(image)

    road = silhouette(next(mesh for name, mesh in parts if name == "bridge-arch"))
    frames = [silhouette(mesh) for name, mesh in parts if name == "bridge-side-frame"]
    assert len(frames) == 2
    return {
        "spanPixels": width,
        "deckPixels": int(road.sum()),
        "exposedDeckPixelsBySide": [int(np.count_nonzero(road & ~frame)) for frame in frames],
    }


# In the assembled town, X runs along the bridge and Z passes through both frames.
profile_check = bridge_profiles(groups["bridge"])
assert profile_check["exposedDeckPixelsBySide"] == [0, 0], profile_check
bridge = trimesh.util.concatenate([mesh for _, mesh in groups["bridge"]])
deck = next(mesh for name, mesh in groups["bridge"] if name == "bridge-arch")
deck_heights = mesh_rays(deck, 1, [(x, 0.5) for x in (0.05, 0.25, 0.5, 0.75, 0.95)])
assert all(height is not None for height in deck_heights)
assert deck_heights[0] < deck_heights[1] < deck_heights[2] > deck_heights[3] > deck_heights[4]
crown_rise = (deck_heights[2] - max(deck_heights[0], deck_heights[-1])) * deck.extents[1]
# Compare the walking surface with both capstone runs at the same span positions.
# The end posts interrupt the capstones, so measure between their shoulders.
sample_x = bridge.bounds[0, 0] + bridge.extents[0] * np.linspace(0.18, 0.82, 41)

def surface_heights(mesh, x, z):
    origins = np.column_stack((x, np.full_like(x, 2.0), np.full_like(x, z)))
    hits, indices, _ = mesh.ray.intersects_location(origins, np.tile([0, -1, 0], (len(x), 1)))
    heights = np.full(len(x), -np.inf)
    if len(indices):
        np.maximum.at(heights, indices, hits[:, 1])
    return heights


center_z = deck.bounds.mean(axis=0)[2]
walkway = surface_heights(deck, sample_x, center_z)
rails = [m for name, m in groups["bridge"] if name == "bridge-side-frame"]
rail_gaps = [surface_heights(m, sample_x, m.bounds.mean(axis=0)[2]) - walkway for m in rails]
# A level lintel now spans above the crowned walkway. The rail-to-deck gap
# deliberately increases toward the banks. Check coping level and clearance separately.
coping = [gap + walkway for gap in rail_gaps]
assert len(coping) == 2 and all(np.ptp(h) < 0.025 and h.min() > 0.55 for h in coping)
assert all(g.min() > 0.25 for g in rail_gaps)
assert all(abs(m.bounds[1, 1] - 0.66) < 0.002 for m in rails)
assert 0.14 < crown_rise < 0.28, crown_rise

# Include dry ground beyond each threshold, not just points already on the deck.
# Each lane samples every centimetre from the market bank to the windmill bank.
xs = np.arange(deck.bounds[0, 0] - 0.12, deck.bounds[1, 0] + 0.125, 0.01)
lips, ten_cm_rises = [], []
for z in center_z + np.linspace(-0.35, 0.35, 5):
    heights = surface_heights(deck, xs, z)
    covered = np.isfinite(heights)
    on_deck = np.flatnonzero(covered)
    assert len(on_deck) and np.all(covered[on_deck[0]:on_deck[-1] + 1])
    bank_edge = 4.2 * max(0, 1 - (z / 5.18)**2)**0.37
    water_x = bank_edge * (0.40 + 0.07 * np.sin(z * 1.13))
    half_channel = 0.57 * min(1, bank_edge / 1.6)
    assert np.all(covered[np.abs(xs - water_x) < half_channel])
    assert all(not np.isfinite(surface_heights(rail, xs, z)).any() for rail in rails)
    lips.extend(heights[on_deck[[0, -1]]].tolist())
    path_y = np.maximum(heights, 0.0)
    ten_cm_rises.append(float(np.abs(path_y[10:] - path_y[:-10]).max()))
assert max(lips) < 0.01 and min(lips) >= -0.001, lips
assert max(ten_cm_rises) < 0.035, ten_cm_rises

# Verify the exported UVs on the visible cap, independently of the builder's
# normal-based classification. TOP is the first tile, with a one-texel gutter.
rail = models["bridge-side-frame"]
x, z = np.meshgrid(np.linspace(0.04, 0.96, 19), np.linspace(0.005, 0.995, 201))
origins = np.column_stack((rail.bounds[0, 0] + x.ravel() * rail.extents[0],
                           np.full(x.size, rail.bounds[1, 1] + 1),
                           rail.bounds[0, 2] + z.ravel() * rail.extents[2]))
hits, ray_ids, face_ids = rail.ray.intersects_location(origins, np.tile([0, -1, 0], (len(origins), 1)))
order = np.lexsort((-hits[:, 1], ray_ids))
first = order[np.r_[True, np.diff(ray_ids[order]) != 0]]
faces = rail.faces[face_ids[first]]
bary = trimesh.triangles.points_to_barycentric(rail.vertices[faces], hits[first])
u = (rail.visual.uv[faces, 0] * bary).sum(axis=1)
tex_width = rail.visual.material.baseColorTexture.width
views = json.loads((QA / "models.json").read_text())["bridge-side-frame"]["views"]
top_width = next(v["width"] for v in views if v["direction"] == "top")
assert len(u) and np.all((u * tex_width >= 1) & (u * tex_width <= top_width + 1))

tests = {
    "wellRingCentreAndRim": rays("stone-ring", 1, [(0.5, 0.5), (0.1, 0.5)]),
    "waterCentre": rays("water", 1, [(0.5, 0.5)]),
    "bridgeArchAndAbutments": mesh_rays(
        bridge, 2, [(0.5, 0.2), (0.10, 0.15), (0.90, 0.15)]
    ),
    "bridgeDeckCentre": [deck_heights[2]],
    "bridgeDeckHeightProfile": deck_heights,
    "wheelHubAndSpokeGaps": rays(
        "wheel", 2, [(0.5, 0.5), (0.62, 0.72), (0.68, 0.62), (0.50, 0.77), (0.68, 0.33)]
    ),
    "interiorAndLip": {
        name: rays(
            name, 1, [(0.5, 0.5), (0.5, 0.055) if name == "crate" else (0.09, 0.5)]
        )
        for name in ["basket", "pot", "crate"]
    },
}
# Use the roof part and its mounted vertical scale. Exclude only the rounded end caps.
bakery_roof = next(m for n, m in groups["bakery"] if n == "bakery-roof")
bakery_heights = {}
for name, x, previous in [("bakeryRidge", 0.50, 2.55), ("bakeryEave", 0.96, 1.621177)]:
    profile = rays("bakery-roof", 1, [(x, z) for z in np.linspace(0.06, 0.94, 11)])
    assert all(h is not None for h in profile)
    heights = bakery_roof.bounds[0, 1] + bakery_roof.extents[1] * np.array(profile)
    assert np.ptp(heights) < 0.001 and np.max(np.abs(heights - previous)) < 0.001, (name, heights)
    tests[name] = profile
    bakery_heights[name] = [round(float(h), 6) for h in heights]
bakery_names = [name for name, _ in groups["bakery"]]
for name, count in [("bakery-roof", 1), ("bakery-awning", 1), ("bakery-chimney", 1),
                    ("bakery-window", 2), ("bakery-counter", 1)]:
    assert bakery_names.count(name) == count, (name, bakery_names)
assert (
    tests["wellRingCentreAndRim"][0] is None
    and tests["wellRingCentreAndRim"][1] is not None
)
assert tests["waterCentre"][0] is not None
assert tests["bridgeDeckCentre"][0] is not None
assert tests["bridgeArchAndAbutments"][0] is None and all(
    x is not None for x in tests["bridgeArchAndAbutments"][1:]
)
assert (
    tests["wheelHubAndSpokeGaps"][0] is not None
    and None in tests["wheelHubAndSpokeGaps"][1:]
)
for n, (centre, rim) in tests["interiorAndLip"].items():
    assert centre is not None and rim is not None and centre < rim - 0.14, (
        n,
        centre,
        rim,
    )
pairs = {
    "house": [(part, "house") for part in (
        "house-roof", "house-door", "house-lantern", "house-window-flowers", "house-window"
    )] + [("house-chimney", "house-roof")],
    "bridge": [("bridge-side-frame", "bridge-arch")],
    "bakery": [
        ("basket", "bakery-counter"),
        ("loaf", "bakery-counter"),
        ("bread-sign", "bakery-counter"),
        ("bakery-counter", "bakery-shell"),
        ("bakery-roof", "bakery-shell"),
        ("bakery-awning", "bakery-shell"),
        ("bakery-chimney", "bakery-roof"),
        ("bakery-window", "bakery-shell"),
    ],
    "potionist": [
        ("bottle", "potion-counter"),
        ("potion-counter", "potion-shell"),
        ("potion-sign", "potion-counter"),
        ("potion-window", "potion-shell"),
        ("potion-ivy", "potion-shell"),
        ("potion-chimney", "potion-shell"),
    ],
    "well": [
        ("post", "stone-ring"),
        ("post", "well-roof"),
        ("rope", "well-roof"),
        ("pail", "rope"),
        ("water", "stone-ring"),
    ],
    "apple-crate": [("apple", "crate")],
    "apple-stall": [("awning", "stall-frame"), ("crate", "stall-frame")],
    "flower-cart": [
        ("wheel", "cart-body"),
        ("post", "cart-body"),
        ("flower", "cart-body"),
    ],
    "planter": [("flower", "pot")],
    "lamp": [("flag", "lamp-post")],
    "windmill": [("post", "mill-body")],
}
distances = {}
for item, pairlist in pairs.items():
    records = {}
    for a, b in pairlist:
        first = [m for n, m in groups[item] if n == a]
        second = [m for n, m in groups[item] if n == b]
        distances_a = []
        for idx, m in enumerate(first):
            # One loaf rests in wicker and the centre apple sits on four apples.
            support = second
            if a == "loaf" and idx == 0:
                support = [v for n, v in groups[item] if n == "basket"]
            elif a == "apple" and idx == 4:
                support = first[:4]
            d = min(
                cKDTree(v.vertices).query(m.vertices[::2])[0].min() for v in support
            )
            distances_a.append(round(float(d), 4))
            assert d < 0.025, (item, a, b, idx, d)
        label = a + " / " + b
        if a == "loaf":
            label = "loaf / basket (first), bakery-counter (others)"
        if a == "apple":
            label = "apple / crate (outer), apples (centre)"
        records[label] = distances_a
    distances[item] = records
potion_parts = groups["potionist"]
ivy = [mesh for name, mesh in potion_parts if name == "potion-ivy"]
assert len(ivy) == 4 and sum(name == "potion-window" for name, _ in potion_parts) == 3
joins = [float(cKDTree(a.vertices).query(b.vertices)[0].min()) for a, b in zip(ivy, ivy[1:])]
assert max(joins) < 0.01, joins
distances["potionist"]["consecutive ivy branches"] = [round(d, 4) for d in joins]
# The contour cap spans the shaft with large triangles. Check insertion into
# the hub volume independently of where the triangulator placed its vertices.
windmill = dict(groups["windmill"])
rotor = windmill["rotor"].copy()
rotor.merge_vertices(merge_tex=True, merge_norm=True)
assert rotor.is_watertight
shaft_samples = windmill["post"].vertices[::8]
inside = int(rotor.contains(shaft_samples).sum())
assert 0 < inside < len(shaft_samples), "The shaft must enter the rotor hub"
report = {
    "windmillShaftSamplesInsideRotor": {"inside": inside, "sampled": len(shaft_samples)},
    "ground": ground,
    "bakeryRoofHeightMetres": bakery_heights,
    "bridgeSideProjection": profile_check,
    "bridgeCapTexture": {"sampledTopHits": len(u), "hitsOutsideTopTile": 0},
    "bridgeApproach": {"sampledWidthMetres": 0.70, "lanes": 5, "spacingMetres": 0.01,
                       "maxThresholdHeightMetres": round(max(lips), 4),
                       "maxRisePer10cmMetres": round(max(ten_cm_rises), 4)},
    "bridgeCopingHeightRangesMetres": [[round(float(h.min()), 4), round(float(h.max()), 4)] for h in coping],
    "bridgeRailGapRangesMetres": [[round(float(g.min()), 4), round(float(g.max()), 4)] for g in rail_gaps],
    "bridgeCrownRiseMetres": round(float(crown_rise), 4),
    "rayHitsNormalized": tests,
    "sampledVertexDistancesMetres": distances,
}
(QA / "geometry.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
