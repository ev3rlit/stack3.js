import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeGlb, encodePng, reconstruct, type MeshData, type Raster, type StackData } from '../../../../packages/core/src/index'

const checkout = fileURLToPath(new URL('../../../../', import.meta.url))
export type Vec3 = [number, number, number]
export type Point = [number, number]
export type Segment = [number, number, number, number]

const pixelsPerUnit = 2048
const sampleCount = 2048
export const plateThickness = .012
export const plateSlope = .62
const cut = .473123
const ramp = (x: number) => .12 + .88 * x
export const shapes: { name: string; size: Vec3; front: (x: number, h: number) => boolean }[] = [
  { name: 'wedge', size: [1, .6, 1], front: (x, h) => h < ramp(x) },
  { name: 'cylinder', size: [1, 1, 1], front: () => true },
  { name: 'plate', size: [1, .6, plateSlope + plateThickness],
    front: (x, h) => h >= plateSlope * x && h < plateSlope * x + plateThickness },
]
export type Variant = { name: string; resolution: number; layers: number }

const baselineVariants: Variant[] = [
  { name: 'baseline', resolution: 96, layers: 48 },
  { name: 'higher', resolution: 176, layers: 96 },
]

function raster(spanX: number, spanY: number, inside: (x: number, y: number) => boolean): Raster {
  const width = Math.round(spanX * pixelsPerUnit)
  const height = Math.round(spanY * pixelsPerUnit)
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (inside((col + .5) / width, (row + .5) / height)) {
        data.set([84, 128, 170, 255], (row * width + col) * 4)
      }
    }
  }
  return { width, height, data }
}

// Extract the exact perimeter of the union of occupied pixel or voxel cells in the section.
function maskSection(w: number, h: number, sx: number, sy: number, get: (x: number, y: number) => boolean) {
  const segments: Segment[] = []
  const filled = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && get(x, y)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!get(x, y)) continue
      const a = x / w * sx
      const b = (x + 1) / w * sx
      const c = y / h * sy
      const d = (y + 1) / h * sy
      if (!filled(x - 1, y)) segments.push([a, c, a, d])
      if (!filled(x + 1, y)) segments.push([b, c, b, d])
      if (!filled(x, y - 1)) segments.push([a, c, b, c])
      if (!filled(x, y + 1)) segments.push([a, d, b, d])
    }
  }
  return segments
}

export function meshSection(mesh: MeshData, horizontal: boolean, fraction = cut) {
  const [sx, sy, sz] = mesh.size
  const plane = fraction * (horizontal ? sz : sy)
  const p = mesh.positions
  const points = (i: number): Vec3 => {
    const x = p[i * 3] + sx / 2
    const y = sy / 2 - p[i * 3 + 2]
    const z = p[i * 3 + 1]
    return horizontal ? [x, y, z] : [x, z, y]
  }
  const segments: Segment[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = [points(mesh.indices[i]), points(mesh.indices[i + 1]), points(mesh.indices[i + 2])]
    const hits: Point[] = []
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge]
      const b = triangle[(edge + 1) % 3]
      if ((a[2] > plane) === (b[2] > plane)) continue
      const t = (plane - a[2]) / (b[2] - a[2])
      hits.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
    if (hits.length === 2) segments.push([...hits[0], ...hits[1]])
  }
  return segments
}

export function evaluate(name: string, segments: Segment[]) {
  const samples = []
  let squareError = 0
  let thicknessTotal = 0
  let present = 0
  let gap = 0
  let maxGap = 0
  for (let index = 0; index < sampleCount; index++) {
    const t = (index + .413) / sampleCount
    if (name === 'cylinder') {
      const angle = t * 2 * Math.PI
      const dx = Math.cos(angle), dy = Math.sin(angle)
      let radius = 0
      for (const [x0, y0, x1, y1] of segments) {
        const a = dx * (y0 - .5) - dy * (x0 - .5)
        const b = dx * (y1 - .5) - dy * (x1 - .5)
        if ((a > 0) === (b > 0)) continue
        const u = a / (a - b)
        radius = Math.max(radius, dx * (x0 + u * (x1 - x0) - .5) + dy * (y0 + u * (y1 - y0) - .5))
      }
      assert(radius > 0)
      squareError += (radius - .5) ** 2
      samples.push([angle, radius])
      continue
    }
    // Exclude the outer 5%, where intentional end faces meet the measured surface.
    const x = .05 + .90 * t
    const hits: number[] = []
    for (const [x0, y0, x1, y1] of segments) {
      if ((x0 > x) === (x1 > x)) continue
      hits.push(y0 + (x - x0) / (x1 - x0) * (y1 - y0))
    }
    hits.sort((a, b) => a - b)
    const unique = hits.filter((value, i) => !i || value - hits[i - 1] > 1e-9)
    assert.equal(unique.length % 2, 0, `Open section at x=${x}`)
    const top = unique.at(-1) ?? null
    let thickness = 0
    for (let i = 0; i < unique.length; i += 2) thickness += unique[i + 1] - unique[i]
    if (name === 'wedge') {
      assert(top !== null)
      squareError += (top - ramp(x)) ** 2
    }
    if (thickness > 0) {
      present++
      gap = 0
    } else {
      maxGap = Math.max(maxGap, ++gap)
    }
    thicknessTotal += thickness
    samples.push([x, top, unique[0] ?? null, thickness])
  }
  return {
    ...(name === 'plate'
      ? { coverage: present / sampleCount, averageThickness: thicknessTotal / sampleCount,
          thicknessWhenPresent: thicknessTotal / present, maxGap: maxGap * .9 / sampleCount }
      : { rms: Math.sqrt(squareError / sampleCount) }),
    samples,
  }
}

export function stackSection(stack: StackData, horizontal: boolean) {
  const { width, depth, layers, columns, texture, size } = stack
  const filled = (x: number, y: number, z: number) => {
    const i = ((Math.floor(z / columns) * depth + y) * texture.width + z % columns * width + x) * 4
    return texture.data[i + 3] > 0
  }
  return horizontal
    ? maskSection(width, depth, size[0], size[1], (x, y) => filled(x, y, Math.floor(cut * layers)))
    : maskSection(width, layers, size[0], size[2], (x, z) => filled(x, Math.floor(cut * depth), z))
}

export function analyticViews(shape: typeof shapes[number], footprint = (_x: number) => true) {
  const { name, size: [sx, sy, sz], front } = shape
  const horizontal = name === 'cylinder'
  return {
    top: raster(sx, sy, (x, y) => footprint(x) && (!horizontal || Math.hypot(x - .5, y - .5) <= .5)),
    left: raster(sy, sz, () => true),
    front: raster(sx, sz, (x, row) => footprint(x) && front(x, (1 - row) * sz)),
    rear: raster(sx, sz, (x, row) => footprint(1 - x) && front(1 - x, (1 - row) * sz)),
  }
}

export function runBenchmark(variants: Variant[], destination: string, writeMeshes = false) {
  const output = resolve(destination)
  const results = []
  for (const shape of shapes) {
    const { name, size } = shape
    const [sx, sy, sz] = size
    const horizontal = name === 'cylinder'
    const views = analyticViews(shape)
    const folder = join(output, 'inputs', name)
    mkdirSync(folder, { recursive: true })
    for (const [direction, image] of Object.entries(views)) {
      writeFileSync(join(folder, direction + '.png'), encodePng(image))
    }
    const source = horizontal ? views.top : views.front
    const sourceSegments = maskSection(source.width, source.height, sx, horizontal ? sy : sz,
      (x, y) => source.data[((horizontal ? y : source.height - 1 - y) * source.width + x) * 4 + 3] > 0)
    const input = evaluate(name, sourceSegments)
    const runs = []
    for (const { name: label, ...sampling } of variants) {
      const settings = { size, ...sampling }
      const stack = reconstruct(views, 'stack', settings)
      const mesh = reconstruct(views, 'mesh', settings)
      assert.equal(stack.target, 'stack')
      assert.equal(mesh.target, 'mesh')
      assert.deepEqual(mesh.size, stack.size)
      assert.deepEqual(mesh.pivot, [0, 0, 0])
      assert.deepEqual(stack.pivot, mesh.pivot)
      assert(mesh.positions.every(Number.isFinite))
      assert(mesh.indices.length > 0 && mesh.indices.every(i => i * 3 < mesh.positions.length))
      if (writeMeshes) writeFileSync(join(output, name + '-' + label + '.glb'), encodeGlb(mesh))
      const voxel = evaluate(name, stackSection(stack, horizontal))
      const final = evaluate(name, meshSection(mesh, horizontal))
      runs.push({ label, grid: [stack.width, stack.depth, stack.layers], triangles: mesh.indices.length / 3,
        voxel, mesh: final })
      console.log(name, label, runs.at(-1)!.grid.join('×'), 'triangles', mesh.indices.length / 3)
    }
    results.push({ name, size, input, runs })
  }
  const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(join(output, 'results.json'), JSON.stringify({
    commit, pixelsPerUnit, sampleCount, cut, plateThickness, plateSlope, results,
  }, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2]
  if (!destination) throw new Error('Usage: tsx benchmark.mts <output-directory>')
  runBenchmark(baselineVariants, destination)
}
