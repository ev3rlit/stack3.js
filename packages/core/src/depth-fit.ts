import { depthDistance, type DepthRaster } from './depth-png';
import type { AtlasCalibration } from './mapped-atlas';

type Surface = { positions: Float32Array; indices: ArrayLike<number> };
type Camera = AtlasCalibration['views'][keyof AtlasCalibration['views']];

function projectDepth(surface: Surface, camera: Camera, ppu: number) {
  const [left, top, width, height] = camera.rect;
  const points = new Float32Array(surface.positions.length);
  const array = surface.positions;
  const dot = (i: number, axis: number[]) => array[i] * axis[0] + array[i + 1] * axis[1] + array[i + 2] * axis[2];
  const origin = camera.origin.reduce((sum, value, axis) => sum + value * camera.forward[axis], 0);
  for (let i = 0; i < array.length; i += 3) {
    points[i] = camera.anchor[0] - left + dot(i, camera.right) * ppu;
    points[i + 1] = camera.anchor[1] - top - dot(i, camera.up) * ppu;
    points[i + 2] = dot(i, camera.forward) - origin;
  }

  const buffer = new Float32Array(width * height).fill(Infinity);
  const indices = surface.indices;
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3;
    const ax = points[a], ay = points[a + 1], bx = points[b], by = points[b + 1], cx = points[c], cy = points[c + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-8) continue;
    const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - .5));
    const maxX = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - .5));
    const minY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - .5));
    const maxY = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - .5));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + .5, py = y + .5;
      const u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-6) continue;
      const depth = u * points[a + 2] + v * points[b + 2] + w * points[c + 2];
      const pixel = y * width + x;
      if (depth >= camera.near && depth <= camera.far && depth < buffer[pixel]) buffer[pixel] = depth;
    }
  }
  return buffer;
}

export function measureDepthFit(initial: Surface, carved: Surface, reference: DepthRaster, calibration: AtlasCalibration) {
  let referencePixels = 0, sharedPixels = 0;
  let baselineSum = 0, carvedSum = 0;
  const byView = Object.entries(calibration.views).map(([view, camera]) => {
    const first = projectDepth(initial, camera, calibration.pixelsPerUnit);
    const second = projectDepth(carved, camera, calibration.pixelsPerUnit);
    const [left, top, width, height] = camera.rect;
    let seen = 0, shared = 0, baselineError = 0, carvedError = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = reference.data[(y + top) * reference.width + x + left];
      if (!value) continue;
      seen++;
      const i = y * width + x;
      // Score both meshes on the same rays so a missed region cannot lower only one error.
      if (!Number.isFinite(first[i]) || !Number.isFinite(second[i])) continue;
      const expected = depthDistance(value, camera.near, camera.far);
      baselineError += Math.abs(first[i] - expected);
      carvedError += Math.abs(second[i] - expected);
      shared++;
    }
    baselineSum += baselineError;
    carvedSum += carvedError;
    referencePixels += seen;
    sharedPixels += shared;
    return { view, sharedPixels: shared, referencePixels: seen,
      baselineMae: shared ? baselineError / shared : null, carvedMae: shared ? carvedError / shared : null };
  });
  return { referencePixels, sharedPixels, byView,
    baselineMae: sharedPixels ? baselineSum / sharedPixels : null,
    carvedMae: sharedPixels ? carvedSum / sharedPixels : null };
}
