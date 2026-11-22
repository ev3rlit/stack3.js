import { buildModel } from './build-model'
import { modelSettings, type ProjectionChoice } from './model-settings'

declare const __BUILDER_HASH__: string
const storeName = 'petite-town-meshes'
interface Request {
  ticket: number
  id: string
  layers: number
  projection: ProjectionChoice
  url: string
}
async function build({ ticket, id, layers, projection, url }: Request) {
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(id + ' 아틀라스를 읽지 못했습니다 (' + res.status + ')')
  const bytes = new Uint8Array(await res.arrayBuffer())
  const settings = modelSettings(id)
  let cache: Cache | undefined,
    key = ''
  // HTTP on a phone may not provide secure-context storage. The session cache still works.
  try {
    if (self.crypto.subtle && 'caches' in self) {
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (v) => v.toString(16).padStart(2, '0'),
      ).join('')
      key = new URL(
        '__mesh__/' +
          [
            __BUILDER_HASH__,
            hash,
            id,
            settings.profile,
            settings.resolution,
            projection,
            layers,
          ].join('/'),
        self.location.origin,
      ).href
      cache = await caches.open(storeName)
      const hit = await cache.match(key)
      if (hit) {
        const buffer = await hit.arrayBuffer()
        send(ticket, buffer, 'disk')
        return
      }
    }
  } catch {
    cache = undefined
  }
  const { glb } = buildModel(id, bytes, layers, projection)
  const buffer = glb.buffer as ArrayBuffer
  if (cache)
    try {
      await cache.put(key, new Response(buffer))
      const keys = await cache.keys()
      for (const old of keys.slice(0, Math.max(0, keys.length - 64)))
        await cache.delete(old)
    } catch {
      /* A full or disabled disk cache does not interrupt the edit. */
    }
  send(ticket, buffer, 'built')
}
function send(ticket: number, buffer: ArrayBuffer, origin: string) {
  self.postMessage({ ticket, buffer, origin }, { transfer: [buffer] })
}
self.onmessage = ({ data }: MessageEvent<Request>) => {
  build(data).catch((e) =>
    self.postMessage({ ticket: data.ticket, error: String(e) }),
  )
}
