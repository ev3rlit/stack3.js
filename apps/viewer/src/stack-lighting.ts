import type { StackData } from '@stack3/core';

const cache = new WeakMap<StackData, { normals: Int8Array; variance: Uint8Array }>();

export function stackLighting(stack: StackData) {
  const existing = cache.get(stack);
  if (existing) return existing;
  const { width, depth, layers, texture, columns, size } = stack;
  const plane = width * depth, count = plane * layers;
  const occupied = new Uint8Array(count);
  const normals = new Int8Array(count * 3);
  const variance = new Uint8Array(count);
  for (let layer = 0; layer < layers; layer++) {
    const left = (layer % columns) * width;
    const top = Math.floor(layer / columns) * depth;
    for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
      occupied[layer * plane + y * width + x] = Number(texture.data[((top + y) * texture.width + left + x) * 4 + 3] >= 128);
    }
  }

  const adjacent = (i: number, stride: number, coordinate: number, length: number) => {
    const before = coordinate > 0 ? occupied[i - stride] : 0;
    const after = coordinate + 1 < length ? occupied[i + stride] : 0;
    const fartherBefore = coordinate > 1 ? occupied[i - stride * 2] : 0;
    const fartherAfter = coordinate + 2 < length ? occupied[i + stride * 2] : 0;
    return 2 * (before - after) + fartherBefore - fartherAfter;
  };
  for (let layer = 0; layer < layers; layer++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const i = layer * plane + y * width + x;
    if (!occupied[i]) continue;
    if (x > 0 && x + 1 < width && y > 0 && y + 1 < depth && layer > 0 && layer + 1 < layers &&
      occupied[i - 1] && occupied[i + 1] && occupied[i - width] && occupied[i + width] &&
      occupied[i - plane] && occupied[i + plane]) continue;
    const nx = adjacent(i, 1, x, width) * width / size[0];
    const ny = adjacent(i, plane, layer, layers) * layers / size[2];
    const nz = -adjacent(i, width, y, depth) * depth / size[1];
    const scale = 127 / (Math.hypot(nx, ny, nz) || 1);
    normals[i * 3] = Math.round(nx * scale);
    normals[i * 3 + 1] = Math.round(ny * scale);
    normals[i * 3 + 2] = Math.round(nz * scale);
  }

  const neighbors = new Int32Array(6);
  for (let layer = 0; layer < layers; layer++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const i = layer * plane + y * width + x, at = i * 3;
    const nx = normals[at], ny = normals[at + 1], nz = normals[at + 2];
    if (!(nx || ny || nz)) continue;
    neighbors[0] = x > 0 ? i - 1 : -1;
    neighbors[1] = x + 1 < width ? i + 1 : -1;
    neighbors[2] = y > 0 ? i - width : -1;
    neighbors[3] = y + 1 < depth ? i + width : -1;
    neighbors[4] = layer > 0 ? i - plane : -1;
    neighbors[5] = layer + 1 < layers ? i + plane : -1;
    let variation = 0, samples = 0;
    for (const neighbor of neighbors) {
      if (neighbor < 0) continue;
      const p = neighbor * 3;
      const dot = (nx * normals[p] + ny * normals[p + 1] + nz * normals[p + 2]) / (127 * 127);
      if (dot < .18) continue;
      variation += Math.max(0, 1 - dot);
      samples++;
    }
    variance[i] = samples ? Math.min(255, Math.round(variation / samples * 680)) : 0;
  }
  const result = { normals, variance };
  cache.set(stack, result);
  return result;
}
