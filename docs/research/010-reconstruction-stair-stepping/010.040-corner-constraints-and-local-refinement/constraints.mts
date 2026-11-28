import assert from 'node:assert/strict'
import type { MeshData, Raster } from '../../../../packages/core/src/index'
import type { Vec3 } from '../010.010-resolution-baseline/benchmark.mjs'

function occupiedColumns(image: Raster) {
  const columns = new Uint8Array(image.width)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] >= 128) columns[x] = 1
  }
  return columns
}

export function refineX(top: Raster, width: number, count: number) {
  const columns = occupiedColumns(top)
  const first = columns.indexOf(1)
  const last = columns.lastIndexOf(1)
  const gaps: { lo: number; hi: number }[] = []
  let x = first + 1
  while (x < last) {
    if (columns[x]) {
      x++
      continue
    }
    const start = x
    while (!columns[x] && x < last) x++
    gaps.push({ lo: start * width / top.width, hi: x * width / top.width })
  }

  const cells = Array.from({ length: count }, (_, i) => (i + .5) * (width / count))
  const added: number[] = [], removed: number[] = []
  for (const { lo, hi } of gaps) {
    if (cells.some(point => point > lo && point < hi)) continue
    const donorScore = (point: number) => Math.min(point, width - point, ...gaps.map(gap =>
      point <= gap.lo ? gap.lo - point : point - gap.hi))
    let donor = -1
    let best = width / count
    for (let i = 1; i < cells.length - 1; i++) {
      const unmodified = !added.includes(cells[i]) && removed.every(point => Math.abs(cells[i] - point) >= 2 * width / count)
      const score = donorScore(cells[i])
      if (unmodified && score > best) {
        donor = i
        best = score
      }
    }
    assert(donor >= 0, 'No donor sample far enough from a detected gap')
    removed.push(cells[donor])
    const midpoint = (lo + hi) / 2
    added.push(midpoint)
    cells.splice(donor, 1)
    cells.push(midpoint)
    cells.sort((a, b) => a - b)
  }
  assert.equal(cells.length, count)
  return { cells, gaps, added, removed }
}

// Estimate the upper-right ridge from the slope and end wall visible in the front mask.
export function fitUpperRight(front: Raster, size: Vec3) {
  const [width, , height] = size
  const last = occupiedColumns(front).lastIndexOf(1)
  const right = (last + 1) / front.width * width
  let sx = 0, sz = 0, sxx = 0, sxz = 0, count = 0
  const inset = Math.max(2, Math.floor(front.width / 128))
  const start = Math.max(0, last - Math.ceil(front.width / 8))
  for (let x = start; x <= last - inset; x++) {
    for (let row = 0; row < front.height; row++) {
      if (front.data[(row * front.width + x) * 4 + 3] < 128) continue
      const px = (x + .5) / front.width * width
      const pz = (1 - row / front.height) * height
      sx += px
      sz += pz
      sxx += px * px
      sxz += px * pz
      count++
      break
    }
  }
  assert(count >= 2 && count * sxx > sx * sx, 'Insufficient samples for the slope fit')
  const slope = (count * sxz - sx * sz) / (count * sxx - sx * sx)
  const intercept = (sz - slope * sx) / count
  assert(slope > 0 && right > 0, 'Expected an upward slope against the right end wall')
  return { right, height: slope * right + intercept, slope, intercept, samples: count }
}

type Triangle = [number, number, number]

// Split the triangles that cross the chamfer bisector and place those crossings on the fitted ridge.
// Shared edge splits retain the indexed surface connectivity. Taper the correction near both depth ends.
export function constrainRidge(mesh: MeshData, grid: Vec3, ridge: ReturnType<typeof fitUpperRight>) {
  const [width, depth, height] = mesh.size
  const depthStep = depth / grid[1]
  const positions = Array.from(mesh.positions)
  const normals = Array.from(mesh.normals)
  const texcoords = Array.from(mesh.uvs)
  const indices: number[] = []
  const splits = new Map<string, number>()
  const limit = 1.25 * Math.max(width / grid[0], height / grid[2])
  const slopeLength = Math.hypot(ridge.slope, 1)
  const bisector = (x: number, z: number) => (ridge.slope * x + ridge.intercept - z) / slopeLength - (ridge.right - x)
  function edgeSplit(a: number, b: number) {
    const key = a < b ? a + ',' + b : b + ',' + a
    const cached = splits.get(key)
    if (cached !== undefined) return cached
    const ai = a * 3, bi = b * 3
    const from = bisector(positions[ai] + width / 2, positions[ai + 1])
    const to = bisector(positions[bi] + width / 2, positions[bi + 1])
    if ((from >= 0) === (to >= 0)) return -1
    const t = from / (from - to)
    const x = positions[ai] + (positions[bi] - positions[ai]) * t
    const z = positions[ai + 1] + (positions[bi + 1] - positions[ai + 1]) * t
    const y = positions[ai + 2] + (positions[bi + 2] - positions[ai + 2]) * t
    const targetX = ridge.right - width / 2
    if (Math.hypot(targetX - x, ridge.height - z) > limit || t < 1e-5 || t > 1 - 1e-5) return -1
    const blend = Math.min(1, Math.max(0, (depth / 2 - Math.abs(y) - depthStep) / (2 * depthStep)))
    if (blend === 0) return -1

    const id = positions.length / 3
    positions.push(x + (targetX - x) * blend, z + (ridge.height - z) * blend, y)
    const normal = [0, 1, 2].map(axis => normals[ai + axis] + (normals[bi + axis] - normals[ai + axis]) * t)
    const magnitude = Math.hypot(...normal) || 1
    normals.push(...normal.map(value => value / magnitude))
    texcoords.push(0, 0)
    splits.set(key, id)
    return id
  }

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle: Triangle = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]
    const faces: Triangle[] = [triangle]
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3]
      const midpoint = edgeSplit(a, b)
      if (midpoint < 0) continue
      const face = faces.findIndex(item => item.includes(a) && item.includes(b))
      const c = faces[face].find(vertex => vertex !== a && vertex !== b)!
      faces.splice(face, 1, [a, midpoint, c], [midpoint, b, c])
    }
    for (const face of faces) indices.push(...face)
  }

  return { mesh: { ...mesh, positions: Float32Array.from(positions), normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices), uvs: Float32Array.from(texcoords) },
    insertedVertices: splits.size }
}
