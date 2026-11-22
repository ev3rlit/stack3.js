import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  type ShaderMaterial,
} from 'three'
import { exhibits, type Exhibit, type Part } from './assemblies'
import { modelCache, type Template } from './model-cache'
import { maxLayers, minLayers, modelSettings, isProjectionChoice, type ProjectionChoice } from './model-settings'

export interface Placement {
  item: Exhibit
  part: Part
  key: string
  ordinal: number
  layers: number
  projection: ProjectionChoice
  version: number
  template: Template
  proxy: Mesh
  mount: Group
}
type Batch = { object: InstancedMesh; members: Placement[] }
const savedKey = 'petite-town.layers.v1'
function savedLayers(): Record<string, number | { layers: number; projection: ProjectionChoice }> {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey) ?? '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}
function valid(n: number) {
  return Number.isInteger(n) && n >= minLayers && n <= maxLayers
}
function fit(p: Placement) {
  const box = p.template.geometry.boundingBox!,
    center = box.getCenter(new Vector3()),
    size = box.getSize(new Vector3())
  const mesh = p.proxy
  mesh.geometry = p.template.geometry
  mesh.material = p.template.material
  mesh.scale.set(
    p.part.size[0] / size.x,
    p.part.size[1] / size.y,
    -p.part.size[2] / size.z,
  )
  mesh.position.set(
    -center.x * mesh.scale.x,
    -(p.part.axle ? center.y : box.min.y) * mesh.scale.y,
    -center.z * mesh.scale.z,
  )
}

export async function assemble(
  water: ShaderMaterial,
  onProgress: (ready: number, total: number) => void,
) {
  const cache = modelCache(water),
    saved = savedLayers()
  const groups = new Map<string, Group>(),
    rotors: Group[] = [],
    placements: Placement[] = []
  const root = new Group(),
    batches = new Map<string, Batch>()
  const reflect = new Matrix4().makeScale(1, 1, -1),
    matrix = new Matrix4()
  const requested = new Set<string>(),
    ready = new Set<string>()
  const initial: Promise<void>[] = []
  for (const item of exhibits) {
    const group = new Group()
    groups.set(item.id, group)
    group.name = item.id
    group.position.set(item.at[0], 0, item.at[1])
    group.rotation.y = item.yaw
    const ordinals = new Map<string, number>()
    for (const part of item.parts) {
      const ordinal = (ordinals.get(part.id) ?? 0) + 1
      ordinals.set(part.id, ordinal)
      const key = item.id + '/' + part.id + '/' + ordinal
      const entry = saved[key]
      const count = typeof entry === 'number' ? entry : entry?.layers
      const layers = modelSettings(part.id).meshMethod !== 'contour' && valid(count)
        ? count : modelSettings(part.id).layers
      const projection = typeof entry === 'object' && isProjectionChoice(entry?.projection)
        ? entry.projection : 'asset'
      const mount = new Group()
      mount.name = part.id
      mount.position.set(...part.at)
      mount.rotation.set(part.pitch ?? 0, part.yaw ?? 0, 0)
      group.add(mount)
      if (part.axle) rotors.push(mount)
      requested.add(part.id + '/' + layers + (projection === 'asset' ? '' : '/' + projection))
      initial.push(
        cache.get(part.id, layers, projection).then((template) => {
          if (!ready.has(template.key)) {
            ready.add(template.key)
            onProgress(ready.size, requested.size)
          }
          const proxy = new Mesh(template.geometry, template.material)
          mount.add(proxy)
          const placement = {
            item,
            part,
            key,
            ordinal,
            layers,
            projection,
            version: 0,
            template,
            proxy,
            mount,
          }
          fit(placement)
          placements.push(placement)
        }),
      )
    }
  }
  await Promise.all(initial)
  // Consistent keyboard/inspector order, regardless of asynchronous build order.
  placements.sort(
    (a, b) =>
      exhibits.indexOf(a.item) - exhibits.indexOf(b.item) ||
      a.item.parts.indexOf(a.part) - b.item.parts.indexOf(b.part),
  )
  const capacity = new Map<string, number>()
  for (const p of placements)
    capacity.set(p.part.id, (capacity.get(p.part.id) ?? 0) + 1)
  function updateMatrix(p: Placement, batch: Batch, index: number) {
    p.proxy.updateWorldMatrix(true, false)
    // All source models face -Z. Put the common reflection on the draw object,
    // so each per-instance matrix passed to Three.js has positive determinant.
    matrix.multiplyMatrices(reflect, p.proxy.matrixWorld)
    batch.object.setMatrixAt(index, matrix)
  }
  function sync() {
    for (const batch of batches.values()) batch.members = []
    for (const p of placements) {
      if (!groups.get(p.item.id)!.visible) continue
      let batch = batches.get(p.template.key)
      if (!batch) {
        const object = new InstancedMesh(
          p.template.geometry,
          p.template.material,
          capacity.get(p.part.id)!,
        )
        object.scale.z = -1
        object.name = p.template.key
        root.add(object)
        batch = { object, members: [] }
        batches.set(p.template.key, batch)
      }
      updateMatrix(p, batch, batch.members.length)
      batch.members.push(p)
    }
    for (const [key, batch] of batches) {
      if (!batch.members.length) {
        root.remove(batch.object)
        batch.object.dispose()
        batches.delete(key)
        continue
      }
      batch.object.count = batch.members.length
      batch.object.instanceMatrix.needsUpdate = true
      batch.object.computeBoundingSphere()
    }
    root.updateMatrixWorld(true)
  }
  function animate() {
    for (const p of placements)
      if (p.part.axle && groups.get(p.item.id)!.visible) {
        const batch = batches.get(p.template.key)!
        updateMatrix(p, batch, batch.members.indexOf(p))
        batch.object.instanceMatrix.needsUpdate = true
        batch.object.computeBoundingSphere()
      }
  }
  async function edit(p: Placement, layers: number, projection: ProjectionChoice = p.projection) {
    if (!valid(layers)) throw new Error('레이어는 8~128 정수로 입력하세요.')
    const version = ++p.version
    if (layers === p.layers && projection === p.projection) return
    const template = await cache.get(p.part.id, layers, projection)
    if (p.version !== version) {
      cache.release(template)
      return
    }
    const old = p.template
    p.template = template
    p.layers = layers
    p.projection = projection
    fit(p)
    sync()
    cache.release(old)
    const next = savedLayers()
    if (layers === modelSettings(p.part.id).layers && projection === 'asset') delete next[p.key]
    else next[p.key] = projection === 'asset' ? layers : { layers, projection }
    try {
      localStorage.setItem(savedKey, JSON.stringify(next))
    } catch {
      /* private browsing may be session only */
    }
  }
  sync()
  return {
    root,
    groups,
    rotors,
    placements,
    sync,
    animate,
    edit,
    stats: cache.stats,
    modelCount: capacity.size,
    lookup: (object: Mesh, index: number) =>
      batches.get(object.name)?.members[index],
    batchInfo: () =>
      [...batches.values()].map((b) => ({
        key: b.object.name,
        count: b.object.count,
      })),
  }
}
