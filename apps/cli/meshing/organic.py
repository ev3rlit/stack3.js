"""Contour the zero set of a smoothed distance field in registered stack coordinates."""

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates, spline_filter
from scipy.spatial import cKDTree

from dexel import read_registered_dexel
from field_data import load_field
from finishing import topology
from geometry import unit
from implicit import feature_mesh, iso


def occupancy_distances(occupied, step):
    return distance_transform_edt(~occupied, sampling=step) - distance_transform_edt(occupied, sampling=step)


def crossing_distances(occupied, step, crossings, *, use_normals=False):
    if not crossings:
        raise ValueError("triple-dexel contains no resolved crossings")
    points = np.array([point for point, _ in crossings.values()]) * step
    normals = np.array([normal for _, normal in crossings.values()]) if use_normals else None
    tree = cKDTree(points)
    field = np.empty(occupied.shape)
    # Distance to the sampled boundary, signed using the registered occupancy.
    # Work in slabs so the query points do not replicate the entire XYZ grid.
    yz = np.indices(occupied.shape[1:]).reshape(2, -1).T
    for x, slab in enumerate(field):
        queries = np.column_stack((np.full(len(yz), x), yz)) * step
        distances = tree.query(queries)[0]
        if use_normals:
            # Distance to a finite point set overestimates the gap to a smooth
            # patch between hits. Locally fit the signed offset to tangent planes.
            near = distances < 2 * np.linalg.norm(step)
            if near.any():
                k = np.arange(1, min(6, len(points)) + 1)
                gaps, idx = tree.query(queries[near], k=k)
                deltas = queries[near, None, :] - points[idx]
                planes = np.einsum("ijk,ijk->ij", deltas, normals[idx])
                weights = 1 / np.maximum(gaps, 0.05 * min(step))**2
                offsets = np.sum(weights * planes, axis=1) / weights.sum(axis=1)
                magnitudes = offsets * np.where(occupied[x].ravel()[near], -1, 1)
                distances[near] = np.where(magnitudes > 0, np.minimum(magnitudes, distances[near]), distances[near])
        slab[:] = distances.reshape(slab.shape)
    np.maximum(field, np.finfo(float).eps * min(step), out=field)
    field[occupied] *= -1
    return field


def depth_weights(shape, step, origin, regions):
    if not isinstance(regions, list) or not regions:
        raise ValueError("depthRegions requires a nonempty list of {center, radii} in stack XYZ scene units")
    axes = np.ogrid[tuple(slice(0, n) for n in shape)]
    weights = np.zeros(shape)
    for region in regions:
        if not isinstance(region, dict) or set(region) != {"center", "radii"}:
            raise ValueError("each depth region needs center and radii")
        center, radii = (np.asarray(region[key], dtype=float) for key in ("center", "radii"))
        if center.shape != (3,) or radii.shape != (3,) or not np.isfinite([center, radii]).all() or min(radii) <= 0:
            raise ValueError("depth region center and positive radii must be finite XYZ triples")
        radial = np.sqrt(sum(((origin[i] + (axes[i] - .5)*step[i] - center[i])/radii[i])**2 for i in range(3)))
        # Full measured support through 70% of the radius, C1 taper to the prior.
        t = np.clip((1-radial)/.3, 0, 1)
        weights = np.maximum(weights, t*t*(3-2*t))
    return weights


def input_field(mask, step, origin, guide, directory):
    occupied = np.pad(mask, 1)
    use_depth = guide.get("dexelOccupancy", "stack")
    regions = guide.get("depthRegions")
    if use_depth not in ("stack", "measured") or ("dexelOccupancy" in guide and "dexel" not in guide):
        raise ValueError("dexelOccupancy must be stack or measured with a registered dexel")
    if "depthRegions" in guide and (use_depth != "measured" or not isinstance(regions, list) or not regions):
        raise ValueError("depthRegions requires measured dexel occupancy and a nonempty list")
    if "field" in guide and "dexel" in guide and regions is None:
        raise ValueError("choose either field or dexel, or specify measured depthRegions for fusion")
    if "dexel" not in guide:
        field = load_field(occupied, guide["field"], directory) if "field" in guide else occupancy_distances(occupied, step)
        return field, {}
    measured_mask, hits = read_registered_dexel(mask, step, origin, guide["dexel"], directory,
                                                measured_occupancy=use_depth == "measured")
    field = crossing_distances(np.pad(measured_mask, 1), step, hits, use_normals=use_depth == "measured")
    if use_depth == "stack":
        return field, {}
    if regions is None:
        return field, hits
    weights = depth_weights(occupied.shape, step, origin, regions)
    prior = load_field(occupied, guide["field"], directory) if "field" in guide else occupancy_distances(occupied, step)
    # Only complete measured edges may override a blended zero crossing.
    locked = {}
    for key, hit in hits.items():
        point = key[:3]
        nxt = list(point)
        nxt[key[3]] += 1
        if weights[point] == 1 and weights[tuple(nxt)] == 1:
            locked[key] = hit
    print(f"triple-dexel: {len(locked)} measured Hermite edges fully inside depth regions")
    return prior*(1-weights) + field*weights, locked


def cubic_crossings(field, step):
    """Bracket roots on crossing edges of the same spline used to sample normals."""
    coeff = spline_filter(field, order=3, mode="mirror")

    def sample(points):
        return map_coordinates(coeff, points.T, order=3, mode="mirror", prefilter=False)

    crossings = {}
    inside = field < 0
    for axis in range(3):
        starts = np.argwhere(np.diff(inside, axis=axis))
        if not len(starts):
            continue
        negative = inside[tuple(starts.T)]
        lower, upper = np.zeros(len(starts)), np.ones(len(starts))
        along = np.eye(3)[axis]
        for _ in range(16):
            mid = (lower + upper) * 0.5
            same_side = (sample(starts + mid[:, None] * along) < 0) == negative
            lower = np.where(same_side, mid, lower)
            upper = np.where(same_side, upper, mid)
        roots = starts + ((lower + upper) * 0.5)[:, None] * along
        gradients = [(sample(roots + delta) - sample(roots - delta)) / (0.02 * pitch)
                     for delta, pitch in zip(0.01 * np.eye(3), step)]
        normals = unit(np.stack(gradients, axis=1))
        for key, root, normal in zip(starts, roots, normals):
            crossings[(*key, axis)] = (root, normal)
    return crossings


def marching_field(field, measured):
    # Positive occupancy for the common outward triangle winding.
    vertices, faces = iso(-field, 0)
    if measured is not None:
        for i, vertex in enumerate(vertices):
            near = np.rint(vertex).astype(int)
            fractional = np.flatnonzero(abs(vertex - near) > 1e-6)
            if len(fractional) != 1:
                continue  # MC33 can insert interior vertices in ambiguous cells.
            axis = fractional[0]
            near[axis] = int(np.floor(vertex[axis]))
            hit = measured.get((*near, axis))
            if hit is not None:
                vertices[i] = hit[0]
    return vertices - 0.5, faces


def project_to_field(world, faces, field, step, cubic):
    # World here is relative to the stack's lower corner. Padded samples are
    # centered at (i - 0.5)*pitch. Use the same interpolant for values and gradients.
    coefficients = spline_filter(field, order=3, mode="mirror") if cubic else field
    order = 3 if cubic else 1

    def evaluate(coords):
        return map_coordinates(coefficients, coords.T, order=order, mode="mirror", prefilter=False)

    for _ in range(5):
        coords = world / step + 0.5
        values = evaluate(coords)
        gradients = np.column_stack([
            (evaluate(coords + axis) - evaluate(coords - axis)) / (0.02 * pitch)
            for axis, pitch in zip(0.01 * np.eye(3), step)
        ])
        delta = -gradients * (values / np.maximum(np.sum(gradients**2, axis=1), 1e-16))[:, None]
        delta *= np.minimum(1, 0.5 * min(step) / np.maximum(np.linalg.norm(delta, axis=1), 1e-16))[:, None]
        a, b, c = world[faces].transpose(1, 0, 2)
        old_normals = np.cross(b - a, c - a)
        for strength in (1, 0.5, 0.25, 0.125):
            candidate = world + strength * delta
            a, b, c = candidate[faces].transpose(1, 0, 2)
            if np.all(np.sum(old_normals * np.cross(b - a, c - a), axis=1) > 0):
                world = candidate
                break
        else:
            break
    return world


def organic_mesh(mask, step, origin, guide, directory):
    sigma = guide.get("sigma", 0.8)
    extractor = guide.get("extractor", "hermite-dc")
    interp = guide.get("interpolation", "linear")
    iterations = guide.get("smoothingIterations", 0)
    length = guide.get("targetEdgeLength")
    if type(sigma) not in (int, float) or not 0 <= sigma <= 8:
        raise ValueError("sigma must be a number from 0 to 8 in units of the smallest voxel pitch")
    if extractor not in ("surface-nets", "hermite-dc", "regularized-dc", "marching-cubes") or interp not in ("linear", "cubic"):
        raise ValueError("use surface-nets, hermite-dc, regularized-dc or marching-cubes with linear or cubic interpolation")
    if type(iterations) is not int or not 0 <= iterations <= 100:
        raise ValueError("smoothingIterations must be an integer from 0 to 100")
    if "targetEdgeLength" in guide and (type(length) not in (int, float) or not np.isfinite(length) or length <= 0):
        raise ValueError("targetEdgeLength must be a positive length in scene units")

    for option in ("adaptive", "reproject"):
        if option in guide and type(guide[option]) is not bool:
            raise ValueError(f"{option} must be boolean")
    if "adaptive" in guide and length is None:
        raise ValueError("adaptive requires targetEdgeLength")

    field, locked = input_field(mask, step, origin, guide, directory)
    field = gaussian_filter(field, sigma * step.min() / step, mode="nearest")
    inside = field < 0
    if not inside.any():
        raise ValueError("organic smoothing removed all occupied samples; reduce sigma")
    if any(inside.take([0, -1], axis=axis).any() for axis in range(3)):
        raise ValueError("organic zero set exceeds the padded grid; reduce sigma or add empty input margins")
    measured = cubic_crossings(field, step) if interp == "cubic" else None
    if locked and sigma == 0:
        if measured is None:
            # A sparse override lets linear interpolation handle transition edges.
            measured = {}
        measured.update(locked)
    if extractor == "marching-cubes":
        vertices, faces = marching_field(field, measured)
    else:
        vertices, faces = feature_mesh(inside[1:-1, 1:-1, 1:-1], step, True, field, measured,
                                       surface_nets=extractor == "surface-nets", regularized=extractor == "regularized-dc")
    world = vertices * step
    signature = topology(world, faces)
    if iterations or length is not None:
        try:
            import pymeshlab as ml
        except ImportError as exc:
            raise ValueError("organic mesh postprocessing requires pymeshlab==2025.7 in STACK3_PYTHON or uv") from exc
        meshes = ml.MeshSet()
        meshes.add_mesh(ml.Mesh(vertex_matrix=world, face_matrix=faces.astype(np.int32)))
        if iterations:
            meshes.apply_coord_taubin_smoothing(stepsmoothnum=iterations)
        if length is not None:
            meshes.meshing_isotropic_explicit_remeshing(adaptive=guide.get("adaptive", True), targetlen=ml.PureValue(length))
        mesh = meshes.current_mesh()
        world, faces = mesh.vertex_matrix(), mesh.face_matrix()
        if topology(world, faces) != signature:
            raise ValueError("organic mesh postprocessing changed the component count or Euler characteristic")
    if guide.get("reproject", False):
        world = project_to_field(world, faces, field, step, interp == "cubic")
        topology(world, faces)
    print(f"organic: {extractor}, {interp}, sigma {sigma}, Taubin iterations {iterations}, "
          f"target edge length {length}, {len(faces)} triangles")
    return world / step, faces
