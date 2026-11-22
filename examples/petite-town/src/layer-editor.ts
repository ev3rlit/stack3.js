import { tr, exhibitName, onLanguageChange } from './language'
import {
  InstancedMesh,
  Raycaster,
  Vector2,
  type Camera,
  type Object3D,
} from 'three'
import { maxLayers, minLayers, modelSettings, usesTopContour, type ProjectionChoice } from './model-settings'
import type { assemble, Placement } from './town-instances'

type Town = Awaited<ReturnType<typeof assemble>>
const names: Record<string, [string, string]> = {
  'house': ['House shell', '주택 본체'],
  'house-roof': ['Red roof', '빨간 지붕'],
  'house-chimney': ['Chimney', '굴뚝'],
  'house-door': ['Front door', '현관문'],
  'house-lantern': ['Wall lantern', '현관등'],
  'house-window': ['Window', '창문'],
  'house-window-flowers': ['Flower window', '꽃창문'],
  'potion-window': ['Window', '창문'],
  'potion-counter': ['Potion counter', '포션 매대'],
  'potion-ivy': ['Ivy', '담쟁이'],
  'potion-chimney': ['Chimney', '굴뚝'],
  'bakery-shell': ['Bakery shell', '빵집 본체'],
  'potion-shell': ['Potion shop shell', '포션가게 본체'],
  'stone-ring': ['Stone ring', '돌 테두리'],
  'well-roof': ['Well roof', '우물 지붕'],
  'water': ['Water surface', '수면'],
  'post': ['Timber post', '목재 기둥'],
  'pail': ['Bucket', '두레박'],
  'rope': ['Rope', '줄'],
  'bridge-arch': ['Arched deck', '아치 보행판'],
  'bridge-side-frame': ['Side frame', '측면 프레임'],
  'apple': ['Apple', '사과'],
  'crate': ['Crate', '상자'],
  'loaf': ['Loaf', '빵'],
  'basket': ['Basket', '바구니'],
  'counter': ['Counter', '진열판'],
  'bread-sign': ['Bakery sign', '빵집 팻말'],
  'potion-sign': ['Potion sign', '포션 팻말'],
  'bottle': ['Potion bottle', '포션 병'],
  'barrel': ['Oak barrel', '오크통'],
  'wheel': ['Wheel', '바퀴'],
  'cart-body': ['Cart body', '수레 본체'],
  'stall-frame': ['Stall frame', '판매대 본체'],
  'awning': ['Awning', '천막'],
  'flower': ['Flowers', '꽃'],
  'pot': ['Flowerpot', '화분 그릇'],
  'lamp-post': ['Lamp post', '가로등 본체'],
  'flag': ['Flag', '깃발'],
  'mill-body': ['Mill body', '풍차 본체'],
  'rotor': ['Rotor', '풍차 날개'],
  'fence': ['Fence', '울타리'],
  'bakery-roof': ['Bakery roof', '빵집 지붕'],
  'bakery-awning': ['Bakery awning', '빵집 차양'],
  'bakery-window': ['Window', '창문'],
  'bakery-counter': ['Bakery counter', '빵집 매대'],
  'bakery-chimney': ['Chimney', '굴뚝'],
}
export function layerEditor(
  town: Town,
  camera: Camera,
  canvas: HTMLCanvasElement,
  terrain: Object3D,
  redraw: () => void,
) {
  const panel = document.querySelector<HTMLElement>('#layer-editor')!,
    title = document.querySelector('#layer-title')!
  const parts = document.querySelector<HTMLSelectElement>('#layer-part')!,
    slider = document.querySelector<HTMLInputElement>('#layer-count')!
  const projection = document.querySelector<HTMLSelectElement>('#texture-projection')!
  const output = document.querySelector<HTMLOutputElement>('#layer-value')!,
    note = document.querySelector<HTMLElement>('#layer-note')!
  const apply = document.querySelector<HTMLButtonElement>('#layer-apply')!,
    reset = document.querySelector<HTMLButtonElement>('#layer-reset')!
  const openButton = document.querySelector<HTMLButtonElement>('#edit-open')!
  let active: Placement | undefined,
    action = 0
  const label = (p: Placement) =>
    (names[p.part.id] ? tr(...names[p.part.id]) : p.part.id) +
    (town.placements.some(
      (q) => q.item === p.item && q.part.id === p.part.id && q.ordinal > 1,
    )
      ? ' ' + p.ordinal
      : '')
  let message: 'ready' | 'building' | 'error' = 'ready'
  function translate(p: Placement) {
    title.textContent = exhibitName(p.item)
    const peers = town.placements.filter((q) => q.item === p.item)
    parts.replaceChildren(...peers.map((q) => new Option(label(q), q.key)))
    parts.value = p.key
    projection.options[0].textContent = usesTopContour(p.part.id, 'asset')
      ? tr('Part default · Upper contour → TOP', '부품 기본값 · 상단 윤곽 → TOP')
      : tr('Part default', '부품 기본값')
    const settings = modelSettings(p.part.id)
    if (message === 'building') note.textContent = tr('Building mesh…', '메시를 만드는 중…')
    else if (message === 'error') note.textContent = tr('Could not apply changes. Try again.', '변경 사항을 적용하지 못했습니다. 다시 시도하세요.')
    else if (settings.meshMethod === 'contour') note.textContent = tr('Front contour extrusion · Round hub', '정면 윤곽 돌출 · 원형 허브')
    else note.textContent = tr(`Current: ${p.layers} layers · Default: ${settings.layers}`, `현재 ${p.layers}층 · 기본 ${settings.layers}층`)
  }
  onLanguageChange(() => { if (active && !panel.hidden) translate(active) })
  function show(p: Placement) {
    action++
    active = p
    message = 'ready'
    panel.hidden = false
    translate(p)
    slider.value = String(p.layers)
    projection.value = p.projection
    output.value = slider.value
    const settings = modelSettings(p.part.id)
    const def = settings.layers
    slider.disabled = settings.meshMethod === 'contour'
    apply.disabled = true
    reset.disabled = p.layers === def && p.projection === 'asset'
  }
  function hide() {
    action++
    active = undefined
    panel.hidden = true
  }
  async function change(n: number, rule: ProjectionChoice) {
    if (!active) return
    const p = active,
      serial = ++action
    apply.disabled = true
    reset.disabled = true
    message = 'building'
    translate(p)
    try {
      await town.edit(p, n, rule)
      redraw()
      if (action === serial) show(p)
    } catch (error) {
      if (action === serial) {
        show(p)
        message = 'error'
        translate(p)
        console.error(error)
      }
    }
  }
  slider.min = String(minLayers)
  slider.max = String(maxLayers)
  slider.oninput = () => {
    output.value = slider.value
    apply.disabled = Number(slider.value) === active?.layers && projection.value === active?.projection
  }
  projection.onchange = () => {apply.disabled = Number(slider.value) === active?.layers && projection.value === active?.projection}
  parts.onchange = () => {
    const p = town.placements.find((q) => q.key === parts.value)
    if (p) show(p)
  }
  apply.onclick = () => void change(Number(slider.value), projection.value as ProjectionChoice)
  reset.onclick = () => {
    if (active) void change(modelSettings(active.part.id).layers, 'asset')
  }
  function close() {
    hide()
    canvas.focus({ preventScroll: true })
  }
  document.querySelector('#layer-close')!.addEventListener('click', close)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      close()
      e.preventDefault()
    }
  })
  openButton.onclick = () => {
    const p = town.placements.find(
      (q) =>
        q.item.id ===
        document.querySelector<HTMLSelectElement>('#guide')!.value,
    )
    if (p) {
      show(p)
      parts.focus()
    }
  }
  const ray = new Raycaster(),
    pointer = new Vector2()
  const fingers = new Set<number>()
  let startX = 0,
    startY = 0,
    drag = false
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      fingers.add(e.pointerId)
      drag = fingers.size > 1
      startX = e.clientX
      startY = e.clientY
    },
    true,
  )
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (
        fingers.has(e.pointerId) &&
        Math.hypot(e.clientX - startX, e.clientY - startY) > 6
      )
        drag = true
    },
    true,
  )
  canvas.addEventListener(
    'pointercancel',
    (e) => {
      fingers.delete(e.pointerId)
      drag = true
    },
    true,
  )
  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (
        !fingers.delete(e.pointerId) ||
        drag ||
        fingers.size ||
        Math.hypot(e.clientX - startX, e.clientY - startY) > 6
      )
        return
      const r = canvas.getBoundingClientRect()
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        1 - ((e.clientY - r.top) / r.height) * 2,
      )
      ray.setFromCamera(pointer, camera)
      const hit = ray.intersectObjects(
        terrain.visible ? [town.root, terrain] : [town.root],
        true,
      )[0]
      if (
        hit?.object instanceof InstancedMesh &&
        hit.instanceId !== undefined
      ) {
        const p = town.lookup(hit.object, hit.instanceId)
        if (p) show(p)
      } else hide()
    },
    true,
  )
  return {
    onFocus(id: string) {
      hide()
      openButton.hidden = !id
    },
    selection: () => active?.key,
  }
}
