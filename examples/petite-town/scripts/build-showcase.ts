import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium, type Browser } from 'playwright-core'
import sharp from 'sharp'
import { build, preview, type PreviewServer } from 'vite'
import type {} from './showcase-scene'
import type {} from './house-guide'

const houseGuide = process.argv.includes('--house-guide')
const video = process.argv.includes('--video')
if (video) execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
const root = fileURLToPath(new URL('../', import.meta.url))
const media = fileURLToPath(new URL('../../../docs/media/petite-town/', import.meta.url))
await mkdir(media, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'petite-town-showcase-'))
const staged = await mkdtemp(join(media, '.showcase-'))
let server: PreviewServer | undefined
let browser: Browser | undefined
try {
  await build({
    root, logLevel: 'error',
    build: {
      outDir: work, emptyOutDir: false,
      rollupOptions: { input: join(root, houseGuide ? 'scripts/house-guide.ts' : 'scripts/showcase-scene.ts'), output: { entryFileNames: 'capture.js' } },
    },
  })
  await writeFile(join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="./capture.js"></script>')
  server = await preview({ root, logLevel: 'error', build: { outDir: work }, preview: { host: '127.0.0.1', port: 0, open: false } })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing preview port')
  browser = await chromium.launch({
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }),
    args: video ? ['--enable-unsafe-swiftshader'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', res => { if (res.status() >= 400) errors.push(res.status() + ' ' + res.url()) })
  await page.goto('http://127.0.0.1:' + address.port + (video ? '/?video' : '/'))
  const outputs: [string, Buffer[], number, number][] = []
  let frameMs = 0
  if (video) {
    await page.waitForFunction(() => !!window.showcase)
    const fps = 30
    const duration = await page.evaluate(async () => (await window.showcase).periodMs)
    const count = Math.round(duration * fps / 1000)
    for (let i = 0; i < count; i++) {
      const frame = await page.evaluate(async phase => (await window.showcase).videoFrame(phase), i / count)
      await writeFile(join(work, `frame-${String(i).padStart(4, '0')}.jpg`), Buffer.from(frame, 'base64'))
      if ((i + 1) % 60 === 0) console.log(`Rendered ${i + 1}/${count} video frames`)
    }
    execFileSync('ffmpeg', ['-v', 'error', '-framerate', String(fps), '-i', join(work, 'frame-%04d.jpg'),
      '-vf', 'scale=1920:-2:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf5f0e4,setsar=1',
      '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      join(staged, 'showcase.mp4')], { stdio: 'inherit' })
  } else if (houseGuide) {
    await page.waitForFunction(() => !!window.houseGuide)
    const { width, height, frameCount } = await page.evaluate(async () => {
      const { width, height, frameCount } = await window.houseGuide
      return { width, height, frameCount }
    })
    const frames: Buffer[] = []
    for (let i = 0; i < frameCount; i++) {
      frames.push(Buffer.from(await page.evaluate(async i => (await window.houseGuide).frame(i), i), 'base64'))
    }
    outputs.push(['house-atlases-to-mesh.webp', frames, width, height])
    frameMs = 100
  } else {
    await page.waitForFunction(() => !!window.showcase)
    const { turnFrames, periodMs, assetCount } = await page.evaluate(async () => {
      const { turnFrames, periodMs, assetCount } = await window.showcase
      return { turnFrames, periodMs, assetCount }
    })
    const village: Buffer[] = [], gallery: Buffer[] = [], showcase: Buffer[] = []
    for (let i = 0; i < turnFrames; i++) {
      const frame = await page.evaluate(async i => (await window.showcase).frames(i), i)
      gallery[i] = Buffer.from(frame.gallery, 'base64')
      frame.views.forEach((v, half) => {
        village[i + half * turnFrames] = Buffer.from(v.village, 'base64')
        showcase[i + half * turnFrames] = Buffer.from(v.showcase, 'base64')
      })
      if ((i + 1) % 12 === 0) console.log('Rendered gallery angles:', i + 1, '/', turnFrames)
    }
    frameMs = periodMs / (2 * turnFrames)
    outputs.push(
      ['village-view.webp', village, 540, 540],
      ['assets-360.webp', gallery, 896, Math.ceil(assetCount / 4) * 230],
      ['showcase.webp', showcase, 1100, 508],
    )
  }
  if (errors.length) throw new Error(errors.join('\n'))
  await browser.close()
  browser = undefined
  for (const [name, frames, width, height] of outputs) {
    const path = join(staged, name)
    const delay = frames.map((_, i) => Math.round((i + 1) * frameMs) - Math.round(i * frameMs))
    await sharp(frames, { join: { animated: true } }).webp({ quality: 84, effort: 3, loop: 0, delay }).toFile(path)
    const info = await sharp(path, { animated: true }).metadata()
    if (info.width !== width || info.pageHeight !== height || info.pages !== frames.length || info.loop !== 0 ||
        !info.delay || info.delay.some((ms, i) => ms !== delay[i])) throw new Error('Invalid animation: ' + name)
  }
  for (const [name] of outputs) await rename(join(staged, name), join(media, name))
  if (video) {
    await rename(join(staged, 'showcase.mp4'), join(media, 'showcase.mp4'))
    console.log('Updated showcase.mp4')
  } else console.log('Updated', outputs.map(([name]) => name).join(', '))
} finally {
  await browser?.close()
  await server?.close()
  await rm(work, { recursive: true, force: true })
  await rm(staged, { recursive: true, force: true })
}
