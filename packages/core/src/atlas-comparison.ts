import type { MeshData } from './reconstruct';
import type { Direction, Raster, ViewSet } from './views';

type Point = [number, number, number];
type Axis = 0 | 1 | 2;
type DepthMap = { axis: Axis; axes: [Axis, Axis]; width: number; height: number; values: Int32Array };
const depthAxes: Record<Direction, [Axis, boolean]> = {
  top: [2, true], bottom: [2, false], left: [0, false], right: [0, true], front: [1, true], rear: [1, false],
};
const axes: Axis[] = [0, 1, 2];

// Identify the saturated accents of painted assets. Keep gray shading and linework in the original RGB.
function accent(data: Uint8Array, offset: number) {
  const r = data[offset], g = data[offset + 1], b = data[offset + 2];
  if (data[offset + 3] < 128) return 0;
  if (r > 145 && r - b > 70 && g - b > 20 && r - g > 22) return 1;
  if (g > 95 && b > 105 && Math.min(g, b) - r > 46 && b - g > -20) return 2;
  return 0;
}

export function inferAccentViews(views: ViewSet) {
  const clean: ViewSet = {};
  const masks: Partial<Record<Direction, Uint8Array>> = {};
  const owner = new Map<number, Direction>();
  const bestArea = new Map<number, number>();
  for (const [direction, image] of Object.entries(views) as [Direction, Raster][]) {
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);
    const distance = new Int32Array(mask.length).fill(-1);
    const queue = new Int32Array(mask.length);
    const output = new Uint8Array(data);
    const area = [0, 0, 0];
    for (let i = 0; i < mask.length; i++) {
      const id = mask[i] = accent(data, i * 4);
      if (id) area[id]++;
    }
    const seeds = mask.slice();
    for (let i = 0; i < seeds.length; i++) {
      const id = seeds[i];
      if (!id) continue;
      const x = i % width, y = Math.floor(i / width);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9 || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const j = i + dy * width + dx, p = j * 4;
        if (mask[j] || data[p + 3] < 128) continue;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        if (id === 1 ? r - b > 12 && g - b > 5 && r >= g - 8 : Math.min(g, b) - r > 12) mask[j] = id;
      }
    }
    let end = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] || data[i * 4 + 3] < 128) continue;
      distance[i] = 0;
      queue[end++] = i;
    }
    function extend(from: number, to: number) {
      if (!mask[to] || distance[to] >= 0) return;
      distance[to] = distance[from] + 1;
      output.set(output.subarray(from * 4, from * 4 + 3), to * 4);
      queue[end++] = to;
    }
    for (let start = 0; start < end; start++) {
      const i = queue[start], x = i % width;
      if (x > 0) extend(i, i - 1);
      if (x + 1 < width) extend(i, i + 1);
      if (i >= width) extend(i, i - width);
      if (i + width < mask.length) extend(i, i + width);
    }
    for (const id of [1, 2]) {
      const score = area[id] / (width * height) * (direction === 'front' ? 1.35 : 1);
      if (score <= (bestArea.get(id) ?? 0)) continue;
      bestArea.set(id, score);
      owner.set(id, direction);
    }
    masks[direction] = mask;
    clean[direction] = { width, height, data: output };
  }
  return { clean, masks, owner };
}

export function inferSurfaceDepth(volume: Uint8Array, size: Point, directions: readonly Direction[]) {
  const maps: Partial<Record<Direction, DepthMap>> = {};
  for (const direction of directions) {
    const [axis, high] = depthAxes[direction];
    const plane = axes.filter(item => item !== axis) as [Axis, Axis];
    const width = size[plane[0]], height = size[plane[1]];
    const values = new Int32Array(width * height).fill(-1);
    const p: Point = [0, 0, 0];
    for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
      p[plane[0]] = u;
      p[plane[1]] = v;
      for (let step = 0; step < size[axis]; step++) {
        p[axis] = high ? size[axis] - 1 - step : step;
        if (!volume[(p[2] * size[1] + p[1]) * size[0] + p[0]]) continue;
        values[v * width + u] = p[axis] + Number(high);
        break;
      }
    }
    maps[direction] = { axis, axes: plane, width, height, values };
  }

  function at(map: DepthMap, point: Point): [number, number] {
    return [Math.max(0, Math.min(map.width - 1, Math.floor(point[map.axes[0]]))),
      Math.max(0, Math.min(map.height - 1, Math.floor(point[map.axes[1]])))];
  }
  function firstHit(direction: Direction, point: Point) {
    const map = maps[direction];
    if (!map) return -1;
    const [u, v] = at(map, point);
    return map.values[v * map.width + u];
  }
  function visible(direction: Direction, point: Point, tolerance = 1.5) {
    const depth = firstHit(direction, point);
    return depth >= 0 && Math.abs(depth - point[depthAxes[direction][0]]) <= tolerance;
  }
  return { visible, firstHit };
}


// Small amber fixtures use a separate front-facing surface so a camera directly above
// cannot see the lens. Slice the decal by row to follow the estimated front depth.
export function frontAccentDecals(image: Raster, mask: Uint8Array, cells: Point, size: Point, pivot: Point,
  firstHit: ReturnType<typeof inferSurfaceDepth>['firstHit']) {
  const { width, height, data } = image;
  const marked = new Uint8Array(mask.length);
  const visited = new Uint8Array(mask.length);
  const deck = new Uint8Array(data.length);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || visited[start]) continue;
    const pixels = [start];
    const rows = new Map<number, [number, number]>();
    let minX = width, maxX = 0, minY = height, maxY = 0;
    visited[start] = 1;
    for (const index of pixels) {
      const x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const row = rows.get(y) ?? [x, x];
      rows.set(y, [Math.min(row[0], x), Math.max(row[1], x)]);
      for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, index - width, index + width]) {
        if (mask[next] !== 1 || visited[next]) continue;
        visited[next] = 1;
        pixels.push(next);
      }
    }
    if (pixels.length < 5 || maxX - minX > width / 4 || maxY - minY > height / 4) continue;
    const fronts = new Map<number, number>();
    for (const [y, [from, to]] of rows) {
      let near = -1;
      for (let x = from; x <= to; x++) {
        const point: Point = [(x + .5) / width * cells[0], 0, (1 - (y + .5) / height) * cells[2]];
        near = Math.max(near, firstHit('front', point));
      }
      if (near >= 0) fronts.set(y, near);
    }
    if (fronts.size < 2) continue;
    for (const index of pixels) {
      if (!fronts.has(Math.floor(index / width))) continue;
      marked[index] = 1;
      deck.set(data.subarray(index * 4, index * 4 + 4), index * 4);
    }
    for (const [y, near] of fronts) {
      const [from, to] = rows.get(y)!;
      const u0 = from / width, u1 = (to + 1) / width;
      const v0 = y / height, v1 = (y + 1) / height;
      const x0 = (u0 - .5) * size[0], x1 = (u1 - .5) * size[0];
      const y0 = (1 - v0) * size[2] - pivot[2], y1 = (1 - v1) * size[2] - pivot[2];
      const z = (.5 - (near + .65) / cells[1]) * size[1];
      const base = positions.length / 3;
      positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
      normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    }
  }
  const mesh: MeshData | undefined = indices.length ? {
    target: 'mesh', size, pivot, texture: { width, height, data: deck },
    positions: Float32Array.from(positions), normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs),
  } : undefined;
  return { mesh, marked };
}
