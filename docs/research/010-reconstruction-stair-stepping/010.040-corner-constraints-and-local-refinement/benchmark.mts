import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeGlb, encodePng, prepareViews, reconstruct, type MeshData } from '../../../../packages/core/src/index'
import { meshSection, plateThickness, type Vec3 } from '../010.010-resolution-baseline/benchmark.mjs'
import { assets, components, featureStudyViews, layers, resolution, sectionMetrics, slots } from '../010.030-feature-preservation/benchmark.mjs'
import { silhouetteMesh } from '../010.030-feature-preservation/silhouette-field.mjs'
import { constrainRidge, fitUpperRight, refineX } from './constraints.mjs'

const destination = process.argv[2]
const flag = process.argv[3]
if (!destination || (flag !== undefined && flag !== '--glb') || process.argv.length > 4) {
  throw new Error('Usage: tsx benchmark.mts <output-directory> [--glb]')
}
const output = resolve(destination)
const checkout = fileURLToPath(new URL('../../../../', import.meta.url))

function topology(mesh: MeshData) {
  const vertexCount = mesh.positions.length / 3
  const edges = new Map<number, [number, number]>()
  let degenerate = 0
  const positions = mesh.positions
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = mesh.indices.subarray(i, i + 3)
    const [a, b, c] = Array.from(triangle, index => index * 3)
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 2e-12) degenerate++
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge], to = triangle[(edge + 1) % 3]
      const id = Math.min(from, to) * vertexCount + Math.max(from, to)
      const uses = edges.get(id) ?? [0, 0]
      uses[0]++
      uses[1] += from < to ? 1 : -1
      edges.set(id, uses)
    }
  }
  let boundary = 0, nonManifold = 0, inconsistent = 0
  for (const [uses, winding] of edges.values()) {
    if (uses === 1) boundary++
    if (uses > 2) nonManifold++
    if (uses === 2 && winding !== 0) inconsistent++
  }
  return { boundary, nonManifold, inconsistent, degenerate }
}

const results = []
for (const asset of assets.filter(item => item.name === 'wedge' || item.name === 'slotted-plate')) {
  const { name, size } = asset
  const input = featureStudyViews(asset)
  const folder = join(output, 'inputs', name)
  mkdirSync(folder, { recursive: true })
  for (const [direction, raster] of Object.entries(input)) {
    writeFileSync(join(folder, direction + '.png'), encodePng(raster))
  }
  const stack = reconstruct(input, 'stack', { resolution, layers, size })
  assert.equal(stack.target, 'stack')
  const grid: Vec3 = [stack.width, stack.depth, stack.layers]
  const prepared = { ...input, ...prepareViews(input) }
  const uniform = silhouetteMesh(prepared, size, grid)
  const refinement = refineX(prepared.top, size[0], grid[0])
  const refined = refinement.added.length ? silhouetteMesh(prepared, size, grid, refinement.cells) : uniform
  const ridge = name === 'wedge' ? fitUpperRight(prepared.front, size) : null
  const unconstrained = { mesh: uniform, insertedVertices: 0 }
  const refinedOnly = { mesh: refined, insertedVertices: 0 }
  const corner = ridge ? constrainRidge(uniform, grid, ridge) : unconstrained
  const combined = ridge ? (refined === uniform ? corner : constrainRidge(refined, grid, ridge)) : refinedOnly

  const configurations = [
    { label: 'control', ...unconstrained },
    { label: 'corner', ...corner },
    { label: 'refined', ...refinedOnly },
    { label: 'combined', ...combined },
  ]
  const runs = configurations.map(({ label, mesh, insertedVertices }) => {
    assert(mesh.positions.every(Number.isFinite))
    assert(mesh.indices.length > 0 && mesh.indices.every(i => i * 3 < mesh.positions.length))
    const quality = topology(mesh)
    if (flag === '--glb') writeFileSync(join(output, name + '-' + label + '.glb'), encodeGlb(mesh))
    const segments = meshSection(mesh, false)
    const cornerDetail = name === 'wedge' ? segments.filter(([x0, z0, x1, z1]) =>
      Math.max(x0, x1) >= .96 && Math.max(z0, z1) >= .95) : []
    const voxels = grid[0] * grid[1] * grid[2]
    const triangles = mesh.indices.length / 3
    const connectedComponents = components(mesh)
    console.log(name, label, grid.join('×'), 'triangles', triangles, 'components', connectedComponents, quality)
    return { label, voxels, triangles, insertedVertices, components: connectedComponents, topology: quality,
      section: sectionMetrics(name, segments), cornerDetail }
  })
  results.push({ name, size, grid, ridge, refinement, runs })
}

const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(join(output, 'results.json'), JSON.stringify({ commit, resolution, layers, plateThickness, slots, results }, null, 2) + '\n')
