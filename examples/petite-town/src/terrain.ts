import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  type Material,
  type ShaderMaterial,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three'
import { exhibits } from './assemblies'

const length = 5.18,
  breadth = 4.9
const edge = (z: number) =>
  4.2 * Math.pow(Math.max(0, 1 - (z / length) ** 2), 0.37)
const outerEast = (z: number) =>
  edge(z) + 0.64 * Math.exp(-(((z + 2.4) / 1.6) ** 2)) * Math.min(1, edge(z))
const stream = (z: number) => edge(z) * (0.4 + 0.07 * Math.sin(z * 1.13))
const channel = (z: number) => 0.57 * Math.min(1, edge(z) / 1.6)
type Point = [number, number]
function landscapeMap() {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 1536
  const c = canvas.getContext('2d')!
  let seed = 3179
  const rand = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  c.scale(canvas.width / (2 * breadth), canvas.height / (2 * length))
  c.translate(breadth, length)
  c.fillStyle = '#a8b879'
  c.fillRect(-breadth, -length, 2 * breadth, 2 * length)
  const ellipse = (
    x: number,
    z: number,
    w: number,
    h: number,
    color: string,
    angle = 0,
  ) => {
    c.beginPath()
    c.fillStyle = color
    c.ellipse(x, z, w, h, angle, 0, Math.PI * 2)
    c.fill()
  }
  // Small translucent washes keep the ground on the same painted scale as the buildings.
  for (let i = 0; i < 1100; i++)
    ellipse(
      (rand() * 2 - 1) * breadth,
      (rand() * 2 - 1) * length,
      0.04 + 0.43 * rand(),
      0.03 + 0.25 * rand(),
      ['#738e6012', '#e3d69c20', '#e5ddab1a', '#80965316'][i % 4],
      rand() * 3,
    )
  const path = (points: Point[], width: number) => {
    c.beginPath()
    c.moveTo(...points[0])
    for (let i = 1; i < points.length - 1; i++)
      c.quadraticCurveTo(
        ...points[i],
        (points[i][0] + points[i + 1][0]) / 2,
        (points[i][1] + points[i + 1][1]) / 2,
      )
    c.lineTo(...points.at(-1)!)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const [w, s] of [
      [width + 0.15, '#c1bb87'],
      [width + 0.06, '#d7c49b'],
      [width, '#e5cfaa'],
    ] as const) {
      c.strokeStyle = s
      c.lineWidth = w
      c.stroke()
    }
  }
  path(
    [
      [-0.3, 4.6],
      [-0.96, 3.15],
      [-1.12, 1.25],
      [-0.65, -0.35],
      [-0.7, -1.38],
      [-1.95, -2.1],
    ],
    0.7,
  )
  path(
    [
      [-2.62, 0.61],
      [-1.55, 0.96],
      [-0.54, 0.97],
      [0.82, 1.17],
      [2.5, 1.17],
      [3.12, 0.52],
      [2.99, -1.44],
      [2.6, -1.72],
    ],
    0.62,
  )
  path(
    [
      [-1, -0.85],
      [-0.05, -1.2],
      [0.16, -2.0],
    ],
    0.58,
  )
  ellipse(-0.47, 0.06, 1.06, 1.05, '#d9c49f')
  for (let i = 0; i < 105; i++) {
    const a = i * 2.3999,
      r = Math.sqrt(i / 105) * 1.0
    ellipse(
      -0.47 + Math.cos(a) * r,
      0.06 + Math.sin(a) * r,
      0.079,
      0.057,
      ['#c5b396', '#e6d3b2', '#ceb997'][i % 3],
      a,
    )
  }
  for (let i = 0; i < 5700; i++) {
    const x = (rand() * 2 - 1) * breadth,
      z = (rand() * 2 - 1) * length
    ellipse(
      x,
      z,
      0.007 + 0.022 * rand(),
      0.006 + 0.012 * rand(),
      ['#536a4b25', '#fff2bf52', '#99835724'][i % 3],
      rand() * 3,
    )
  }
  for (const e of exhibits) {
    if (e.id === 'bridge') continue
    const [x, z] = e.at,
      [w, , d] = e.parts[0].size
    c.save()
    c.translate(x, z)
    c.rotate(-e.yaw)
    c.scale(Math.max(0.27, w * 0.74), Math.max(0.24, d * 0.71))
    const shade = c.createRadialGradient(0, 0, 0.1, 0, 0, 1)
    shade.addColorStop(0, '#463b2e70')
    shade.addColorStop(0.65, '#504a3040')
    shade.addColorStop(1, '#5d5b3600')
    c.fillStyle = shade
    c.fillRect(-1, -1, 2, 2)
    c.restore()
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
export function makeTerrain(water: ShaderMaterial) {
  const group = new Group(),
    map = landscapeMap()
  const grass = new MeshBasicMaterial({ map, side: DoubleSide })
  const clay = new MeshBasicMaterial({ color: 0xb58b62, side: DoubleSide }),
    soil = new MeshBasicMaterial({ color: 0xd0ab79, side: DoubleSide })
  const rim = new MeshBasicMaterial({ color: 0x91a269, side: DoubleSide })
  const strips = (
    points: (z: number) => [number, number, number, number],
    mat: Material,
  ) => {
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = []
    let distance = 0, previousCentre = 0
    for (let i = 0; i <= 100; i++) {
      const z = (i / 50 - 1) * length
      const [x1, y1, x2, y2] = points(z)
      pos.push(x1, y1, z, x2, y2, z)
      if (mat === water) {
        const centre = (x1 + x2) / 2
        if (i) distance += Math.hypot(centre - previousCentre, 2 * length / 100)
        previousCentre = centre
        uv.push(0, distance, 1, distance)
      } else uv.push(
        (x1 / breadth + 1) / 2,
        (1 - z / length) / 2,
        (x2 / breadth + 1) / 2,
        (1 - z / length) / 2,
      )
      if (i) {
        const n = i * 2
        idx.push(n - 2, n, n - 1, n, n + 1, n - 1)
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    geometry.setIndex(idx)
    group.add(new Mesh(geometry, mat))
  }
  const west = (z: number) => stream(z) - channel(z),
    east = (z: number) => stream(z) + channel(z)
  strips((z) => [-edge(z), 0, west(z), 0], grass)
  strips((z) => [east(z), 0, outerEast(z), 0], grass)
  strips((z) => [west(z), -0.2, east(z), -0.2], water)
  for (const side of [(z: number) => -edge(z), outerEast, west, east]) {
    const bank = side === west || side === east
    strips((z) => [side(z), 0, side(z), -0.085], rim)
    strips((z) => [side(z), -0.085, side(z), bank ? -0.23 : -0.31], soil)
    if (!bank) strips((z) => [side(z), -0.31, side(z) * 0.986, -0.49], clay)
  }
  strips((z) => [-edge(z) * 0.986, -0.49, outerEast(z) * 0.986, -0.49], clay)
  return group
}
