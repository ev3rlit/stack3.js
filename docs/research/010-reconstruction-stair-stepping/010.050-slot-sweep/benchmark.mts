import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeGlb, encodePng, type Raster } from '../../../../packages/core/src/index'
import { meshSection, type Point, type Segment, type Vec3 } from '../010.010-resolution-baseline/benchmark.mjs'
import { silhouetteMesh } from '../010.030-feature-preservation/silhouette-field.mjs'
import { refineX } from '../010.040-corner-constraints-and-local-refinement/constraints.mjs'

type Visibility = 'exposed' | 'partial' | 'hidden'
type Parameters = { visibility: Visibility; angle: number; phase: number; width: number }
const size: Vec3 = [1, .6, .632]
const grid: Vec3 = [96, 58, 96]
const [sx, sy, sz] = size
const pixelsPerUnit = 1024
const sampleCount = 65
const plate = [.142, .154] as const
const occluder = [.267, .285] as const
const sectionHeight = .14763
const endTrim = .02
const partialBand = [.23, .37] as const

function fixture({ angle, phase, width, visibility }: Parameters) {
  const rad = angle * Math.PI / 180
  const normal: Point = angle === 90 ? [0, 1] : [Math.cos(rad), Math.sin(rad)]
  const [nx, ny] = normal
  const tangent: Point = [-ny, nx]
  const dx = sx / grid[0], dy = sy / grid[1]
  const pitch = Math.hypot(nx * dx, ny * dy)
  const anchor: Point = [sx / 2 - dx / 2, sy / 2 - dy / 2]
  const center: Point = [anchor[0] + phase * pitch * nx, anchor[1] + phase * pitch * ny]
  return { normal, tangent, center, pitch, width, visibility }
}

type Fixture = ReturnType<typeof fixture>

function render(spanX: number, spanY: number, projected: (u: number, v: number) => boolean): Raster {
  const width = Math.round(spanX * pixelsPerUnit), height = Math.round(spanY * pixelsPerUnit)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (projected((x + .5) / width * spanX, (y + .5) / height * spanY)) {
      const i = (y * width + x) * 4
      data[i] = 84
      data[i + 1] = 128
      data[i + 2] = 170
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const between = (x: number, interval: readonly [number, number]) => x >= interval[0] && x < interval[1]

function views({ normal: [nx, ny], center, width, visibility }: Fixture) {
  const plateAt = (x: number, y: number) => Math.abs(nx * (x - center[0]) + ny * (y - center[1])) >= width / 2
  const capAt = (y: number) => visibility === 'hidden' || visibility === 'partial' && between(y, partialBand)
  const capAtZ = (z: number) => visibility !== 'exposed' && between(z, occluder)
  const frontAt = (x: number, v: number) => capAtZ(sz - v) ||
    between(sz - v, plate) && (plateAt(x, 0) || plateAt(x, sy))
  return {
    top: render(sx, sy, (x, y) => plateAt(x, y) || capAt(y)),
    left: render(sy, sz, (u, v) => capAtZ(sz - v) && capAt(sy - u) ||
      between(sz - v, plate) && (plateAt(0, sy - u) || plateAt(sx, sy - u))),
    front: render(sx, sz, frontAt),
    rear: render(sx, sz, (x, v) => frontAt(sx - x, v)),
  }
}

function lineEvents(segments: Segment[], center: Point, direction: Point) {
  const [cx, cy] = center
  const [dx, dy] = direction
  const events: number[] = []
  for (const [x0, y0, x1, y1] of segments) {
    const a = dx * (y0 - cy) - dy * (x0 - cx)
    const b = dx * (y1 - cy) - dy * (x1 - cx)
    if ((a > 0) === (b > 0)) continue
    const t = a / (a - b)
    events.push(dx * (x0 - cx + t * (x1 - x0)) + dy * (y0 - cy + t * (y1 - y0)))
  }
  events.sort((a, b) => a - b)
  assert.equal(events.length % 2, 0, 'Crossings of the closed section must occur in pairs')
  return events
}

function interval(center: Point, tangent: Point): [number, number] {
  let first = -Infinity, last = Infinity
  for (let axis = 0; axis < 2; axis++) {
    if (tangent[axis] === 0) continue
    const a = -center[axis] / tangent[axis]
    const b = (size[axis] - center[axis]) / tangent[axis]
    first = Math.max(first, Math.min(a, b))
    last = Math.min(last, Math.max(a, b))
  }
  return [first + endTrim, last - endTrim]
}

function solidLength(events: number[], lo: number, hi: number) {
  let length = 0
  for (let i = 0; i < events.length; i += 2) {
    length += Math.max(0, Math.min(hi, events[i + 1]) - Math.max(lo, events[i]))
  }
  return length
}

function measure(segments: Segment[], input: Fixture) {
  const { center, tangent, normal } = input
  const [lo, hi] = interval(center, tangent)
  const line = lineEvents(segments, center, tangent)
  const partition = [lo, ...line.filter(t => t > lo && t < hi), hi]
  const openIntervals: Point[] = []
  for (let i = 1; i < partition.length; i++) {
    const a = partition[i - 1], b = partition[i]
    if (b - a < 1e-10 || solidLength(line, a, b) > 1e-10) continue
    const previous = openIntervals.at(-1)
    if (previous && a - previous[1] < 1e-10) previous[1] = b
    else openIntervals.push([a, b])
  }
  const centerlineOpen = 1 - solidLength(line, lo, hi) / (hi - lo)
  const profile: [number, number][] = []
  let middleBandTotal = 0, middleBandOpen = 0
  for (let i = 0; i < sampleCount; i++) {
    const t = lo + (hi - lo) * (i + .413) / sampleCount
    const point: Point = [center[0] + t * tangent[0], center[1] + t * tangent[1]]
    const events = lineEvents(segments, point, normal)
    const positive = events.findIndex(value => value > 0)
    // The central empty interval must have material on both sides.
    const width = positive > 0 && positive % 2 === 0 ? events[positive] - events[positive - 1] : 0
    profile.push([(t - lo) / (hi - lo), width])
    if (between(point[1], partialBand)) {
      middleBandTotal++
      if (width > 0) middleBandOpen++
    }
  }
  const widths = profile.map(row => row[1]).filter(value => value > 0).sort((a, b) => a - b)
  const status = centerlineOpen <= 1e-8 ? 'closed'
    : centerlineOpen >= 1 - 1e-8 && widths.length === sampleCount ? 'continuous' : 'fragmented'
  return { status, centerlineOpen, probesOpen: widths.length, medianOpenWidth: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
    middleBandOpen: middleBandTotal ? middleBandOpen / middleBandTotal : null, openIntervals, profile }
}

const destination = process.argv[2]
const flag = process.argv[3]
if (!destination || (flag !== undefined && flag !== '--glb') || process.argv.length > 4) {
  throw new Error('Usage: tsx benchmark.mts <output-directory> [--glb]')
}
const output = resolve(destination)
mkdirSync(output, { recursive: true })
const widths = [.004, .008, .016]
const phases = [0, .25, .5, .75]
const configurations = [
  { visibility: 'exposed' as const, angles: [0, 30, 45, 90], phases, widths },
  { visibility: 'partial' as const, angles: [0, 45], phases: [0, .5], widths },
  { visibility: 'hidden' as const, angles: [45], phases: [0, .5], widths: [.008, .016] },
]
const results = []
for (const configuration of configurations) for (const angle of configuration.angles) {
  for (const width of configuration.widths) for (const phase of configuration.phases) {
    const parameters = { visibility: configuration.visibility, angle, width, phase }
    const id = [parameters.visibility, angle, width * 1000, phase * 100].join('-')
    const reference = fixture(parameters)
    const images = views(reference)
    const hiddenWitness = parameters.visibility === 'hidden'
    if (hiddenWitness) {
      const solid = views({ ...reference, width: 0 })
      for (const direction of Object.keys(images) as (keyof typeof images)[]) {
        assert(Buffer.from(images[direction].data).equals(Buffer.from(solid[direction].data)),
          'Hidden-slot fixture must be indistinguishable in all four silhouettes')
      }
    }
    const uniform = silhouetteMesh(images, size, grid)
    const adaptation = refineX(images.top, sx, grid[0])
    const adapted = adaptation.added.length ? silhouetteMesh(images, size, grid, adaptation.cells) : uniform
    const branch = (mesh: typeof uniform) => {
      assert(mesh.positions.every(Number.isFinite))
      assert(mesh.indices.length > 0 && mesh.indices.every(idx => idx * 3 < mesh.positions.length))
      return { triangles: mesh.indices.length / 3, ...measure(meshSection(mesh, true, sectionHeight / sz), reference) }
    }
    const methods = { uniform: branch(uniform), refined: adapted === uniform ? null : branch(adapted) }
    if (flag === '--glb') {
      const folder = join(output, id)
      mkdirSync(folder, { recursive: true })
      for (const [direction, image] of Object.entries(images)) {
        writeFileSync(join(folder, direction + '.png'), encodePng(image))
      }
      writeFileSync(join(folder, 'uniform.glb'), encodeGlb(uniform))
      writeFileSync(join(folder, 'refined.glb'), encodeGlb(adapted))
    }
    results.push({ id, ...parameters, reference: { center: reference.center, pitch: reference.pitch },
      hiddenWitness, adaptation: { gaps: adaptation.gaps, added: adaptation.added, removed: adaptation.removed },
      uniform: methods.uniform, refined: methods.refined ?? methods.uniform })
    console.log(id, methods.uniform.status, '→', (methods.refined ?? methods.uniform).status)
  }
}
const checkout = fileURLToPath(new URL('../../../../', import.meta.url))
const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(join(output, 'results.json'), JSON.stringify({ commit, size, grid, pixelsPerUnit, sampleCount,
  sectionHeight, endTrim, plate, occluder, partialBand, results }, null, 2) + '\n')
