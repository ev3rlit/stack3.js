import { MC_TRIANGLES } from './marching-table';

const CORNERS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]] as const;
const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;

function regularizeDepth(occupancy: Uint8Array, shape: [number, number, number], pitch: number[]) {
  const extent = Math.min(pitch[2] * (shape[2] - 2) * .042, Math.max(pitch[0], pitch[1]) * 1.65);
  const strides = [1, shape[0], shape[0] * shape[1]];
  let current = Float32Array.from(occupancy);
  let output = new Float32Array(current.length);
  for (let axis = 0; axis < shape.length; axis++) {
    const sigma = Math.max(.6, Math.min(5, extent / pitch[axis]));
    const radius = Math.ceil(sigma * 2.5);
    const weights = Array.from({ length: radius + 1 }, (_, d) => Math.exp(-d * d / (2 * sigma * sigma)));
    const total = weights[0] + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0);
    const step = strides[axis], length = shape[axis], block = step * length;
    for (let base = 0; base < current.length; base += block) for (let offset = 0; offset < step; offset++) {
      for (let i = 0; i < length; i++) {
        const index = base + offset + i * step;
        let value = weights[0] * current[index];
        for (let d = 1; d <= radius; d++) {
          if (i >= d) value += weights[d] * current[index - d * step];
          if (i + d < length) value += weights[d] * current[index + d * step];
        }
        output[index] = value / total;
      }
    }
    [current, output] = [output, current];
  }
  return current;
}

function paddedOccupancy(volume: Uint8Array, width: number, depth: number, layers: number) {
  const nx = width + 2, ny = depth + 2, nz = layers + 2;
  const plane = nx * ny, count = plane * nz;
  const occupancy = new Uint8Array(count);
  for (let z = 0; z < layers; z++) for (let y = 0; y < depth; y++) {
    const start = (z * depth + y) * width;
    occupancy.set(volume.subarray(start, start + width), (z + 1) * plane + (y + 1) * nx + 1);
  }
  return { nx, ny, nz, plane, count, occupancy };
}

export function extractSurface(volume: Uint8Array, width: number, depth: number, layers: number,
  worldSize?: [number, number, number]) {
  const { nx, ny, nz, plane, count, occupancy } = paddedOccupancy(volume, width, depth, layers);
  const field = worldSize
    ? regularizeDepth(occupancy, [nx, ny, nz], [worldSize[0] / width, worldSize[1] / depth, worldSize[2] / layers])
    : new Float32Array(count);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const index = z * plane + y * nx + x;
    const neighbors = (x > 0 ? occupancy[index - 1] : 0) + (x + 1 < nx ? occupancy[index + 1] : 0) +
      (y > 0 ? occupancy[index - nx] : 0) + (y + 1 < ny ? occupancy[index + nx] : 0) +
      (z > 0 ? occupancy[index - plane] : 0) + (z + 1 < nz ? occupancy[index + plane] : 0);
    const silhouetteField = occupancy[index] * .64 + neighbors * .06;
    field[index] = worldSize ? field[index] * .92 + silhouetteField * .08 : silhouetteField;
  }
  const corners = [0, 1, nx + 1, nx, plane, plane + 1, plane + nx + 1, plane + nx];
  const cached = new Int32Array(count * 3).fill(-1);
  const positions: number[] = [], gradients: number[] = [], indices: number[] = [];
  function derivative(index: number, stride: number) {
    return (field[index - stride] ?? 0) - (field[index + stride] ?? 0);
  }
  function vertex(x: number, y: number, z: number, cell: number, edge: number) {
    const [a, b] = EDGES[edge];
    const A = CORNERS[a], B = CORNERS[b];
    const ca = cell + corners[a], cb = cell + corners[b];
    const axis = A[0] !== B[0] ? 0 : A[1] !== B[1] ? 1 : 2;
    const key = Math.min(ca, cb) * 3 + axis;
    if (cached[key] >= 0) return cached[key];
    const id = positions.length / 3;
    const t = (.5 - field[ca]) / (field[cb] - field[ca]);
    positions.push(x - .5 + A[0] + (B[0] - A[0]) * t,
      y - .5 + A[1] + (B[1] - A[1]) * t, z - .5 + A[2] + (B[2] - A[2]) * t);
    gradients.push(...[1, nx, plane].map(stride => derivative(ca, stride) * (1 - t) + derivative(cb, stride) * t));
    cached[key] = id;
    return id;
  }
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const cell = z * plane + y * nx + x;
    let configuration = 0;
    for (let i = 0; i < 8; i++) if (field[cell + corners[i]] < .5) configuration |= 1 << i;
    if (configuration === 0 || configuration === 255) continue;
    for (let row = configuration * 16; MC_TRIANGLES[row] >= 0; row++) {
      indices.push(vertex(x, y, z, cell, MC_TRIANGLES[row]));
    }
  }
  return { positions, gradients, indices };
}

/** Expose the occupied cells directly, without interpolating the grid boundary. */
export function extractVoxelSurface(volume: Uint8Array, width: number, depth: number, layers: number) {
  const dimensions = [width, depth, layers];
  const strides = [1, width, width * depth];
  const positions: number[] = [], gradients: number[] = [], indices: number[] = [];
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;

  for (let z = 0; z < layers; z++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const index = (z * depth + y) * width + x;
    if (!volume[index]) continue;
    const cell = [x, y, z];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const sign of [-1, 1]) {
        const neighbor = cell[axis] + sign;
        if (neighbor >= 0 && neighbor < dimensions[axis] && volume[index + sign * strides[axis]]) continue;
        const normal = [0, 0, 0];
        normal[axis] = sign;
        const base = positions.length / 3;
        for (const [du, dv] of corners) {
          const vertex = [...cell];
          vertex[axis] += Number(sign > 0);
          vertex[u] += du;
          vertex[v] += dv;
          positions.push(...vertex);
          gradients.push(...normal);
        }
        const a = base, b = base + 1, c = base + 2, d = base + 3;
        if (sign > 0) indices.push(a, b, c, a, c, d);
        else indices.push(a, c, b, a, d, c);
      }
    }
  }
  return { positions, gradients, indices };
}


/** One dual vertex per mixed cell, placed at its mean edge crossing. The empty border closes outer faces. */
export function extractSurfaceNets(volume: Uint8Array, width: number, depth: number, layers: number) {
  const { nx, ny, nz, plane, count, occupancy } = paddedOccupancy(volume, width, depth, layers);
  const strides = [1, nx, plane];
  const corners = CORNERS.map(([x, y, z]) => x + nx * y + plane * z);
  const vertexAt = new Int32Array(count);
  const positions: number[] = [], gradients: number[] = [], indices: number[] = [];

  function faceNormal(a: number, b: number, c: number) {
    const ax = positions[b * 3] - positions[a * 3];
    const ay = positions[b * 3 + 1] - positions[a * 3 + 1];
    const az = positions[b * 3 + 2] - positions[a * 3 + 2];
    const bx = positions[c * 3] - positions[a * 3];
    const by = positions[c * 3 + 1] - positions[a * 3 + 1];
    const bz = positions[c * 3 + 2] - positions[a * 3 + 2];
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  }
  function triangle(a: number, b: number, c: number) {
    indices.push(a, b, c);
    const [nx, ny, nz] = faceNormal(a, b, c);
    for (const i of [a, b, c]) {
      gradients[i * 3] += nx;
      gradients[i * 3 + 1] += ny;
      gradients[i * 3 + 2] += nz;
    }
  }
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const cell = z * plane + y * nx + x;
    let mask = 0;
    for (let i = 0; i < 8; i++) mask |= occupancy[cell + corners[i]] << i;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, crossings = 0;
    for (const [a, b] of EDGES) {
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      sx += (CORNERS[a][0] + CORNERS[b][0]) / 2;
      sy += (CORNERS[a][1] + CORNERS[b][1]) / 2;
      sz += (CORNERS[a][2] + CORNERS[b][2]) / 2;
      crossings++;
    }
    const a = positions.length / 3;
    vertexAt[cell] = a;
    positions.push(x - .5 + sx / crossings, y - .5 + sy / crossings, z - .5 + sz / crossings);
    gradients.push(0, 0, 0);
    // The four cells around each crossing edge have already been visited in scan order.
    for (let axis = 0; axis < 3; axis++) {
      if (occupancy[cell] === occupancy[cell + strides[axis]]) continue;
      const u = strides[(axis + 1) % 3], v = strides[(axis + 2) % 3];
      const b = vertexAt[cell - u], c = vertexAt[cell - u - v], d = vertexAt[cell - v];
      if (occupancy[cell]) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(a, d, c); triangle(a, c, b); }
    }
  }
  // Alternating inside/outside corners can cancel the weighted normal at a saddle.
  // Use a real incident face normal for these vertices so exported normals stay valid.
  for (let i = 0; i < indices.length; i++) {
    const p = indices[i] * 3;
    if (Math.abs(gradients[p]) + Math.abs(gradients[p + 1]) + Math.abs(gradients[p + 2]) > 1e-10) continue;
    const start = i - i % 3;
    [gradients[p], gradients[p + 1], gradients[p + 2]] = faceNormal(indices[start], indices[start + 1], indices[start + 2]);
  }
  return { positions, gradients, indices };
}
