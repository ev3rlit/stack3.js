import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crop, type Raster } from '@stack3/core'

const work = join(tmpdir(), 'petite-town-views')
const records: Record<
  string,
  {
    kind: string
    acceptedElevations?: string
    acceptedAtlas?: string
    acceptedLeft?: string | false
    acceptedTop?: string
    preservePanelScale?: boolean
    topQuarterTurns?: number
  }
> = JSON.parse(await readFile('originals/generation.json', 'utf8'))
const preview = process.argv.includes('--preview'),
  selected = process.argv.slice(2).filter((x) => x !== '--preview')
const dimensions = JSON.parse(
  await readFile('verification/view-dimensions.json', 'utf8').catch(() => '{}'),
)
await Promise.all([work,'atlases','verification'].map(dir=>mkdir(dir,{recursive:true})))
function pixels(v: Raster) {
  return sharp(v.data, {
    raw: { width: v.width, height: v.height, channels: 4 },
  })
}
async function raster(s: sharp.Sharp): Promise<Raster> {
  const { data, info } = await s
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
function trim(v: Raster, left = 0, right = v.width) {
  let x0 = right,
    y0 = v.height,
    x1 = -1,
    y1 = -1
  for (let y = 0; y < v.height; y++)
    for (let x = left; x < right; x++)
      if (v.data[(y * v.width + x) * 4 + 3] >= 128) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  if (x1 < x0) throw new Error('Empty panel')
  return crop(v, { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
}
function split(v: Raster, count = 4) {
  const gaps: { start: number; width: number }[] = []
  let start = 0
  for (let x = 0; x < v.width; x++) {
    let count = 0
    for (let y = 0; y < v.height && count < 2; y++)
      if (v.data[(y * v.width + x) * 4 + 3] >= 128) count++
    if (count < 2) continue
    if (start > 0 && x - start >= 3) gaps.push({ start, width: x - start })
    start = x + 1
  }
  const cuts = gaps
    .sort((a, b) => b.width - a.width)
    .slice(0, count - 1)
    .map((g) => g.start + Math.floor(g.width / 2))
    .sort((a, b) => a - b)
  if (cuts.length !== count - 1) throw new Error(`Expected ${count} atlas panels`)
  return [...cuts, v.width].map((right, i) =>
    trim(v, i ? cuts[i - 1] : 0, right),
  )
}
function round(n: number) {
  const base = Math.floor(n)
  return n - base === 0.5 ? base + (base % 2) : Math.round(n)
}
async function resize(v: Raster, scale: number) {
  return raster(
    pixels(v).resize(
      Math.max(1, round(v.width * scale)),
      Math.max(1, round(v.height * scale)),
      { fit: 'fill', kernel: 'lanczos3' },
    ),
  )
}
function sheet(
  width: number,
  height: number,
  parts: { v: Raster; x: number; y: number }[],
) {
  const data = Buffer.alloc(width * height * 4)
  for (const { v, x, y } of parts)
    for (let row = 0; row < v.height; row++)
      data.set(
        v.data.subarray(row * v.width * 4, (row + 1) * v.width * 4),
        ((y + row) * width + x) * 4,
      )
  return pixels({ width, height, data }).png()
}
for (const id of selected)
  if (records[id]?.kind !== 'four-view') throw new Error('Unknown atlas: ' + id)
for (const [id, rec] of Object.entries(records)) {
  if (rec.kind !== 'four-view' || (selected.length && !selected.includes(id)))
    continue
  const src = rec.acceptedAtlas ?? id + '.png',
    im = await raster(sharp('originals/' + src))
  const panels = split(im)
  if (rec.topQuarterTurns === 1)
    panels[0] = await raster(pixels(panels[0]).rotate(270))
  const originalPanels = panels.slice()
  if (rec.acceptedElevations) {
    const elevations = await raster(sharp('originals/' + rec.acceptedElevations))
    panels.splice(1, 3, ...split(elevations, 3))
  }
  if (preview) {
    const dirs = ['top', 'left', 'front', 'rear']
    for (const [i, v] of panels.entries())
      await pixels(v)
        .png()
        .toFile(join(work, id + '-' + dirs[i] + '.png'))
    let x = 16
    const h = Math.max(...panels.slice(1).map((v) => v.height)) + 32
    const parts = panels.slice(1).map((v) => {
      const at = { v, x, y: h - 16 - v.height }
      x += v.width + 16
      return at
    })
    await sheet(x, h, parts).toFile(join(work, id + '-elevations.png'))
    continue
  }
  const suffix = ['rotor', 'well-roof'].includes(id)
    ? 'final'
    : id === 'fence'
      ? 'strict'
      : 'plan'
  const top = rec.acceptedTop ?? id + '-' + suffix + '.png',
    left = rec.acceptedLeft ?? id + '-left.png'
  const topReplaced =
      (!!rec.acceptedTop || !rec.acceptedAtlas) &&
      existsSync('originals/' + top),
    leftReplaced = left !== false && existsSync('originals/' + left)
  if (topReplaced) panels[0] = trim(await raster(sharp('originals/' + top)))
  if (leftReplaced) panels[1] = trim(await raster(sharp('originals/' + left)))
  if (!leftReplaced && ['bakery', 'apple-stall', 'awning'].includes(id))
    panels[1] = await raster(pixels(panels[1]).flop())
  // A local camera correction keeps the pixel scale of every accepted sibling.
  const basis = rec.preservePanelScale ? originalPanels : panels
  const h = basis
    .slice(1)
    .map((v) => v.height)
    .sort((a, b) => a - b)[1]
  const scales = basis.map((v) => h / v.height)
  const width = (basis[2].width * scales[2] + basis[3].width * scales[3]) / 2
  scales[0] = Math.sqrt(
    ((width / basis[0].width) * basis[1].width * scales[1]) /
      basis[0].height,
  )
  const maxFitted = Math.max(...basis.map((v, i) =>
    Math.max(round(v.width * scales[i]), round(v.height * scales[i]))))
  const shrink = Math.min(1, 448 / maxFitted)
  if (rec.preservePanelScale) {
    scales[0] *= basis[0].width / panels[0].width
    if (rec.acceptedElevations) {
      // Removing camera tilt changes apparent height. Register by horizontal diameter.
      for (const i of [1, 2, 3]) scales[i] *= basis[i].width / panels[i].width
    } else {
      scales[1] *= basis[1].height / panels[1].height
    }
  }
  const fitted = await Promise.all(panels.map((v, i) => resize(v, scales[i])))
  const views = await Promise.all(fitted.map((v) => resize(v, shrink)))
  const cell = Math.max(...views.map((v) => v.width)) + 32,
    height = Math.max(...views.map((v) => v.height)) + 32
  const path = 'atlases/' + id + '.png',
    temp = path + '.' + process.pid + '.tmp'
  await sheet(
    4 * cell,
    height,
    views.map((v, i) => ({
      v,
      x: cell * i + Math.floor((cell - v.width) / 2),
      y: height - 16 - v.height,
    })),
  ).toFile(temp)
  await rename(temp, path)
  dimensions[id] = {
    original: [im.width, im.height],
    nativeViews: panels.map((v) => [v.width, v.height]),
    uniformScale: scales.map((s) => Number((s * shrink).toFixed(5))),
    deliveredViews: views.map((v) => [v.width, v.height]),
    baseline: height - 16,
    topSource: topReplaced ? top : src,
    topReplaced,
    leftReplaced: leftReplaced || Boolean(rec.acceptedElevations),
    ...(rec.acceptedElevations ? { elevationSource: rec.acceptedElevations } : {}),
  }
  console.log(id)
}
if (!preview)
  await writeFile(
    'verification/view-dimensions.json',
    JSON.stringify(dimensions, null, 2) + '\n',
  )
