import type { MeshData, Raster } from '../../../../packages/core/src/index'
import { MC_TRIANGLES } from '../../../../packages/core/src/marching-table'
import type { Vec3 } from '../010.010-resolution-baseline/benchmark.mjs'

const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] as const
const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]] as const
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))

// Squared Euclidean distance by the lower envelope of one-dimensional parabolas.
function distances(mask: Uint8Array, width: number, height: number, dx: number, dy: number, target: number) {
  const result = new Float32Array(mask.length)
  const length = Math.max(width, height)
  const f = new Float64Array(length)
  const sites = new Int32Array(length)
  const limits = new Float64Array(length + 1)
  const far = (width * dx) ** 2 + (height * dy) ** 2 + 1
  function line(count: number, scale: number, start: number, stride: number) {
    let last = 0
    sites[0] = 0
    limits[0] = -Infinity
    limits[1] = Infinity
    for (let q = 1; q < count; q++) {
      let intersection
      do {
        const p = sites[last]
        intersection = (q + p) / 2 + (f[q] - f[p]) / (2 * scale * (q - p))
        if (intersection > limits[last]) break
        last--
      } while (true)
      sites[++last] = q
      limits[last] = intersection
      limits[last + 1] = Infinity
    }
    last = 0
    for (let q = 0; q < count; q++) {
      while (limits[last + 1] < q) last++
      const p = sites[last]
      result[start + q * stride] = f[p] + scale * (q - p) ** 2
    }
  }
  for (let y = 0; y < height; y++) {
    const start = y * width
    for (let x = 0; x < width; x++) f[x] = mask[start + x] === target ? 0 : far
    line(width, dx * dx, start, 1)
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = result[x + y * width]
    line(height, dy * dy, x, width)
  }
  return result
}

function silhouette(image: Raster, sx: number, sy: number) {
  const dx = sx / image.width
  const dy = sy / image.height
  const w = image.width + 2
  const h = image.height + 2
  const mask = new Uint8Array(w * h)
  let count = 0
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const inside = Number(image.data[(y * image.width + x) * 4 + 3] >= 128)
    mask[(y + 1) * w + x + 1] = inside
    count += inside
  }
  if (count === image.width * image.height) {
    return (x: number, y: number) => {
      const a = Math.abs(x - sx / 2) - sx / 2
      const b = Math.abs(y - sy / 2) - sy / 2
      return -Math.hypot(Math.max(a, 0), Math.max(b, 0)) - Math.min(Math.max(a, b), 0)
    }
  }

  const inward = distances(mask, w, h, dx, dy, 0)
  const outward = distances(mask, w, h, dx, dy, 1)
  const halfPixel = Math.min(dx, dy) / 2
  for (let i = 0; i < mask.length; i++) {
    inward[i] = mask[i] ? Math.sqrt(inward[i]) - halfPixel : halfPixel - Math.sqrt(outward[i])
  }
  return (x: number, y: number) => {
    const px = x / dx + .5
    const py = y / dy + .5
    const u = clamp(px, 0, w - 1)
    const v = clamp(py, 0, h - 1)
    const col = Math.min(w - 2, Math.floor(u))
    const row = Math.min(h - 2, Math.floor(v))
    const a = u - col
    const b = v - row
    const i = row * w + col
    const upper = inward[i] * (1 - a) + inward[i + 1] * a
    const lower = inward[i + w] * (1 - a) + inward[i + w + 1] * a
    return upper * (1 - b) + lower * b - Math.hypot((px - u) * dx, (py - v) * dy)
  }
}

export function silhouetteMesh(views: Record<'top' | 'left' | 'front' | 'rear', Raster>,
  size: Vec3, grid: Vec3, xCenters?: readonly number[]): MeshData {
  const [sx, sy, sz] = size
  const [wx, wy, wz] = grid
  const dx = sx / wx, dy = sy / wy, dz = sz / wz
  if (xCenters && (xCenters.length !== wx || xCenters.some((x, i) =>
    !Number.isFinite(x) || x <= (xCenters[i - 1] ?? 0) || x >= sx))) {
    throw new Error('X sample coordinates must be strictly increasing inside the asset bounds')
  }
  const nx = wx + 2, ny = wy + 2, nz = wz + 2
  const plane = nx * ny
  const top = silhouette(views.top, sx, sy)
  const left = silhouette(views.left, sy, sz)
  const front = silhouette(views.front, sx, sz)
  const rear = silhouette(views.rear, sx, sz)
  const field = (x: number, y: number, z: number) => Math.min(top(x, y), left(sy - y, sz - z),
    Math.max(front(x, sz - z), rear(sx - x, sz - z)))
  const sampleX = (x: number) => xCenters?.[x - 1] ?? (x - .5) * dx
  const samples = new Float64Array(plane * nz)
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    samples[z * plane + y * nx + x] = field(sampleX(x), (y - .5) * dy, (z - .5) * dz)
  }

  const offset = [0, 1, nx + 1, nx, plane, plane + 1, plane + nx + 1, plane + nx]
  const cache = new Int32Array(samples.length * 3).fill(-1)
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  function vertex(x: number, y: number, z: number, cell: number, edge: number) {
    const [a, b] = edges[edge]
    const [ax, ay, az] = corners[a]
    const [bx, by, bz] = corners[b]
    const axis = ax !== bx ? 0 : ay !== by ? 1 : 2
    const key = 3 * (cell + Math.min(offset[a], offset[b])) + axis
    if (cache[key] !== -1) return cache[key]
    const start = [sampleX(x + ax), (y - .5 + ay) * dy, (z - .5 + az) * dz]
    const step = [xCenters ? sampleX(x + bx) - start[0] : (bx - ax) * dx, (by - ay) * dy, (bz - az) * dz]
    const inside = samples[cell + offset[a]] >= 0
    let lo = 0, hi = 1
    // Resolve the crossing against the source field, including intersections of view constraints.
    for (let i = 0; i < 14; i++) {
      const t = (lo + hi) / 2
      const p = field(start[0] + t * step[0], start[1] + t * step[1], start[2] + t * step[2])
      if ((p >= 0) === inside) lo = t
      else hi = t
    }
    const t = (lo + hi) / 2
    const px = start[0] + t * step[0], py = start[1] + t * step[1], pz = start[2] + t * step[2]
    const e = 1 / 4096
    const gx = field(px - e, py, pz) - field(px + e, py, pz)
    const gy = field(px, py - e, pz) - field(px, py + e, pz)
    const gz = field(px, py, pz - e) - field(px, py, pz + e)
    const magnitude = Math.hypot(gx, gy, gz) || 1
    const index = positions.length / 3
    positions.push(px - sx / 2, pz, sy / 2 - py)
    normals.push(gx / magnitude, gz / magnitude, -gy / magnitude)
    cache[key] = index
    return index
  }
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const cell = z * plane + y * nx + x
    let configuration = 0
    for (let i = 0; i < 8; i++) if (samples[cell + offset[i]] < 0) configuration |= 1 << i
    for (let row = configuration * 16; MC_TRIANGLES[row] >= 0; row++) {
      indices.push(vertex(x, y, z, cell, MC_TRIANGLES[row]))
    }
  }
  return { target: 'mesh', size, pivot: [0, 0, 0], positions: Float32Array.from(positions),
    normals: Float32Array.from(normals), indices: Uint32Array.from(indices),
    uvs: new Float32Array(positions.length / 3 * 2),
    texture: { width: 1, height: 1, data: Uint8Array.of(84, 128, 170, 255) } }
}
