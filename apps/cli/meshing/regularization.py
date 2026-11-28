"""Opt-in, guided surface regularization on a shared indexed mesh."""

import numpy as np
from scipy.optimize import least_squares

from geometry import unit


def in_bounds(points, bounds):
    lo, hi = np.asarray(bounds, dtype=float)
    return np.all((points >= lo) & (points <= hi), axis=-1)


def plane_fit(points, vertex_normals, guide, tolerance):
    hint = unit(np.asarray(guide["normal"], dtype=float))
    ids = np.flatnonzero(in_bounds(points, guide["bounds"]) & (abs(vertex_normals @ hint) >= 0.85))
    if len(ids) < 6:
        return None
    cloud = points[ids]
    center = cloud.mean(axis=0)
    _, values, basis = np.linalg.svd(cloud - center, full_matrices=False)
    normal = basis[-1]
    if normal @ hint < 0:
        normal = -normal
    if values[1] <= values[0] * 1e-8 or np.max(abs((cloud - center) @ normal)) > tolerance:
        return None
    return ids, center, normal


def round_constraints(points, vertex_normals, guide, tolerance):
    center = np.asarray(guide["center"], dtype=float)
    axis = unit(np.asarray(guide["axis"], dtype=float))
    first = unit(np.cross(axis, np.eye(3)[np.argmin(abs(axis))]))
    basis = np.column_stack((first, np.cross(axis, first)))
    relative = points - center
    coords = relative @ basis
    radial_hint = unit(coords) @ basis.T
    selected = abs(np.linalg.norm(coords, axis=1) - guide["radius"]) <= tolerance
    if guide["type"] == "circle":
        selected &= abs(relative @ axis) <= tolerance
    else:
        selected &= in_bounds(points, guide["bounds"]) & (abs(np.sum(vertex_normals * radial_hint, axis=1)) >= 0.75)
    ids = np.flatnonzero(selected)
    if len(ids) < 6:
        return []
    sample = coords[ids]
    system = np.column_stack((2 * sample, np.ones(len(ids))))
    result, _, rank, _ = np.linalg.lstsq(system, np.sum(sample**2, axis=1), rcond=None)
    radius2 = result[-1] + np.dot(result[:-1], result[:-1])
    if rank != 3 or radius2 <= 0:
        return []
    radius = np.sqrt(radius2)
    radial = sample - result[:2]
    distances = np.linalg.norm(radial, axis=1)
    error = radius - distances
    if (np.linalg.norm(result[:2]) > tolerance or abs(radius - guide["radius"]) > tolerance
            or np.any(distances == 0) or np.max(abs(error)) > tolerance):
        return []
    constraints = [(ids, unit(radial) @ basis.T, error)]
    if guide["type"] == "circle":
        heights = relative[ids] @ axis
        constraints.append((ids, np.broadcast_to(axis, (len(ids), 3)), heights.mean() - heights))
    return constraints


def polygon_constraints(points, guide, tolerance):
    corners = np.asarray(guide["corners"], dtype=float)
    center = corners.mean(axis=0)
    _, values, local = np.linalg.svd(corners - center, full_matrices=False)
    normal = local[-1]
    if values[1] <= values[0] * 1e-8 or np.max(abs((corners - center) @ normal)) > tolerance:
        raise ValueError(f'polygon {guide["id"]}: corners must define a plane')
    basis = local[:2].T
    contour = (corners - center) @ basis
    nearby = np.flatnonzero(abs((points - center) @ normal) <= tolerance)
    coords = (points[nearby] - center) @ basis
    lines = []
    for a, b in zip(contour, np.roll(contour, -1, axis=0)):
        direction = b - a
        squared_length = np.dot(direction, direction)
        if not squared_length:
            raise ValueError(f'polygon {guide["id"]}: two consecutive corners coincide')
        t = (coords - a) @ direction / squared_length
        nearest = a + np.clip(t, 0, 1)[:, None] * direction
        within = np.linalg.norm(coords - nearest, axis=1) <= tolerance
        sample = coords[within & (t > 0.08) & (t < 0.92)]
        if len(sample) < 3:
            return []
        side_center = sample.mean(axis=0)
        _, _, vh = np.linalg.svd(sample - side_center, full_matrices=False)
        side_normal = vh[-1]
        if abs(side_normal @ unit(direction)) > 0.34:
            return []
        lines.append((side_normal, side_center @ side_normal, within))
    # Adjacent fitted lines must meet near the supplied corners.
    for i, corner in enumerate(contour):
        previous, current = lines[i - 1], lines[i]
        matrix = np.asarray([previous[0], current[0]])
        if abs(np.linalg.det(matrix)) < 0.05:
            return []
        fit = np.linalg.solve(matrix, [previous[1], current[1]])
        if np.linalg.norm(fit - corner) > 2 * tolerance:
            return []
    result = []
    selected = np.zeros(len(nearby), dtype=bool)
    for normal2, offset, within in lines:
        ids = nearby[within]
        result.append((ids, np.broadcast_to(basis @ normal2, (len(ids), 3)), offset - coords[within] @ normal2))
        selected |= within
    ids = nearby[selected]
    result.append((ids, np.broadcast_to(normal, (len(ids), 3)), -(points[ids] - center) @ normal))
    return result


def optimize_planes(points, planes, relations, tolerance):
    active = [row for row in relations if all(key in planes for key in row["features"])]
    if not active:
        return {key: (normal, 0.) for key, (_, _, normal) in planes.items()}, 0, 0.
    keys = sorted({key for row in active for key in row["features"]})
    clouds = {key: points[planes[key][0]] - planes[key][1] for key in keys}
    scale = max([tolerance] + [np.linalg.norm(np.ptp(p, axis=0)) for p in clouds.values()])

    def parameters(value):
        return {key: (unit(row[:3]), row[3] * tolerance) for key, row in zip(keys, value.reshape(-1, 4))}

    def relation_errors(fits):
        errors = []
        for row in active:
            a, b = row["features"]
            na, da = fits[a]
            nb, db = fits[b]
            if row["type"] == "perpendicular":
                errors.append(np.array([na @ nb]))
                continue
            errors.append(np.cross(na, nb))
            if row["type"] == "coplanar":
                difference = planes[b][1] + nb * db - (planes[a][1] + na * da)
                errors.append(np.array([na @ difference / scale]))
        return np.concatenate(errors)

    def residual(value):
        fits = parameters(value)
        data = [(clouds[k] @ fits[k][0] - fits[k][1]) / (scale * np.sqrt(len(clouds[k]))) for k in keys]
        lengths = np.linalg.norm(value.reshape(-1, 4)[:, :3], axis=1) - 1.
        return np.concatenate([*data, lengths, 10 * relation_errors(fits)])

    start = np.array([np.r_[planes[key][2], 0.] for key in keys]).ravel()
    initial = {key: (normal, 0.) for key, (_, _, normal) in planes.items()}
    result = least_squares(residual, start, max_nfev=100)
    fitted = parameters(result.x)
    if not result.success or any(np.max(abs(clouds[key] @ n - d)) > tolerance for key, (n, d) in fitted.items()):
        return initial, 0, float(np.max(abs(relation_errors(initial))))
    initial.update(fitted)
    return initial, len(active), float(np.max(abs(relation_errors(initial))))


def safe_displacement(points, faces, step):
    # Compare at export precision. Restrict only vertices incident to unsafe faces.
    a, b, c = points.astype(np.float32).astype(float)[faces].transpose(1, 0, 2)
    normals = np.cross(b - a, c - a)
    areas = np.sum(normals**2, axis=1)
    step = step.copy()
    for _ in range(10):
        candidate = points + step
        a, b, c = candidate.astype(np.float32).astype(float)[faces].transpose(1, 0, 2)
        bad = np.sum(np.cross(b - a, c - a) * normals, axis=1) <= 0.1 * areas
        if not bad.any():
            return candidate
        blocked = np.unique(faces[bad])
        step[blocked] = 0.
    return points


def regularize(points, faces, options):
    tolerance = options["tolerance"]
    p, q, r = points[faces].transpose(1, 0, 2)
    normals = np.cross(q - p, r - p)
    vertex_normals = np.zeros_like(points)
    for i in range(3):
        np.add.at(vertex_normals, faces[:, i], normals)
    vertex_normals = unit(vertex_normals)
    planes, constraints, accepted = {}, [], []
    for feature in options["features"]:
        key, kind = feature["id"], feature["type"]
        if kind == "plane":
            fit = plane_fit(points, vertex_normals, feature, tolerance)
            if fit is not None:
                planes[key] = fit
                accepted.append(key)
        else:
            fit = polygon_constraints(points, feature, tolerance) if kind == "polygon" else round_constraints(points, vertex_normals, feature, tolerance)
            if fit:
                constraints.extend(fit)
                accepted.append(key)
    fitted, relations, residual = optimize_planes(points, planes, options["relations"], tolerance)
    for key, (ids, center, _) in planes.items():
        normal, offset = fitted[key]
        constraints.append((ids, np.broadcast_to(normal, (len(ids), 3)), offset - (points[ids] - center) @ normal))
    system = np.zeros((len(points), 3, 3))
    rhs = np.zeros_like(points)
    for ids, directions, error in constraints:
        system[ids] += directions[:, :, None] * directions[:, None, :]
        rhs[ids] += directions * error[:, None]
    active = np.flatnonzero(np.any(rhs != 0, axis=1))
    displacement = np.zeros_like(points)
    if len(active):
        displacement[active] = (np.linalg.pinv(system[active], rcond=0.05) @ rhs[active, :, None])[:, :, 0]
    displacement[np.linalg.norm(displacement, axis=1) > 2 * tolerance] = 0.
    result = safe_displacement(points, faces, displacement)
    rejected = [feature["id"] for feature in options["features"] if feature["id"] not in accepted]
    moved = int(np.count_nonzero(np.any(points.astype(np.float32) != result.astype(np.float32), axis=1)))
    print(f"regularization: fitted {accepted}; skipped {rejected}; optimized {relations}/{len(options['relations'])} plane relations; relation residual {residual:.4g}; moved {moved} vertices")
    return result
