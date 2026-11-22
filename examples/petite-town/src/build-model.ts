import { decode } from 'fast-png'
import {
  encodeGlb,
  inspectViews,
  parseLayout,
  prepareViews,
  reconstructPrepared,
  splitAtlas,
  type MeshData,
} from '@stack3/core'
import { BufferAttribute, BufferGeometry } from 'three'
import { modelSettings } from './model-settings'

const roofStart: Record<string, number> = {
  'bridge-arch': 0,
  'house-roof': 0,
  'bakery-shell': 0.55,
  'potion-shell': 0.53,
  bakery: 0.55,
  potionist: 0.53,
  'well-roof': 0.25,
  awning: 0.15,
  'mill-body': 0.63,
}
const depth: Record<string, number> = {
  'house-chimney': 0.24,
  'bakery-chimney': 0.24,
  pot: 0.43,
  basket: 0.5,
  crate: 0.46,
}
const clamp = (n: number) => Math.min(1, Math.max(0, n))

function finishSurface(id: string, m: MeshData) {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(m.positions, 3))
  g.setIndex(new BufferAttribute(m.indices, 1))
  g.computeBoundingBox()
  const { min, max } = g.boundingBox!
  const changed: number[] = []
  for (let i = 0; i < m.positions.length; i += 3) {
    if (depth[id]) {
      const x = Math.abs((m.positions[i] - min.x) / (max.x - min.x) - 0.5) * 2
      const z =
        Math.abs((m.positions[i + 2] - min.z) / (max.z - min.z) - 0.5) * 2
      const radius =
        (id === 'house-chimney' || id === 'bakery-chimney')
          ? Math.max(x, z) / 0.4
          : id === 'crate'
            ? Math.max(x / 0.81, z / 0.84)
            : Math.hypot(x / 0.83, z / 0.83)
      const h = (m.positions[i + 1] - min.y) / (max.y - min.y)
      const weight = clamp((1 - radius) / 0.18) * clamp((h - 0.5) / 0.44)
      if (weight > 0) {
        m.positions[i + 1] -= (max.y - min.y) * depth[id] * weight
        changed.push(i)
        continue
      }
    }
    if (Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) < 0.01)
      changed.push(i)
  }
  if (!changed.length) return
  g.computeVertexNormals()
  const normals = g.getAttribute('normal')
  for (const i of changed) {
    const v = i / 3,
      x = normals.getX(v),
      y = normals.getY(v),
      z = normals.getZ(v)
    m.normals.set(x || y || z ? [x, y, z] : [0, 1, 0], i)
  }
}

function projectTop(id: string, m: MeshData, w: number, h: number) {
  const used = new Map<number, number>(),
    indices = m.indices
  let triangles = 0
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f] * 3 + 1,
      b = indices[f + 1] * 3 + 1,
      c = indices[f + 2] * 3 + 1
    if (
      (m.normals[a] + m.normals[b] + m.normals[c]) / 3 <= 0.3 ||
      (m.positions[a] + m.positions[b] + m.positions[c]) / 3 <=
        m.size[2] * roofStart[id]
    )
      continue
    // Keep the gable-end bevels painted from their elevation. Their upward
    // normals otherwise pull a band of roof tiles across the plaster.
    if (id === 'potion-shell' || id === 'bakery-shell') {
      const endNormal = Math.abs(
        m.normals[a + 1] + m.normals[b + 1] + m.normals[c + 1],
      )
      const slopeNormal = Math.abs(
        m.normals[a - 1] + m.normals[b - 1] + m.normals[c - 1],
      )
      if (endNormal > slopeNormal) continue
    }
    triangles++
    for (let j = f; j < f + 3; j++) {
      const old = indices[j]
      if (!used.has(old)) used.set(old, m.positions.length / 3 + used.size)
      indices[j] = used.get(old)!
    }
  }
  const count = m.positions.length / 3 + used.size
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2)
  positions.set(m.positions)
  normals.set(m.normals)
  uvs.set(m.uvs)
  const colors =
    id === 'bridge-arch' ? new Uint8Array(count * 4).fill(255) : undefined
  let low = Infinity,
    high = -Infinity
  for (let i = 1; i < m.positions.length; i += 3) {
    low = Math.min(low, m.positions[i])
    high = Math.max(high, m.positions[i])
  }
  for (const [old, v] of used) {
    positions.set(m.positions.subarray(old * 3, old * 3 + 3), v * 3)
    normals.set(m.normals.subarray(old * 3, old * 3 + 3), v * 3)
    const u = clamp(positions[v * 3] / m.size[0] + 0.5),
      t = clamp(0.5 - positions[v * 3 + 2] / m.size[1])
    uvs.set(
      [
        (1.5 + u * (w - 1)) / m.texture.width,
        (1.5 + t * (h - 1)) / m.texture.height,
      ],
      v * 2,
    )
    if (colors)
      colors.fill(
        Math.round(
          255 * (0.52 + (0.48 * (positions[v * 3 + 1] - low)) / (high - low)),
        ),
        v * 4,
        v * 4 + 3,
      )
  }
  Object.assign(m, { positions, normals, uvs })
  return { triangles, colors }
}

// stack3's GLB encoder supplies the textured mesh. Append its optional painted vertex colours.
function withColors(glb: Uint8Array, colors: Uint8Array) {
  const old = new DataView(glb.buffer, glb.byteOffset),
    jsonSize = old.getUint32(12, true)
  const doc = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + jsonSize)),
  )
  const bin = glb.subarray(28 + jsonSize)
  const bufferView = doc.bufferViews.length
  doc.bufferViews.push({
    buffer: 0,
    target: 34962,
    byteOffset: bin.length,
    byteLength: colors.length,
  })
  doc.meshes[0].primitives[0].attributes.COLOR_0 = doc.accessors.length
  doc.accessors.push({
    bufferView,
    componentType: 5121,
    count: colors.length / 4,
    type: 'VEC4',
    normalized: true,
  })
  doc.buffers[0].byteLength = bin.length + colors.length
  const json = new TextEncoder().encode(JSON.stringify(doc)),
    padded = (json.length + 3) & ~3
  const out = new Uint8Array(28 + padded + bin.length + colors.length),
    header = new DataView(out.buffer)
  out.set(glb.subarray(0, 20))
  header.setUint32(8, out.length, true)
  header.setUint32(12, padded, true)
  out.fill(32, 20, 20 + padded)
  out.set(json, 20)
  header.setUint32(20 + padded, bin.length + colors.length, true)
  header.setUint32(24 + padded, 0x004e4942, true)
  out.set(bin, 28 + padded)
  out.set(colors, 28 + padded + bin.length)
  return out
}

export function buildModel(
  id: string,
  png: Uint8Array,
  layers = modelSettings(id).layers,
) {
  const image = decode(png)
  if (image.channels !== 4 || image.depth !== 8)
    throw new Error('8-bit RGBA atlas required: ' + id)
  const views = prepareViews(
    splitAtlas(
      { ...image, data: new Uint8Array(image.data) },
      parseLayout('top,left,front,rear'),
    ),
  )
  const settings = { ...modelSettings(id), layers }
  const mesh = reconstructPrepared(views, 'mesh', settings)
  if (mesh.target !== 'mesh' || !mesh.indices.length)
    throw new Error('빈 메시 · ' + id)
  finishSurface(id, mesh)
  const roof =
    id in roofStart
      ? projectTop(id, mesh, views.top!.width, views.top!.height)
      : undefined
  const raw = encodeGlb(mesh),
    glb = roof?.colors ? withColors(raw, roof.colors) : raw
  const report = {
    ...inspectViews(views),
    ...settings,
    triangles: mesh.indices.length / 3,
    bytes: glb.length,
    roofTriangles: roof?.triangles ?? 0,
    recess: id in depth,
  }
  return { glb, report }
}
