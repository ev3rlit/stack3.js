import * as THREE from 'three';
import { createAssetObject } from '@stack3/three';
import type { AssetData, StackData } from '@stack3/core';

export type XYZ = [number, number, number];
export type Mount = { name: string; position: XYZ; scale?: number; mirrorX?: boolean; mirrorY?: boolean };
export type MatrixMount = Mount & { matrix?: number[] };
export type PartLayout = { name: string; mounts: Mount[] };
export type PlacedAsset = Mount & { asset: AssetData };

export function instantiateParts(assets: AssetData[], parts: PartLayout[]): PlacedAsset[] {
  return parts.flatMap((part, index) => part.mounts.map(mount => ({ ...mount, asset: assets[index] })));
}

export function createAssemblyObject(parts: PlacedAsset[]) {
  const group = new THREE.Group();
  for (const { asset, name, position: [x, y, z], scale = 1, mirrorX, mirrorY } of parts) {
    const object = createAssetObject(asset);
    object.name = name;
    object.position.set(x, z, -y);
    object.scale.set(mirrorX ? -scale : scale, scale, mirrorY ? -scale : scale);
    group.add(object);
  }
  return group;
}

export function bakeStack(parts: PlacedAsset[]): StackData {
  if (parts.length === 0 || parts.some(({ asset }) => asset.target !== 'stack')) {
    throw new Error('A stack assembly needs reconstructed stack parts.');
  }
  const placed = parts as (Omit<PlacedAsset, 'asset'> & { asset: StackData })[];
  const bounds = placed.map(({ asset, position: [x, y, z], scale = 1 }) => {
    const [w, d, h] = asset.size.map(length => length * scale);
    const bottom = z - asset.pivot[2] * scale;
    return { min: [x - w / 2, y - d / 2, bottom], max: [x + w / 2, y + d / 2, bottom + h] };
  });
  const low = [0, 1, 2].map(axis => Math.min(...bounds.map(({ min }) => min[axis])));
  const high = [0, 1, 2].map(axis => Math.max(...bounds.map(({ max }) => max[axis])));
  const size = high.map((value, axis) => value - low[axis]) as XYZ;
  const density = Math.max(...placed.map(({ asset, scale = 1 }) =>
    Math.max(asset.width / asset.size[0], asset.depth / asset.size[1]) / scale));
  const width = Math.max(1, Math.round(size[0] * density)), depth = Math.max(1, Math.round(size[1] * density));
  const spacing = Math.min(...placed.map(({ asset, scale = 1 }) => asset.spacing * scale));
  const layers = Math.max(1, Math.ceil(size[2] / spacing));
  const step = [size[0] / width, size[1] / depth, size[2] / layers];
  const columns = Math.min(layers, Math.max(1, Math.floor(4096 / width)));
  const imageWidth = width * columns, imageHeight = depth * Math.ceil(layers / columns);
  const data = new Uint8Array(4 * imageWidth * imageHeight);

  for (const [index, { asset, mirrorX, mirrorY }] of placed.entries()) {
    const { min, max } = bounds[index];
    const start = min.map((coordinate, axis) => Math.ceil((coordinate - low[axis]) / step[axis] - .5));
    const end = max.map((coordinate, axis) => Math.ceil((coordinate - low[axis]) / step[axis] - .5));
    const sample = (cell: number, axis: number, limit: number) => Math.max(0, Math.min(limit - 1,
      Math.floor((low[axis] + (cell + .5) * step[axis] - min[axis]) * limit / (max[axis] - min[axis]))));
    for (let z = start[2]; z < end[2]; z++) for (let y = start[1]; y < end[1]; y++) {
      const sz = sample(z, 2, asset.layers), sy = sample(y, 1, asset.depth);
      const sourceRow = (Math.floor(sz / asset.columns) * asset.depth + (mirrorY ? asset.depth - 1 - sy : sy)) * asset.texture.width;
      const targetRow = (Math.floor(z / columns) * depth + y) * imageWidth;
      for (let x = start[0]; x < end[0]; x++) {
        const sx = sample(x, 0, asset.width);
        const source = 4 * (sourceRow + sz % asset.columns * asset.width + (mirrorX ? asset.width - 1 - sx : sx));
        if (asset.texture.data[source + 3] < 128) continue;
        const dest = 4 * (targetRow + z % columns * width + x);
        for (let channel = 0; channel < 4; channel++) data[dest + channel] = asset.texture.data[source + channel];
      }
    }
  }
  return { target: 'stack', width, depth, layers, columns, spacing: step[2], size, pivot: [0, 0, -low[2]],
    texture: { width: imageWidth, height: imageHeight, data } };
}
