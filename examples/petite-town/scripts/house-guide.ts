// Render the source sheets alongside the actual town meshes and their authored mounts.
import { OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { assemble } from '../src/town-instances'
import { createWater } from '../src/water'

const atlases = import.meta.glob('../atlases/house*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const parts: Record<string, [string, number, number, number]> = {
  house: ['House shell', 0, 0, 0],
  'house-roof': ['Roof', 0, .94, 0],
  'house-chimney': ['Chimney', -.29, 1.5, -.1],
  'house-door': ['Front door', 0, 0, .85],
  'house-lantern': ['Wall lantern', -.34, .16, .66],
  'house-window-flowers': ['Flower window', -.78, 0, 0],
  'house-window': ['Plain window', .78, 0, 0],
}

async function prepare() {
  const town = await assemble(createWater().well, () => {})
  const house = town.groups.get('house')!.clone()
  house.position.set(0, 0, 0)
  house.rotation.set(0, 0, 0)
  const mounts = house.children.map(object => {
    const [label, x, y, z] = parts[object.name]
    return { object, rest: object.position.clone(), offset: new Vector3(x, y, z), label }
  })
  const scene = new Scene()
  scene.add(house)
  const renderer = new WebGLRenderer({ antialias: true })
  const paper = '#fbf8f0'
  renderer.setClearColor(paper)
  const width = 1140, height = 108 + mounts.length * 76, previewWidth = 488
  renderer.setSize(previewWidth, height - 68, false)
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 40)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#304f45'
  ctx.font = 'bold 27px Arial, sans-serif'
  ctx.fillText('4-view atlases', 20, 38)
  ctx.fillText('Assembled house', 664, 38)
  ctx.font = 'bold 15px Arial, sans-serif'
  ctx.textAlign = 'center'
  const columns = [188, 303, 418, 533]
  for (const [i, label] of ['TOP', 'LEFT', 'FRONT', 'REAR'].entries()) ctx.fillText(label, columns[i], 78)
  ctx.textAlign = 'left'
  for (const [i, { object, label }] of mounts.entries()) {
    const image = new Image()
    image.src = atlases['../atlases/' + object.name + '.png']
    await image.decode()
    const cell = image.width / 4, scale = Math.min(113 / cell, 73 / image.height)
    const y = 87 + i * 76
    ctx.fillStyle = '#e1dccc'
    ctx.fillRect(20, y, 568, 1)
    ctx.fillStyle = '#324b43'
    ctx.font = 'bold 17px Arial, sans-serif'
    ctx.fillText(label, 20, y + 44)
    for (const [j, x] of columns.entries()) {
      ctx.drawImage(image, j * cell, 0, cell, image.height, x - cell * scale / 2,
        y + (76 - image.height * scale) / 2, cell * scale, image.height * scale)
    }
  }
  ctx.strokeStyle = '#7e8b7d'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(600, height / 2); ctx.lineTo(631, height / 2)
  ctx.moveTo(620, height / 2 - 8); ctx.lineTo(631, height / 2); ctx.lineTo(620, height / 2 + 8)
  ctx.stroke()
  const frameCount = 80
  return { width, height, frameCount, frame(index: number) {
    const t = index / frameCount
    const spread = t < .5 ? Math.sin(Math.PI * 2 * t) ** 2 : 0
    const orbit = Math.max(0, 2 * t - 1)
    const yaw = -.66 + Math.PI * 2 * orbit
    for (const { object, rest, offset } of mounts) object.position.copy(rest).addScaledVector(offset, spread)
    camera.top = 1.76 + .72 * spread
    camera.bottom = -camera.top
    camera.right = camera.top * previewWidth / (height - 68)
    camera.left = -camera.right
    camera.updateProjectionMatrix()
    const targetY = 1.34 + .53 * spread
    camera.position.set(8 * Math.sin(yaw), targetY + 3.15, 8 * Math.cos(yaw))
    camera.lookAt(0, targetY, 0)
    renderer.render(scene, camera)
    ctx.drawImage(renderer.domElement, width - previewWidth, 68)
    return canvas.toDataURL('image/png').split(',')[1]
  } }
}
declare global { interface Window { houseGuide: ReturnType<typeof prepare> } }
window.houseGuide = prepare()
