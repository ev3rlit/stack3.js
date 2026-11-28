import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeGlb, encodePng, prepareViews, reconstruct, type MeshData } from '../../../../packages/core/src/index'
import { analyticViews, evaluate, meshSection, plateThickness, shapes, stackSection,
  type Point, type Segment, type Vec3 } from '../010.010-resolution-baseline/benchmark.mjs'
import { silhouetteMesh } from './silhouette-field.mjs'

const checkout = fileURLToPath(new URL('../../../../', import.meta.url))
export const resolution = 96
export const layers = 96

// A through-slot wider than one X cell plus one below the X sampling interval.
export const slots = [{ center: .375, width: .008 }, { center: .625, width: .016 }]
const inSlot = (x: number) => slots.some(slot => Math.abs(x - slot.center) < slot.width / 2)

function cornerDistance(point: Point, segments: Segment[]) {
  let closest = Infinity
  for (const [x0, y0, x1, y1] of segments) {
    const dx = x1 - x0, dy = y1 - y0
    const t = Math.max(0, Math.min(1, ((point[0] - x0) * dx + (point[1] - y0) * dy) / (dx * dx + dy * dy || 1)))
    closest = Math.min(closest, Math.hypot(point[0] - x0 - t * dx, point[1] - y0 - t * dy))
  }
  return closest
}

export function sectionMetrics(name: string, segments: Segment[]) {
  const plate = name === 'plate' || name === 'slotted-plate'
  const measured = evaluate(plate ? 'plate' : name, segments)
  if (name === 'wedge') {
    assert('rms' in measured)
    return { rms: measured.rms, corners: { low: cornerDistance([0, .12], segments),
      high: cornerDistance([1, 1], segments) }, samples: measured.samples }
  }
  if (!plate) return measured
  const samples = measured.samples as [number, number | null, number | null, number][]
  const solid = name === 'slotted-plate' ? samples.filter(([x]) => !inSlot(x)) : samples
  const thickness = solid.map(row => row[3])
  const slotMetrics = name === 'slotted-plate' ? slots.map(slot => {
    const half = slot.width / 2
    const inExpectedSlot = samples.filter(([x]) => Math.abs(x - slot.center) <= half)
    const step = samples[1][0] - samples[0][0]
    const center = samples.findIndex(([x]) => x >= slot.center)
    if (samples[center][3] > 0 || samples[center - 1][3] > 0) {
      return { ...slot, openWidth: 0, openFraction: inExpectedSlot.filter(row => row[3] === 0).length / inExpectedSlot.length }
    }
    let first = center - 1, last = center
    while (first > 0 && samples[first - 1][3] === 0) first--
    while (last + 1 < samples.length && samples[last + 1][3] === 0) last++
    return { ...slot, openWidth: (last - first + 1) * step,
      openFraction: inExpectedSlot.filter(row => row[3] === 0).length / inExpectedSlot.length }
  }) : []
  return { coverage: thickness.filter(value => value > 0).length / thickness.length,
    minThickness: Math.min(...thickness), maxThickness: Math.max(...thickness),
    thicknessRms: Math.sqrt(thickness.reduce((sum, value) => sum + (value - plateThickness) ** 2, 0) / thickness.length),
    slots: slotMetrics, samples }
}

// Baseline GLB duplicates positions along texture seams, so weld before counting components.
export function components(mesh: MeshData) {
  const points = new Map<string, number>()
  const parents: number[] = []
  const ids = new Int32Array(mesh.positions.length / 3)
  for (let i = 0; i < ids.length; i++) {
    const key = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
      .map(value => Math.round(value * 1e6)).join(',')
    let id = points.get(key)
    if (id === undefined) {
      id = parents.length
      points.set(key, id)
      parents.push(id)
    }
    ids[i] = id
  }
  function root(index: number) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.subarray(i, i + 3)
    parents[root(ids[b])] = root(ids[a])
    parents[root(ids[c])] = root(ids[a])
  }
  return parents.filter((parent, i) => parent === i).length
}

const plate = shapes.find(shape => shape.name === 'plate')!
export const assets = [...shapes, { ...plate, name: 'slotted-plate' }]

export function featureStudyViews(asset: typeof assets[number]) {
  return analyticViews(asset, asset.name === 'slotted-plate' ? x => !inSlot(x) : undefined)
}

function runBenchmark(destination: string, writeMeshes: boolean) {
  const output = resolve(destination)
  const results = []
  for (const asset of assets) {
    const { name, size } = asset
    const horizontal = name === 'cylinder'
    const input = featureStudyViews(asset)
    const folder = join(output, 'inputs', name)
    mkdirSync(folder, { recursive: true })
    for (const [direction, raster] of Object.entries(input)) {
      writeFileSync(join(folder, direction + '.png'), encodePng(raster))
    }
    const settings = { resolution, layers, size }
    const stack = reconstruct(input, 'stack', settings)
    const baseline = reconstruct(input, 'mesh', settings)
    assert.equal(stack.target, 'stack')
    assert.equal(baseline.target, 'mesh')
    const grid: Vec3 = [stack.width, stack.depth, stack.layers]
    const prepared = { ...input, ...prepareViews(input) }
    const candidate = silhouetteMesh(prepared, size, grid)
    assert.deepEqual(candidate.size, baseline.size)
    assert.deepEqual(candidate.pivot, baseline.pivot)
    const methods = [{ label: 'baseline', mesh: baseline }, { label: 'silhouette-field', mesh: candidate }]
    const runs = methods.map(({ label, mesh }) => {
      assert(mesh.positions.every(Number.isFinite))
      assert(mesh.indices.length > 0 && mesh.indices.every(i => i * 3 < mesh.positions.length))
      if (writeMeshes) writeFileSync(join(output, name + '-' + label + '.glb'), encodeGlb(mesh))
      const voxels = grid[0] * grid[1] * grid[2]
      const triangles = mesh.indices.length / 3
      console.log(name, label, grid.join('×'), 'triangles', triangles)
      return { label, voxels, triangles, components: components(mesh),
        section: sectionMetrics(name, meshSection(mesh, horizontal)) }
    })
    results.push({ name, size, grid, voxel: sectionMetrics(name, stackSection(stack, horizontal)), runs })
  }

  const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(join(output, 'results.json'), JSON.stringify({ commit, resolution, layers, plateThickness, slots, results }, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2]
  const flag = process.argv[3]
  if (!destination || (flag !== undefined && flag !== '--glb') || process.argv.length > 4) {
    throw new Error('Usage: tsx benchmark.mts <output-directory> [--glb]')
  }
  runBenchmark(destination, flag === '--glb')
}
