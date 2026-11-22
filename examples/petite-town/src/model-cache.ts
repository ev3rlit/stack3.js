import {
  Mesh,
  type BufferGeometry,
  type Material,
  type Texture,
  type ShaderMaterial,
  Vector3,
} from 'three'
import ModelWorker from './model.worker?worker&inline'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const urls = import.meta.glob('../atlases/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
export type Template = {
  geometry: BufferGeometry
  material: Material
  key: string
}
type Reply = {
  ticket: number
  buffer: ArrayBuffer
  origin: 'built' | 'disk'
  error?: string
}
export function modelCache(water: ShaderMaterial) {
  let worker: Worker | undefined,
    ticket = 0
  const waiting = new Map<
    number,
    { resolve: (r: Reply) => void; reject: (error: Error) => void }
  >()
  const entries = new Map<string, Promise<Template>>()
  const references = new Map<string, number>()
  const idle = new Map<string, Template>()
  const loader = new GLTFLoader()
  const stats = { built: 0, disk: 0, memory: 0 }
  function request(id: string, layers: number) {
    if (!worker) {
      worker = new ModelWorker()
      worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        const task = waiting.get(data.ticket)
        waiting.delete(data.ticket)
        if (data.error) task?.reject(new Error(data.error))
        else task?.resolve(data)
      }
      worker.onerror = (e) => {
        for (const task of waiting.values()) task.reject(new Error(e.message))
        waiting.clear()
        worker?.terminate()
        worker = undefined
      }
    }
    const url = urls['../atlases/' + id + '.png']
    if (!url) throw new Error('아틀라스 누락 · ' + id)
    return new Promise<Reply>((resolve, reject) => {
      waiting.set(++ticket, { resolve, reject })
      worker!.postMessage({
        ticket,
        id,
        layers,
        url: new URL(url, document.baseURI).href,
      })
    })
  }
  async function load(
    id: string,
    layers: number,
    key: string,
  ): Promise<Template> {
    const reply = await request(id, layers)
    stats[reply.origin]++
    const gltf = await loader.parseAsync(reply.buffer, '')
    const mesh = gltf.scene.children[0] as Mesh
    mesh.geometry.computeBoundingBox()
    let material = mesh.material as Material
    if (id === 'water') {
      const box = mesh.geometry.boundingBox!,
        center = box.getCenter(new Vector3()),
        size = box.getSize(new Vector3())
      disposeMaterial(material)
      const shader = water.clone()
      shader.uniforms.time = water.uniforms.time
      shader.uniforms.wellBounds.value.set(
        center.x,
        center.z,
        2 / size.x,
        2 / size.z,
      )
      material = shader
    }
    return { key, geometry: mesh.geometry, material }
  }
  function disposeMaterial(mat: Material) {
    const map = (mat as Material & { map?: Texture }).map
    const image = map?.source.data
    map?.dispose()
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
      image.close()
    mat.dispose()
  }
  function get(id: string, layers: number) {
    const key = id + '/' + layers
    references.set(key, (references.get(key) ?? 0) + 1)
    const found = entries.get(key)
    if (found) {
      stats.memory++
      idle.delete(key)
      return found
    }
    const pending = load(id, layers, key).catch((e) => {
      entries.delete(key)
      references.delete(key)
      throw e
    })
    entries.set(key, pending)
    return pending
  }
  // Only unreferenced variants are evicted. Live instances and in-flight edits keep their templates.
  function release(t: Template) {
    const count = (references.get(t.key) ?? 1) - 1
    if (count) {
      references.set(t.key, count)
      return
    }
    references.delete(t.key)
    idle.set(t.key, t)
    if (idle.size > 6) {
      const oldest = idle.values().next().value!
      idle.delete(oldest.key)
      entries.delete(oldest.key)
      oldest.geometry.dispose()
      disposeMaterial(oldest.material)
    }
  }
  return { get, release, stats }
}
