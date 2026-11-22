import './style.css'
import {
  Box3,
  OrthographicCamera,
  Scene,
  Spherical,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { exhibits } from './assemblies'
import { assemble } from './town-instances'
import { layerEditor } from './layer-editor'
import { makeTerrain } from './terrain'
import { createWater } from './water'

const canvas = document.querySelector('canvas')!,
  status = document.querySelector<HTMLParagraphElement>('#status')!
const guide = document.querySelector<HTMLSelectElement>('#guide')!
async function start() {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new Scene(),
    camera = new OrthographicCamera(-5, 5, 5, -5, 0.05, 80)
  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)')
    .matches
  controls.dampingFactor = 0.16
  controls.minPolarAngle = 0.24
  controls.maxPolarAngle = Math.PI * 0.475
  controls.minZoom = 0.75
  controls.maxZoom = 18
  controls.rotateSpeed = 0.8
  controls.zoomSpeed = 1.0
  const water = createWater()
  const terrain = makeTerrain(water.creek)
  scene.add(terrain)
  const town = await assemble(water.well, (ready, total) => {
    status.textContent = '마을 준비 중 · ' + ready + ' / ' + total
  })
  const { groups, rotors, modelCount } = town
  scene.add(town.root)
  for (const item of exhibits) {
    guide.add(new Option(item.name, item.id))
  }
  let dirty = true
  controls.addEventListener('change', () => {
    dirty = true
  })
  const editor = layerEditor(town, camera, canvas, terrain, () => {
    dirty = true
  })
  function resize() {
    dirty = true
    const w = canvas.clientWidth,
      h = canvas.clientHeight
    const half = Math.max(5, (5 * h) / w)
    camera.left = (-half * w) / h
    camera.right = -camera.left
    camera.top = half
    camera.bottom = -half
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }
  function zoom(multiplier: number) {
    dirty = true
    camera.zoom = Math.min(
      controls.maxZoom,
      Math.max(controls.minZoom, camera.zoom * multiplier),
    )
    camera.updateProjectionMatrix()
  }
  function select(id: string) {
    dirty = true
    controls.reset()
    const group = groups.get(id)
    for (const [key, object] of groups) object.visible = !group || key === id
    terrain.visible = !group
    town.sync()
    editor.onFocus(id)
    if (group) {
      const box = new Box3().setFromObject(group),
        size = box.getSize(new Vector3())
      box.getCenter(controls.target)
      const heading =
        exhibits.find((item) => item.id === id)!.yaw +
        (id === 'bridge' ? 1.25 : 0.35)
      camera.position
        .copy(controls.target)
        .add(new Vector3(Math.sin(heading) * 13, 6.8, Math.cos(heading) * 13))
      camera.zoom = Math.min(
        controls.maxZoom,
        0.72 *
          Math.min(
            (camera.right - camera.left) / Math.hypot(size.x, size.z),
            (camera.top - camera.bottom) / (size.y + 0.5 * size.z),
          ),
      )
    } else {
      controls.target.set(0.16, 0.33, -0.22)
      camera.position.set(3.4, 14.9, 15.6)
      camera.zoom = 1
    }
    guide.value = id
    camera.updateProjectionMatrix()
    controls.update()
    camera.updateMatrixWorld()
  }
  resize()
  select('')
  controls.saveState()
  new ResizeObserver(resize).observe(canvas)
  guide.disabled = false
  guide.onchange = () => select(guide.value)
  document.querySelector('#home')!.addEventListener('click', () => select(''))
  document.querySelector('#in')!.addEventListener('click', () => zoom(1.25))
  document.querySelector('#out')!.addEventListener('click', () => zoom(0.8))
  canvas.onkeydown = (e) => {
    if (e.key === '+' || e.key === '=') zoom(1.2)
    else if (e.key === '-') zoom(1 / 1.2)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const s = new Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      )
      s.theta += ((e.key === 'ArrowLeft' ? -1 : 1) * Math.PI) / 12
      camera.position.setFromSpherical(s).add(controls.target)
    } else return
    e.preventDefault()
    controls.update()
  }
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let previous = performance.now()
  status.hidden = true
  canvas.dataset.items = String(groups.size)
  canvas.dataset.models = String(modelCount)
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - previous) / 1000, 0.07)
    previous = now
    const moving = !motion.matches && rotors.some((r) => r.parent?.visible)
    if (moving) {
      for (const rotor of rotors) rotor.rotation.z -= dt * 0.45
      town.animate()
    }
    const flowing =
      !motion.matches && (terrain.visible || guide.value === 'well')
    if (flowing) water.time.value += dt
    controls.update()
    if (dirty || moving || flowing) {
      renderer.render(scene, camera)
      dirty = false
    }
  })
  if (new URLSearchParams(location.search).has('inspect')) {
    // Read-only diagnostics for checking the actual scene after pointer input.
    Object.assign(window, {
      inspectTown: () => ({
        angle: controls.getAzimuthalAngle(),
        zoom: camera.zoom,
        rotor: rotors[0].rotation.z,
        models: modelCount,
        cache: { ...town.stats },
        batches: town.batchInfo(),
        selected: editor.selection(),
        meshes: town.placements.map((p) => ({
          item: p.item.id,
          part: p.part.id,
          key: p.key,
          layers: p.layers,
          projection: p.projection,
          matrix: p.proxy.matrixWorld.toArray(),
          screen: p.proxy.geometry
            .boundingBox!.getCenter(new Vector3())
            .applyMatrix4(p.proxy.matrixWorld)
            .project(camera)
            .toArray(),
        })),
        groups: [...groups].map(([id, g]) => ({
          id,
          parts: g.children.map((c) => c.name),
          bounds: new Box3().setFromObject(g),
        })),
        triangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
      }),
    })
  }
}
start().catch((err) => {
  status.hidden = false
  status.textContent =
    '마을을 열 수 없습니다 · ' +
    (err instanceof Error ? err.message : String(err))
  console.error(err)
})
