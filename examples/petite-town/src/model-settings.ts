const detailed = new Set([
  'bakery-shell',
  'bakery-window',
  'potion-shell',
  'potion-window',
  'potion-ivy',
  'bridge',
  'bridge-arch',
  'bridge-side-frame',
  'rotor',
  'wheel',
  'windmill',
  'stone-ring',
  'pail',
  'well',
  'lamp',
  'lamp-post',
  'fence',
])
const rounded = new Set([
  'apple',
  'barrel',
  'bottle',
  'loaf',
  'mill-body',
  'pot',
  'basket',
  'post',
  'rope',
  'water',
])
export function modelSettings(id: string) {
  return {
    resolution: detailed.has(id) ? 64 : 48,
    layers: detailed.has(id) ? 44 : 32,
    profile: rounded.has(id) ? ('round' as const) : ('silhouette' as const),
    pivot: 'ground' as const,
  }
}
export const minLayers = 8,
  maxLayers = 128
