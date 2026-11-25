import { DEFAULT_LAYERS, samplingGrid } from './sampling';
import { projectUpperContour, type TextureProjection } from './texture-projection';
import { bleedEdges, extrudeContours } from './contour';
import { frontAccentDecals, inferAccentViews, inferSurfaceDepth } from './atlas-comparison';
import { extractSurface, extractVoxelSurface } from './surface';
import { DIRECTIONS, prepareViews, type Direction, type Raster, type ViewSet } from './views';

type Vec3 = [number, number, number];
export type Settings = {
  textureProjection?: TextureProjection;
  meshMethod?: 'marching-cubes' | 'contour';
  contourHub?: boolean;
  layers?: number;
  resolution?: number;
  height?: number;
  threshold?: number;
  pivot?: 'ground' | 'center';
  size?: [number, number, number];
  profile?: 'silhouette' | 'round' | 'round-base';
};
export type MeshData = {
  target: 'mesh';
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  texture: Raster;
  size: Vec3;
  pivot: Vec3;
};
export type StackData = {
  target: 'stack';
  texture: Raster;
  width: number;
  depth: number;
  layers: number;
  columns: number;
  spacing: number;
  size: Vec3;
  pivot: Vec3;
};
export type AssetData = MeshData | StackData;

export function respaceStack(stack: StackData, multiplier: number): StackData {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(multiplier * stack.size[2])) {
    throw new Error('Spacing must be a positive, finite multiplier.');
  }
  if (multiplier === 1) return stack;
  return {
    ...stack,
    spacing: stack.spacing * multiplier,
    size: [stack.size[0], stack.size[1], stack.size[2] * multiplier],
    pivot: [stack.pivot[0], stack.pivot[1], stack.pivot[2] * multiplier],
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function viewUV(direction: Direction, x: number, y: number, z: number): [number, number] {
  switch (direction) {
    case 'top': return [x, y];
    case 'bottom': return [x, 1 - y];
    case 'left': return [1 - y, 1 - z];
    case 'right': return [y, 1 - z];
    case 'front': return [x, 1 - z];
    case 'rear': return [1 - x, 1 - z];
  }
}

function sample(image: Raster, u: number, v: number) {
  return (clamp(Math.floor(v * image.height), 0, image.height - 1) * image.width +
    clamp(Math.floor(u * image.width), 0, image.width - 1)) * 4;
}

function resize(image: Raster, width: number, height: number): Raster {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = sample(image, (x + .5) / width, (y + .5) / height);
    const q = (y * width + x) * 4;
    for (let k = 0; k < 4; k++) data[q + k] = image.data[p + k];
  }
  return { width, height, data };
}

function rankedViews(views: ViewSet, nx: number, ny: number, nz: number): Direction[] {
  const weights = [
    Math.max(0, nz), Math.max(0, -nx), Math.max(0, ny),
    Math.max(0, -ny), Math.max(0, nx), Math.max(0, -nz),
  ];
  if (!views.right) weights[1] = Math.abs(nx);
  if (!views.bottom) weights[0] = Math.abs(nz);
  return [...DIRECTIONS].filter(direction => views[direction]).sort((a, b) =>
    weights[DIRECTIONS.indexOf(b)] - weights[DIRECTIONS.indexOf(a)]);
}

export function reconstructionDimensions(views: ViewSet, settings: Settings) {
  const top = views.top!, front = views.front!, left = views.left!;
  const layers = settings.layers ?? DEFAULT_LAYERS;
  const resolution = settings.resolution ?? 96;
  const height = settings.height ?? 1;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Height must be positive.');
  if (settings.pivot && settings.pivot !== 'center' && settings.pivot !== 'ground') throw new Error('Pivot must be ground or center.');
  const depthFromView = left.width / left.height * height;
  const [x, y, z] = settings.size ??
    [(front.width / front.height * height + depthFromView * top.width / top.height) / 2, depthFromView, height];
  if (![x, y, z].every(value => Number.isFinite(value) && value > 0)) throw new Error('Part dimensions must be positive.');
  const { width, depth } = samplingGrid(x, y, resolution, layers);
  const size: Vec3 = [x, y, z];
  const pivot: Vec3 = [0, 0, settings.pivot === 'center' ? z / 2 : 0];
  return { width, depth, layers, size, pivot };
}

function grid(views: ViewSet, settings: Settings, fallback?: Grid): Grid {
  const { width, depth, layers, size, pivot } = reconstructionDimensions(views, settings);
  const aligned: ViewSet = {};
  for (const direction of DIRECTIONS) {
    const view = views[direction];
    if (!view) continue;
    const vertical = direction !== 'top' && direction !== 'bottom';
    aligned[direction] = resize(view, direction === 'left' || direction === 'right' ? depth : width, vertical ? layers : depth);
  }
  const entries = Object.entries(aligned) as [Direction, Raster][];
  const covered = (direction: Direction, view: Raster, u: number, v: number, h: number) =>
    view.data[sample(view, ...viewUV(direction, u, v, h)) + 3] >= 128;
  const volume = new Uint8Array(width * depth * layers);
  let occupied = 0;
  const rounded = settings.profile === 'round' || settings.profile === 'round-base';
  for (let z = 0; z < layers; z++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / depth, h = (z + .5) / layers;
    const solid = views.right
      ? entries.every(([direction, view]) => covered(direction, view, u, v, h))
      : covered('top', aligned.top!, u, v, h) && covered('left', aligned.left!, u, v, h) &&
        (covered('front', aligned.front!, u, v, h) || covered('rear', aligned.rear!, u, v, h));
    if (solid) {
      volume[(z * depth + y) * width + x] = 1;
      occupied++;
    }
  }
  if (rounded) {
    // Use the observed cross-section extents, keeping the plate on assets with a square foot.
    const area = width * depth;
    for (let z = 0; z < layers; z++) {
      if (settings.profile === 'round-base' && (z + .5) / layers < .03) continue;
      let x0 = width, x1 = -1, y0 = depth, y1 = -1;
      const offset = z * area;
      for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
        if (!volume[offset + y * width + x]) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x1 < x0) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (((2 * x - x0 - x1) / (x1 - x0 + 1)) ** 2 + ((2 * y - y0 - y1) / (y1 - y0 + 1)) ** 2 <= 1) continue;
        const index = offset + y * width + x;
        occupied -= volume[index];
        volume[index] = 0;
      }
    }
  }
  if (!occupied) {
    if (fallback) return fallback;
    throw new Error('The aligned views have no common volume.');
  }
  return { width, depth, layers, size, pivot, volume, aligned };
}

type Grid = { width: number; depth: number; layers: number; size: Vec3; pivot: Vec3; volume: Uint8Array; aligned: ViewSet };

function textureAtlas(views: ViewSet, accentViews: ViewSet = {}, bleed = false) {
  const tiles = new Map<Direction, { image: Raster; left: number }>();
  const accents = new Map(tiles);
  let width = 0, height = 0;
  for (const [sources, target] of [[views, tiles], [accentViews, accents]] as const) for (const direction of DIRECTIONS) {
    const view = sources[direction];
    if (!view) continue;
    const scale = Math.min(1, 512 / Math.max(view.width, view.height));
    const image = resize(view, Math.max(1, Math.round(view.width * scale)), Math.max(1, Math.round(view.height * scale)));
    target.set(direction, { image: bleed ? bleedEdges(image) : image, left: width + 1 });
    width += image.width + 2;
    height = Math.max(height, image.height + 2);
  }
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const { image, left } of [...tiles.values(), ...accents.values()]) {
    for (let y = -1; y <= image.height; y++) for (let x = -1; x <= image.width; x++) {
      const p = (clamp(y, 0, image.height - 1) * image.width + clamp(x, 0, image.width - 1)) * 4;
      const q = ((y + 1) * width + left + x) * 4;
      for (let k = 0; k < 3; k++) data[q + k] = image.data[p + 3] >= 128 ? image.data[p + k] : 137;
    }
  }
  return { tiles, accents, texture: { width, height, data } };
}

type ComparisonMode = 'rgb' | 'id' | 'depth';
export type ComparisonMesh = MeshData & { frontAccents?: MeshData };

function makeMesh(g: Grid, views: ViewSet, mode: ComparisonMode = 'rgb'): ComparisonMesh {
  const { width, depth, layers, size, pivot, volume } = g;
  // The depth stage creates a new surface and normals from a continuous field.
  const surface = extractSurface(volume, width, depth, layers, mode === 'depth' ? size : undefined);
  if (!surface.indices.length && mode === 'depth') return makeMesh(g, views, 'id');
  const roof = new Int32Array(width * depth).fill(-1);
  const floor = new Int32Array(width * depth).fill(layers);
  const area = width * depth;
  for (let z = 0; z < layers; z++) for (let i = 0; i < area; i++) {
    if (!volume[z * area + i]) continue;
    roof[i] = z;
    floor[i] = Math.min(floor[i], z);
  }

  function nearFlatSurface(columns: Int32Array, x: number, y: number, z: number) {
    const px = clamp(Math.floor(x * width), 0, width - 1);
    const py = clamp(Math.floor(y * depth), 0, depth - 1);
    const point = columns[py * width + px];
    if (Math.abs(point + .5 - z * layers) > 2) return false;
    let neighbors = 0;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= depth) continue;
      if (Math.abs(columns[ny * width + nx] - point) > (views.bottom ? 2 : 1)) return false;
      neighbors++;
    }
    return neighbors >= (views.bottom ? 2 : 3);
  }

  const accents = mode === 'rgb' ? undefined : inferAccentViews(views);
  const ownerViews: ViewSet = {};
  for (const owner of accents?.owner.values() ?? []) ownerViews[owner] = views[owner];
  const inferredDepth = accents ? inferSurfaceDepth(volume, [width, depth, layers], DIRECTIONS) : undefined;
  const frontDecal = accents?.owner.get(1) === 'front' && inferredDepth && views.front && accents.masks.front
    ? frontAccentDecals(views.front, accents.masks.front, [width, depth, layers], size, pivot, inferredDepth.firstHit)
    : undefined;
  const { texture, tiles, accents: accentTiles } = textureAtlas(accents?.clean ?? views, ownerViews);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
  const cache = new Map<number, number>();
  for (let i = 0; i < surface.indices.length; i += 3) {
    const tri = surface.indices.slice(i, i + 3);
    const average = [0, 1, 2].map(axis => tri.reduce((sum, index) => sum + surface.gradients[index * 3 + axis], 0));
    const centerSum = [0, 1, 2].map(axis =>
      tri.reduce((sum, index) => sum + surface.positions[index * 3 + axis], 0)) as Vec3;
    const center = [centerSum[0] / (3 * width), centerSum[1] / (3 * depth), centerSum[2] / (3 * layers)] as const;
    let choices = rankedViews(views, average[0], average[1], average[2]);
    const verticalView = average[2] < 0 && views.bottom ? 'bottom' : 'top';
    const envelope = average[2] < 0 ? floor : roof;
    const planFacing = mode === 'depth' && inferredDepth && (
      Math.abs(average[2]) * layers / size[2] > 1.55 * Math.max(
        Math.abs(average[0]) * width / size[0], Math.abs(average[1]) * depth / size[1]))
      && inferredDepth.visible(verticalView, centerSum.map(value => value / 3) as Vec3, 3);
    if (!planFacing && !nearFlatSurface(envelope, center[0], center[1], center[2])) {
      const nx = average[0], ny = average[1];
      choices = Math.hypot(nx, ny) > .1 ? rankedViews(views, nx, ny, 0)
        : rankedViews(views, center[0] - .5, center[1] - .5, 0);
      choices = [...choices.filter(name => name !== 'top' && name !== 'bottom'), verticalView];
    }
    const covered = (name: Direction) => {
      const view = views[name]!;
      return view.data[sample(view, ...viewUV(name, ...center)) + 3] >= 128;
    };
    let direction = planFacing && covered(verticalView) ? verticalView : choices.find(covered) ?? choices[0];
    let useAccent = false;
    if (accents && inferredDepth) {
      const centerCell = centerSum.map(value => value / 3) as Vec3;
      const tolerance = mode === 'depth' ? 3 : 1.5;
      const candidates = rankedViews(views, average[0], average[1], average[2]);
      const facing = [Math.max(0, average[2]), Math.max(0, -average[0]), Math.max(0, average[1]),
        Math.max(0, -average[1]), Math.max(0, average[0]), Math.max(0, -average[2])];
      const strongest = Math.max(...facing);
      for (const candidate of candidates) {
        if (!ownerViews[candidate] || facing[DIRECTIONS.indexOf(candidate)] <= strongest * .45 ||
            !inferredDepth.visible(candidate, centerCell, tolerance)) continue;
        const view = ownerViews[candidate]!;
        const texel = sample(view, ...viewUV(candidate, ...center)) / 4;
        const id = accents.masks[candidate]![texel];
        if (accents.owner.get(id) !== candidate || candidate === 'front' && frontDecal?.marked[texel]) continue;
        direction = candidate;
        useAccent = true;
        break;
      }
    }
    const { image, left } = (useAccent ? accentTiles : tiles).get(direction)!;
    for (const original of tri) {
      const key = original * 12 + DIRECTIONS.indexOf(direction) + (useAccent ? 6 : 0);
      let index = cache.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        cache.set(key, index);
        const p = original * 3;
        const x = surface.positions[p] / width, y = surface.positions[p + 1] / depth, z = surface.positions[p + 2] / layers;
        // Internal Z-up is mapped to the Y-up coordinate system shared by Three.js and GLB.
        positions.push((x - .5) * size[0], z * size[2] - pivot[2], (.5 - y) * size[1]);
        const nx = surface.gradients[p] * width / size[0], ny = surface.gradients[p + 1] * depth / size[1];
        const nz = surface.gradients[p + 2] * layers / size[2];
        const magnitude = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / magnitude, nz / magnitude, -ny / magnitude);
        const [u, v] = viewUV(direction, x, y, z);
        uvs.push((left + .5 + clamp(u, 0, 1) * (image.width - 1)) / texture.width,
          (1.5 + clamp(v, 0, 1) * (image.height - 1)) / texture.height);
      }
      indices.push(index);
    }
  }
  return { target: 'mesh', size, pivot, texture, positions: Float32Array.from(positions),
    normals: Float32Array.from(normals), indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs),
    ...(frontDecal?.mesh && { frontAccents: frontDecal.mesh }) };
}

function makeStack(g: Grid, views: ViewSet): StackData {
  const { width, depth, layers, size, pivot, volume } = g;
  const columns = Math.min(layers, Math.max(1, Math.floor(4096 / width)));
  const imageWidth = width * columns, imageHeight = depth * Math.ceil(layers / columns);
  const data = new Uint8Array(imageWidth * imageHeight * 4);
  const filled = (x: number, y: number, z: number) =>
    Number(x >= 0 && x < width && y >= 0 && y < depth && z >= 0 && z < layers && volume[(z * depth + y) * width + x] > 0);
  const roof = new Int32Array(width * depth).fill(-1);
  for (let z = 0; z < layers; z++) for (let i = 0; i < roof.length; i++) {
    if (volume[z * roof.length + i]) roof[i] = z;
  }
  const surfaceViews = Array.from({ length: 27 }, (_, index) => rankedViews(views,
    index % 3 - 1, Math.floor(index / 3) % 3 - 1, Math.floor(index / 9) - 1));
  const flatAt = (x: number, y: number, z: number) => x < 0 || x >= width || y < 0 || y >= depth ||
    Math.abs(roof[y * width + x] - z) <= 1;
  for (let z = 0; z < layers; z++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    if (!filled(x, y, z)) continue;
    const nx = filled(x - 1,y,z) - filled(x + 1,y,z);
    const ny = filled(x,y - 1,z) - filled(x,y + 1,z);
    const nz = filled(x,y,z - 1) - filled(x,y,z + 1);
    const index = nx + 1 + (ny + 1) * 3 + (nz + 1) * 9;
    const q = ((Math.floor(z / columns) * depth + y) * imageWidth + z % columns * width + x) * 4;
    const roofZ = roof[y * width + x];
    // Color stepped slopes from elevations. The plan-view image supplies color for flat upper surfaces.
    const planSurface = z === roofZ && flatAt(x-2,y,z) && flatAt(x+2,y,z) && flatAt(x,y-2,z) && flatAt(x,y+2,z);
    const choices = surfaceViews[index];
    const visible = planSurface || nz < 0 && views.bottom ? choices : surfaceViews[index - (nz * 9)];
    let total = 0;
    let red = 0, green = 0, blue = 0;
    for (const direction of visible) {
      if (!planSurface && direction === 'top') continue;
      const view = views[direction]!;
      const p = sample(view, ...viewUV(direction, (x + .5) / width, (y + .5) / depth, (z + .5) / layers));
      if (view.data[p + 3] < 128) continue;
      const r = view.data[p], g = view.data[p + 1], b = view.data[p + 2];
      if (total && Math.max(Math.abs(r - red / total), Math.abs(g - green / total), Math.abs(b - blue / total)) > 66) continue;
      const weight = direction === 'front' || direction === 'rear' ? .1 + Math.abs(ny)
        : direction === 'left' || direction === 'right' ? .1 + Math.abs(nx) : .1 + Math.abs(nz);
      red += r * weight; green += g * weight; blue += b * weight;
      total += weight;
    }
    if (total) {
      data[q] = Math.round(red / total); data[q + 1] = Math.round(green / total);
      data[q + 2] = Math.round(blue / total); data[q + 3] = 255;
    }
  }
  return { target: 'stack', size, pivot, width, depth, layers, columns, spacing: size[2] / layers,
    texture: { width: imageWidth, height: imageHeight, data } };
}

export function reconstruct(input: ViewSet, target: 'mesh' | 'stack', settings: Settings = {}): AssetData {
  return reconstructPrepared(prepareViews(input, settings.threshold), target, settings);
}

export function reconstructPrepared(views: ViewSet, target: 'mesh' | 'stack', settings: Settings): AssetData {
  let mesh: MeshData;
  if (target === 'mesh' && settings.meshMethod === 'contour') {
    const { size, pivot } = reconstructionDimensions(views, settings);
    const { tiles, texture } = textureAtlas(views, {}, true);
    const front = views.front!;
    const scale = Math.min(1, 1024 / Math.max(front.width, front.height));
    const mask = resize(front, Math.max(1, Math.round(front.width * scale)), Math.max(1, Math.round(front.height * scale)));
    mesh = extrudeContours(views, size, pivot, mask, tiles, texture, settings.contourHub ?? false, settings.resolution ?? 96);
  } else {
    const g = grid(views, settings);
    if (target === 'stack') return makeStack(g, g.aligned);
    mesh = makeMesh(g, views);
  }
  if (settings.textureProjection === 'top-contour')
    projectUpperContour(mesh, views.top!, settings.resolution ?? 96, settings.layers ?? DEFAULT_LAYERS);
  return mesh;
}

function comparisonMeshes(views: ViewSet, g: Grid) {
  return (['rgb', 'id', 'depth'] as const).map(mode => makeMesh(g, views, mode));
}

/** The three comparison stages share the same source and silhouette reconstruction. */
export function compareAtlasMeshes(input: ViewSet, settings: Settings = {}): ComparisonMesh[] {
  const views = prepareViews(input, settings.threshold);
  return comparisonMeshes(views, grid(views, settings));
}

function clayMesh(g: Grid, surface: ReturnType<typeof extractSurface>): MeshData {
  const { size, pivot, width, depth, layers } = g;
  const positions = new Float32Array(surface.positions.length);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (surface.positions[i] / width - .5) * size[0];
    positions[i + 1] = surface.positions[i + 2] / layers * size[2] - pivot[2];
    positions[i + 2] = (.5 - surface.positions[i + 1] / depth) * size[1];
    const nx = surface.gradients[i] * width / size[0], ny = surface.gradients[i + 2] * layers / size[2];
    const nz = -surface.gradients[i + 1] * depth / size[1];
    const magnitude = Math.hypot(nx, ny, nz) || 1;
    normals.set([nx / magnitude, ny / magnitude, nz / magnitude], i);
  }
  return { target: 'mesh', size, pivot, positions, normals, indices: Uint32Array.from(surface.indices),
    uvs: new Float32Array(positions.length / 3 * 2),
    texture: { width: 1, height: 1, data: Uint8Array.of(255, 255, 255, 255) } };
}

export function compareAtlasPipeline(input: ViewSet, settings: Settings = {}) {
  const views = prepareViews(input, settings.threshold);
  const full = grid(views, settings);
  const coarse = grid(views, {
    ...settings, size: full.size,
    resolution: Math.max(16, Math.min(48, Math.floor((settings.resolution ?? 96) / 2))),
    layers: Math.max(8, Math.min(32, Math.floor(full.layers / 2))),
  }, full);
  const { volume, width, depth, layers } = coarse;
  const voxel = clayMesh(coarse, extractVoxelSurface(volume, width, depth, layers));
  const marching = clayMesh(coarse, extractSurface(volume, width, depth, layers));
  const dimensions = (g: Grid): Vec3 => [g.width, g.depth, g.layers];
  return { voxel, marching, meshes: comparisonMeshes(views, full), stack: makeStack(full, full.aligned),
    coarseGrid: dimensions(coarse), fullGrid: dimensions(full) };
}
