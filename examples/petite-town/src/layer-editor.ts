import {
  InstancedMesh,
  Raycaster,
  Vector2,
  type Camera,
  type Object3D,
} from 'three'
import { maxLayers, minLayers, modelSettings } from './model-settings'
import type { assemble, Placement } from './town-instances'

type Town = Awaited<ReturnType<typeof assemble>>
const names: Record<string, string> = {
  house: '주택 본체',
  'house-roof': '빨간 지붕',
  'house-chimney': '굴뚝',
  'house-door': '현관문',
  'house-lantern': '현관등',
  'house-window': '창문',
  'house-window-flowers': '꽃창문',
  'potion-window': '창문',
  'potion-counter': '포션 매대',
  'potion-ivy': '담쟁이',
  'potion-chimney': '굴뚝',
  'bakery-shell': '빵집 본체',
  'potion-shell': '포션가게 본체',
  'stone-ring': '돌 테두리',
  'well-roof': '우물 지붕',
  water: '수면',
  post: '목재 기둥',
  pail: '두레박',
  rope: '줄',
  'bridge-arch': '아치 보행판',
  'bridge-side-frame': '측면 프레임',
  apple: '사과',
  crate: '상자',
  loaf: '빵',
  basket: '바구니',
  counter: '진열판',
  'bread-sign': '빵집 팻말',
  'potion-sign': '포션 팻말',
  bottle: '포션 병',
  barrel: '오크통',
  wheel: '바퀴',
  'cart-body': '수레 본체',
  'stall-frame': '판매대 본체',
  awning: '천막',
  flower: '꽃',
  pot: '화분 그릇',
  'lamp-post': '가로등 본체',
  flag: '깃발',
  'mill-body': '풍차 본체',
  rotor: '풍차 날개',
  fence: '울타리',
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
  const output = document.querySelector<HTMLOutputElement>('#layer-value')!,
    note = document.querySelector<HTMLElement>('#layer-note')!
  const apply = document.querySelector<HTMLButtonElement>('#layer-apply')!,
    reset = document.querySelector<HTMLButtonElement>('#layer-reset')!
  const openButton = document.querySelector<HTMLButtonElement>('#edit-open')!
  let active: Placement | undefined,
    action = 0
  const label = (p: Placement) =>
    (names[p.part.id] ?? p.part.id) +
    (town.placements.some(
      (q) => q.item === p.item && q.part.id === p.part.id && q.ordinal > 1,
    )
      ? ' ' + p.ordinal
      : '')
  function show(p: Placement) {
    action++
    active = p
    panel.hidden = false
    title.textContent = p.item.name
    const peers = town.placements.filter((q) => q.item === p.item)
    parts.replaceChildren(...peers.map((q) => new Option(label(q), q.key)))
    parts.value = p.key
    slider.value = String(p.layers)
    output.value = slider.value
    const def = modelSettings(p.part.id).layers
    note.textContent = '현재 ' + p.layers + '층 · 기본 ' + def + '층'
    apply.disabled = true
    reset.disabled = p.layers === def
  }
  function hide() {
    action++
    active = undefined
    panel.hidden = true
  }
  async function change(n: number) {
    if (!active) return
    const p = active,
      serial = ++action
    apply.disabled = true
    reset.disabled = true
    note.textContent = '메시를 만드는 중…'
    try {
      await town.edit(p, n)
      redraw()
      if (action === serial) show(p)
    } catch (error) {
      if (action === serial) {
        show(p)
        note.textContent = '적용 실패 · ' + String(error)
      }
    }
  }
  slider.min = String(minLayers)
  slider.max = String(maxLayers)
  slider.oninput = () => {
    output.value = slider.value
    apply.disabled = Number(slider.value) === active?.layers
  }
  parts.onchange = () => {
    const p = town.placements.find((q) => q.key === parts.value)
    if (p) show(p)
  }
  apply.onclick = () => void change(Number(slider.value))
  reset.onclick = () => {
    if (active) void change(modelSettings(active.part.id).layers)
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
