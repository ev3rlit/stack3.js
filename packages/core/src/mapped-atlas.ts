import { DEFAULT_LAYERS, samplingGrid } from './sampling';
import { depthDistance, type DepthRaster } from './depth-png';
import { measureDepthFit } from './depth-fit';
import type { MeshData, Settings } from './reconstruct';
import { extractSurface } from './surface';
import type { Raster } from './views';

type Vec3 = [number, number, number];
type Camera = {
  rect: [number, number, number, number];
  anchor: [number, number];
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  near: number;
  far: number;
};
const layout = ['top', 'left', 'front', 'rear'] as const;
export type AtlasCalibration = {
  dimensions: [number, number];
  size: Vec3;
  pixelsPerUnit: number;
  views: Record<typeof layout[number], Camera>;
};
export type MappedAtlas = {
  calibration: AtlasCalibration;
  depth: DepthRaster;
  clay: Raster;
  baseColor: Raster;
  normal: Raster;
};
const dot = (x: number, y: number, z: number, vector: Vec3) => x * vector[0] + y * vector[1] + z * vector[2];
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(127.5 * (1 + value))));

export function reconstructMappedAtlas({ calibration, depth, clay, baseColor, normal }: MappedAtlas, settings: Settings = {}) {
  const { size, pixelsPerUnit: ppu, views } = calibration;
  const [aw, ah] = calibration.dimensions;
  if (![depth, clay, baseColor, normal].every(image => image.width === aw && image.height === ah) ||
      !size.every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(ppu) || ppu <= 0) {
    throw new Error('Material passes must match the calibrated atlas dimensions.');
  }
  const [w, d, h] = size;
  const { width: columns, depth: rows, layers } = samplingGrid(w, d, settings.resolution ?? 144, settings.layers ?? DEFAULT_LAYERS);
  const tolerance = Math.max(w / columns, d / rows, h / layers) * .75 + 1 / ppu;
  const pivot: Vec3 = [0, 0, settings.pivot === 'center' ? h / 2 : 0];
  const cameras = layout.map(direction => views[direction]);
  const origins = cameras.map(camera => dot(...camera.origin, camera.forward));
  const mirroredLeft = cameras.length;
  const projectors = [...cameras, views.left];
  const textureWidth = aw + views.left.rect[2] + 1;
  const colorPixels = new Uint8Array(textureWidth * ah * 4);
  const normalPixels = new Uint8Array(colorPixels.length);
  for (let offset = 0; offset < colorPixels.length; offset += 4) {
    colorPixels.set([146, 149, 154, 255], offset);
  }

  function sample(camera: Camera, x: number, y: number, z: number) {
    const px = camera.anchor[0] + dot(x, y, z, camera.right) * ppu;
    const py = camera.anchor[1] - dot(x, y, z, camera.up) * ppu;
    const [left, top, width, height] = camera.rect;
    if (px < left || px >= left + width || py < top || py >= top + height) return -1;
    return Math.floor(py) * aw + Math.floor(px);
  }
  function distance(camera: Camera, index: number) {
    return depthDistance(depth.data[index], camera.near, camera.far);
  }

  function paint(camera: Camera, mirrored: boolean) {
    const [left, top, width, height] = camera.rect;
    for (let py = top; py < top + height; py++) for (let px = left; px < left + width; px++) {
      const p = (py * aw + px) * 4;
      if (baseColor.data[p + 3] < 128) continue;
      const q = (py * textureWidth + (mirrored ? aw + px - left : px)) * 4;
      colorPixels.set(baseColor.data.subarray(p, p + 4), q);
      if (normal.data[p + 3] < 128) continue;
      const a = normal.data[p] / 127.5 - 1, b = normal.data[p + 1] / 127.5 - 1, c = normal.data[p + 2] / 127.5 - 1;
      const world = camera.right.map((axis, i) => a * axis + b * camera.up[i] - c * camera.forward[i]);
      const length = Math.hypot(...world) || 1;
      normalPixels.set([byte(world[0] * (mirrored ? -1 : 1) / length), byte(world[1] / length), byte(world[2] / length), 255], q);
    }
  }
  for (const camera of cameras) paint(camera, false);
  paint(views.left, true);

  const volume = new Uint8Array(columns * rows * layers);
  const silhouette = new Uint8Array(volume.length);
  for (let k = 0; k < layers; k++) for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = ((i + .5) / columns - .5) * w;
    const y = (k + .5) / layers * h;
    const z = (.5 - (j + .5) / rows) * d;
    let inside = true, passDepth = true;
    for (const [index, camera] of cameras.entries()) {
      const pixel = sample(camera, x, y, z);
      if (pixel < 0 || clay.data[pixel * 4 + 3] < 128) {
        inside = false;
        break;
      }
      const ray = dot(x, y, z, camera.forward) - origins[index];
      if (!depth.data[pixel] || ray + tolerance < distance(camera, pixel)) passDepth = false;
    }
    if (inside) {
      const voxel = (k * rows + j) * columns + i;
      silhouette[voxel] = 1;
      if (passDepth) volume[voxel] = 1;
    }
  }

  function worldSurface(field: Uint8Array) {
    const surface = extractSurface(field, columns, rows, layers);
    if (!surface.indices.length) throw new Error('The calibrated views have no common surface.');
    const positions = new Float32Array(surface.positions.length);
    const normals = new Float32Array(surface.positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      positions.set([(surface.positions[i] / columns - .5) * w, surface.positions[i + 2] / layers * h,
        (.5 - surface.positions[i + 1] / rows) * d], i);
      const x = surface.gradients[i] * columns / w, y = surface.gradients[i + 2] * layers / h;
      const z = -surface.gradients[i + 1] * rows / d;
      const length = Math.hypot(x, y, z) || 1;
      normals.set([x / length, y / length, z / length], i);
    }
    return { positions, normals, indices: surface.indices };
  }
  const baseline = worldSurface(silhouette);
  const surface = worldSurface(volume);
  const fit = measureDepthFit(baseline, surface, depth, calibration);
  const { positions: world, normals: shading } = surface;
  const vertices = new Map<number, number>();
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let p = 0; p < surface.indices.length; p += 3) {
    const corners = surface.indices.slice(p, p + 3);
    const mean = (field: Float32Array, axis: number) => (field[corners[0] * 3 + axis] +
      field[corners[1] * 3 + axis] + field[corners[2] * 3 + axis]) / 3;
    const x = mean(world, 0), y = mean(world, 1), z = mean(world, 2);
    const sx = mean(shading, 0), sy = mean(shading, 1), sz = mean(shading, 2);
    let best = -1, score = 0;
    for (const [index, camera] of projectors.entries()) {
      const mirror = index === mirroredLeft ? -1 : 1;
      const facing = -dot(sx * mirror, sy, sz, camera.forward);
      if (facing <= .04) continue;
      const pixel = sample(camera, x * mirror, y, z);
      if (pixel < 0 || !depth.data[pixel]) continue;
      const measured = distance(camera, pixel);
      const candidate = dot(x * mirror, y, z, camera.forward) - origins[mirror === -1 ? 1 : index];
      const difference = Math.abs(candidate - measured) / tolerance;
      if (difference > 3.5) continue;
      const weight = facing / (1 + difference * difference);
      if (weight > score) { best = index; score = weight; }
    }
    for (const corner of corners) {
      const key = corner * (projectors.length + 1) + best + 1;
      let index = vertices.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        vertices.set(key, index);
        const i = corner * 3;
        const cx = world[i], cy = world[i + 1], cz = world[i + 2];
        positions.push(cx, cy - pivot[2], cz);
        normals.push(shading[i], shading[i + 1], shading[i + 2]);
        const camera = projectors[best];
        if (!camera) {
          uvs.push((textureWidth - .5) / textureWidth, .5 / ah);
        } else {
          const mirrored = best === mirroredLeft;
          const px = camera.anchor[0] + ppu * dot(mirrored ? -cx : cx, cy, cz, camera.right);
          const py = camera.anchor[1] - ppu * dot(mirrored ? -cx : cx, cy, cz, camera.up);
          uvs.push((px + (mirrored ? aw - camera.rect[0] : 0)) / textureWidth, py / ah);
        }
      }
      indices.push(index);
    }
  }

  const mesh: MeshData = {
    target:'mesh', size, pivot, positions:Float32Array.from(positions), normals:Float32Array.from(normals),
    uvs:Float32Array.from(uvs), indices:Uint32Array.from(indices), texture:{ width:textureWidth, height:ah, data:colorPixels },
  };
  const silhouetteMesh: MeshData = {
    target: 'mesh', size, pivot,
    positions: baseline.positions.map((value, index) => index % 3 === 1 ? value - pivot[2] : value),
    normals: baseline.normals, indices: Uint32Array.from(baseline.indices),
    uvs: new Float32Array(baseline.positions.length / 3 * 2),
    texture: { width: 1, height: 1, data: Uint8Array.of(255, 255, 255, 255) },
  };
  return { mesh, silhouetteMesh, fit, normalMap: { width:textureWidth, height:ah, data:normalPixels },
    grid: [columns, rows, layers] as Vec3 };
}
