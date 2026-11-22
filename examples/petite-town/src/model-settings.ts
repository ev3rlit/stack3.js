const detailed = new Set([
  'bakery-shell',
  'bakery-roof',
  'bakery-awning',
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
    ...(id === 'rotor' ? { meshMethod: 'contour' as const, contourHub: true } : {}),
    resolution: detailed.has(id) ? 64 : 48,
    layers: detailed.has(id) ? 44 : 32,
    profile: rounded.has(id) ? ('round' as const) : ('silhouette' as const),
    pivot: 'ground' as const,
  }
}
export const minLayers = 8,
  maxLayers = 128

export type ProjectionChoice = 'asset' | import('@stack3/core').TextureProjection
export function isProjectionChoice(value: unknown): value is ProjectionChoice {
  return value === 'asset' || value === 'auto' || value === 'top-contour'
}

export function usesTopContour(id: string, choice: ProjectionChoice) {
  return choice === 'top-contour' || (choice === 'asset' && id === 'bridge-side-frame')
}
