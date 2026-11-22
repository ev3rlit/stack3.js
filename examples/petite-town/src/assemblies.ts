// Metres. Each position is the bottom centre, except the explicitly centred mill axle.
type Triple = [number, number, number]
export interface Part {
  id: string
  size: Triple
  at: Triple
  yaw?: number
  pitch?: number
  axle?: boolean
}
const part = (
  id: string,
  size: Triple,
  at: Triple = [0, 0, 0],
  yaw = 0,
): Part => ({ id, size, at, yaw })
const apples = (x: number, y: number, z: number, scale = 1) => {
  const place = (id: string, size: Triple, at: Triple, yaw = 0) =>
    part(
      id,
      size.map((n) => n * scale) as Triple,
      [x + at[0] * scale, y + at[1] * scale, z + at[2] * scale],
      yaw,
    )
  return [
    place('crate', [0.76, 0.31, 0.64], [0, 0, 0]),
    ...[
      [-0.19, -0.15],
      [0.18, -0.15],
      [-0.17, 0.14],
      [0.18, 0.15],
      [0, 0],
    ].map(([a, b], i) =>
      place(
        'apple',
        [0.27, 0.29, 0.27],
        [a, i === 4 ? 0.25 : 0.16, b],
        i * 0.8,
      ),
    ),
  ]
}
const flowers = (x: number, y: number, z: number, s = 1) =>
  part('flower', [0.48 * s, 0.48 * s, 0.42 * s], [x, y, z])
export interface Exhibit {
  id: string
  name: string
  at: [number, number]
  yaw: number
  parts: Part[]
}
export const exhibits: Exhibit[] = [
  {
    id: 'house',
    name: '목조 주택',
    at: [-2.15, -3.08],
    yaw: 0.22,
    parts: [
      part('house', [1.68, 2.46, 1.84]),
      part('house-roof', [1.95, 1.45, 1.95], [0, 1.20, 0]),
      part('house-chimney', [0.36, 1.05, 0.36], [-0.64, 1.47, -0.58]),
      part('house-door', [0.73, 1.18, 0.24], [0, 0, 0.99]),
      part('house-lantern', [0.16, 0.35, 0.25], [-0.49, 0.76, 1.006]),
      part('house-window-flowers', [0.73, 0.54, 0.18], [-0.85, 0.49, 0], -Math.PI / 2),
      part('house-window', [0.68, 0.51, 0.13], [0.825, 0.51, 0], Math.PI / 2),
    ],
  },
  {
    id: 'bakery',
    name: '빵집',
    at: [0.02, -2.96],
    yaw: -0.04,
    parts: [
      part('bakery-shell', [1.95, 2.55, 1.88]),
      part('bakery-chimney', [0.36, 0.90, 0.36], [0.60, 1.66, -0.51]),
      part('bakery-window', [0.61, 0.51, 0.165], [0, 1.49, 0.614]),
      part('bakery-window', [0.68, 0.58, 0.18], [0.873, 0.48, -0.16], Math.PI / 2),
      part('bakery-counter', [1.42, 0.575, 0.52], [0, 0, 0.78]),
      part('basket', [0.46, 0.23, 0.3], [-0.4, 0.572, 0.84]),
      part('loaf', [0.31, 0.19, 0.23], [-0.41, 0.69, 0.84], 0.2),
      part('loaf', [0.32, 0.16, 0.23], [0.17, 0.573, 0.85], -0.13),
      part('loaf', [0.27, 0.14, 0.2], [0.5, 0.573, 0.85], 0.18),
      part('bread-sign', [0.48, 0.4, 0.09], [0.39, 0.09, 1.026]),
    ],
  },
  {
    id: 'potionist',
    name: '포션가게',
    at: [-2.64, -0.18],
    yaw: 0.4,
    parts: [
      part('potion-shell', [1.85, 2.28, 1.52]),
      part('potion-chimney', [0.32, 0.68, 0.31], [0.50, 1.59, -0.40]),
      part('potion-counter', [1.34, 0.51, 0.42], [0, 0, 0.74]),
      ...[-0.43, 0, 0.4].map((x, i) =>
        part('bottle', [0.19, 0.3 + i * 0.025, 0.18], [x, 0.51, 0.81]),
      ),
      part('potion-sign', [0.40, 0.40, 0.08], [0.37, 0.035, 0.939]),
      part('potion-window', [0.31, 0.36, 0.11], [0, 1.46, 0.766]),
      part('potion-window', [0.41, 0.50, 0.12], [0, 0.59, -0.691], Math.PI),
      part('potion-window', [0.40, 0.49, 0.11], [0.835, 0.57, 0.07], Math.PI / 2),
      ...[0.18, 0.435, 0.69, 0.945].map((y, i) =>
        part('potion-ivy', [0.245, 0.30, 0.066],
          [i === 0 ? 0.846 : 0.829, y, -0.26 - 0.045 * i], Math.PI / 2),
      ),
    ],
  },
  {
    id: 'well',
    name: '돌우물',
    at: [-0.48, -0.1],
    yaw: -0.12,
    parts: [
      part('stone-ring', [1.31, 0.58, 1.31]),
      part('water', [0.94, 0.06, 0.94], [0, 0.29, 0]),
      ...[-0.51, 0.51].map((x) =>
        part('post', [0.13, 1.31, 0.14], [x, 0.48, 0]),
      ),
      part('well-roof', [1.62, 0.56, 1.25], [0, 1.68, 0]),
      part('rope', [0.045, 0.84, 0.045], [0, 1.06, 0]),
      part('pail', [0.29, 0.39, 0.28], [0, 0.7, 0]),
    ],
  },
  {
    id: 'apple-crate',
    name: '사과 상자',
    at: [-1.96, 3.69],
    yaw: -0.2,
    parts: apples(0, 0, 0, 1.12),
  },
  {
    id: 'apple-stall',
    name: '사과 판매대',
    at: [-1.78, 2.63],
    yaw: -0.25,
    parts: [
      part('stall-frame', [1.55, 1.65, 1.04]),
      part('awning', [1.74, 0.34, 1.23], [0, 1.6, 0]),
      ...apples(0, 0.72, 0.04, 0.94),
    ],
  },
  {
    id: 'barrel',
    name: '오크통',
    at: [0.56, -1.28],
    yaw: 0,
    parts: [part('barrel', [0.63, 0.76, 0.63])],
  },
  {
    id: 'flower-cart',
    name: '꽃 수레',
    at: [-0.45, 3.7],
    yaw: 0.85,
    parts: [
      part('cart-body', [0.76, 0.77, 1.62]),
      part('post', [0.072, 0.32, 0.07], [0, 0.025, 0.292]),
      ...[-0.405, 0.405].map((x) =>
        part('wheel', [0.66, 0.66, 0.12], [x, 0, -0.3], Math.PI / 2),
      ),
      flowers(-0.12, 0.62, -0.38, 0.9),
      flowers(0.12, 0.62, -0.13, 0.9),
      flowers(-0.1, 0.62, 0.1, 0.8),
    ],
  },
  {
    id: 'planter',
    name: '화분',
    at: [3.18, 2.07],
    yaw: 0,
    parts: [part('pot', [0.52, 0.41, 0.52]), flowers(0, 0.23, 0, 1.13)],
  },
  {
    id: 'lamp',
    name: '수정 가로등',
    at: [0.77, 0.18],
    yaw: -0.18,
    parts: [
      part('lamp-post', [0.68, 1.82, 0.36]),
      part('flag', [0.27, 0.46, 0.045], [0.17, 0.8, 0]),
    ],
  },
  {
    id: 'bridge',
    name: '돌다리',
    at: [1.91, 1.17],
    yaw: Math.PI / 2,
    parts: [
      part('bridge-arch', [0.94, 0.675, 2.94], [0, 0.06, 0]),
      part('bridge-side-frame', [0.16, 0.81, 3.0], [-0.50, 0, 0]),
      part('bridge-side-frame', [0.16, 0.81, 3.0], [0.50, 0, 0], Math.PI),
    ],
  },
  {
    id: 'windmill',
    name: '풍차',
    at: [3.27, -2.31],
    yaw: -0.28,
    parts: [
      part('mill-body', [1.53, 3.0, 1.48]),
      {
        ...part('post', [0.14, 0.5, 0.14], [0, 2.09, 0.37]),
        pitch: Math.PI / 2,
      },
      { ...part('rotor', [2.12, 2.12, 0.2], [0, 2.09, 0.8]), axle: true },
      part('fence', [0.91, 0.49, 0.14], [-0.86, 0, 0.49], -0.68),
      part('fence', [0.91, 0.49, 0.14], [0.87, 0, 0.46], 0.68),
    ],
  },
]
