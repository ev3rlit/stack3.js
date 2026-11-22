// Browser-only capture entry. Use the same atlas builder, placements and shaders as the demo.
import { Box3, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { exhibits } from '../src/assemblies'
import { makeTerrain } from '../src/terrain'
import { assemble } from '../src/town-instances'
import { createWater } from '../src/water'

import { exhibitNames as names } from '../src/exhibit-names'
const paper = '#f5f0e4'
const ink = '#304f45'
const line = '#dacfb9'
const pixelRatio = new URLSearchParams(location.search).has('video') ? 2 : 1
const turnFrames = 72
const townFrames = turnFrames * 2
const periodMs = 17142

function surface(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width * pixelRatio
  canvas.height = height * pixelRatio
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.scale(pixelRatio, pixelRatio)
  ctx.imageSmoothingQuality = 'high'
  return ctx
}
const png = (ctx: CanvasRenderingContext2D) => ctx.canvas.toDataURL('image/png').split(',')[1]

async function prepare() {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setClearColor(paper)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(896, 600, false)
  renderer.setScissorTest(true)
  const water = createWater()
  const town = await assemble(water.well, () => {})
  const village = new Scene()
  village.add(makeTerrain(water.creek), town.root)
  const fixed = new OrthographicCamera(-6.25, 6.25, 6.25, -6.25, .05, 80)
  fixed.position.set(3.4, 14.9, 15.6)
  fixed.lookAt(.16, .33, -.22)

  const camera = new OrthographicCamera(-1, 1, 1, -1, .05, 80)
  const elevation = .36
  const assets = exhibits.map(({ id }) => {
    if (!names[id]) throw new Error('Missing gallery label for ' + id)
    const group = town.groups.get(id)!.clone()
    group.position.set(0, 0, 0)
    group.rotation.set(0, 0, 0)
    const scene = new Scene()
    scene.add(group)
    const box = new Box3().setFromObject(group)
    const size = box.getSize(new Vector3())
    const diameter = Math.hypot(size.x, size.z)
    const half = .54 * Math.max(diameter * 200 / 224, Math.cos(elevation) * size.y + Math.sin(elevation) * diameter)
    return { id, scene, half, center: box.getCenter(new Vector3()) }
  })

  const gallery = surface(896, Math.ceil(assets.length / 4) * 230)
  const city = surface(540, 540)
  const hero = surface(1100, 508)

  function drawGallery(index: number) {
    water.time.value = 2
    gallery.fillStyle = paper
    gallery.fillRect(0, 0, gallery.canvas.width, gallery.canvas.height)
    for (const [i, { id, scene, half, center }] of assets.entries()) {
      const col = i % 4, row = Math.floor(i / 4)
      const yaw = (id === 'bridge' ? 1.2 : .62) + Math.PI * 2 * index / turnFrames
      camera.top = half
      camera.bottom = -half
      camera.right = half * 224 / 200
      camera.left = -camera.right
      camera.updateProjectionMatrix()
      camera.position.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation))
        .multiplyScalar(18).add(center)
      camera.lookAt(center)
      renderer.setScissor(0, 0, 224, 200)
      renderer.setViewport(0, 0, 224, 200)
      renderer.render(scene, camera)
      const x = col * 224, y = row * 230
      gallery.drawImage(renderer.domElement, 0, 400 * pixelRatio, 224 * pixelRatio, 200 * pixelRatio, x, y, 224, 200)
      gallery.fillStyle = ink
      gallery.font = 'bold 16px Arial, sans-serif'
      gallery.textAlign = 'center'
      gallery.fillText(names[id], x + 112, y + 216)
      gallery.fillStyle = line
      if (col) gallery.fillRect(x, y + 10, 1, 210)
      if (row) gallery.fillRect(x + 8, y, 208, 1)
    }
  }
  function drawVillage(index: number) {
    const phase = index / townFrames
    for (const rotor of town.rotors) rotor.rotation.z = -Math.PI * 2 * phase
    town.animate()
    renderer.setScissor(0, 0, 540, 540)
    renderer.setViewport(0, 0, 540, 540)
    const time = phase * periodMs / 1000
    function paint(seconds: number) {
      water.time.value = seconds + 2
      renderer.render(village, fixed)
      city.drawImage(renderer.domElement, 0, 60 * pixelRatio, 540 * pixelRatio, 540 * pixelRatio, 0, 0, 540, 540)
    }
    paint(time)
    // The water shader has several periods. Crossfade its phase over the final 1.5 seconds.
    const u = (time - periodMs / 1000 + 1.5) / 1.5
    if (u > 0) {
      city.globalAlpha = u * u * (3 - 2 * u)
      paint(time - periodMs / 1000)
      city.globalAlpha = 1
    }
  }
  function compose() {
    hero.fillStyle = paper
    hero.fillRect(0, 0, 1100, 508)
    hero.drawImage(city.canvas, 15 * pixelRatio, 16 * pixelRatio, 510 * pixelRatio, 510 * pixelRatio, 3, 47, 453, 453)
    const scale = Math.min(628 / gallery.canvas.width, 449 / gallery.canvas.height)
    const width = Math.round(scale * gallery.canvas.width)
    hero.drawImage(gallery.canvas, 469 + Math.floor((628 - width) / 2), 52, width, Math.round(scale * gallery.canvas.height))
    hero.fillStyle = line
    hero.fillRect(459, 18, 1, 470)
    hero.fillStyle = ink
    hero.font = 'bold 27px Arial, sans-serif'
    hero.fillText('Petite Town', 23, 35)
    hero.font = 'bold 22px Arial, sans-serif'
    hero.fillText(assets.length === 12 ? 'Twelve Village Assets' : assets.length + ' Village Assets', 490, 35)
  }
  return {
    turnFrames, periodMs, assetCount: assets.length,
    videoFrame(phase: number) {
      drawGallery(phase * townFrames)
      drawVillage(phase * townFrames)
      compose()
      return hero.canvas.toDataURL('image/jpeg', .97).split(',')[1]
    },
    frames(index: number) {
      drawGallery(index)
      // The right panel turns twice per village loop; render each gallery angle once.
      const views = [index, index + turnFrames].map(i => {
        drawVillage(i)
        compose()
        return { village: png(city), showcase: png(hero) }
      })
      return { gallery: png(gallery), views }
    },
  }
}
export type Showcase = Awaited<ReturnType<typeof prepare>>
declare global { interface Window { showcase: ReturnType<typeof prepare> } }
window.showcase = prepare()
