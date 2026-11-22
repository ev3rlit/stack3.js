import * as THREE from 'three';
import type { AssetData, MeshData, Raster, StackData } from '@stack3/core';
import { RollingStack } from './rolling-stack';
import { TrackBelt } from './track-belt';

const stackSlices = new WeakMap<THREE.Mesh, { stack: StackData; layer: number; roll?: RollingStack; bounds: readonly [number, number, number, number] | null }>();

export function getStackSlice(mesh: THREE.Mesh) {
  return stackSlices.get(mesh);
}

function dataTexture(image: Raster, filter: THREE.MagnificationTextureFilter) {
  const texture = new THREE.DataTexture(image.data, image.width, image.height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = filter;
  texture.minFilter = filter;
  texture.needsUpdate = true;
  return texture;
}

function makeMesh(asset: MeshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(asset.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(asset.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(asset.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(asset.indices, 1));
  const map = dataTexture(asset.texture, THREE.LinearFilter);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map }));
}

function makeStack(asset: StackData, roll?: RollingStack) {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(asset.size[0], asset.size[1]);
  geometry.rotateX(-Math.PI / 2);
  const atlas = dataTexture(asset.texture, THREE.LinearFilter);
  for (let layer = 0; layer < asset.layers; layer++) {
    const texture = layer === 0 ? atlas : atlas.clone();
    const left = layer % asset.columns * asset.width, top = Math.floor(layer / asset.columns) * asset.depth;
    // Sample between the centers of the tile's outer texels so linear filtering stays inside the slice.
    texture.offset.set((left + .5) / asset.texture.width, (top + .5) / asset.texture.height);
    texture.repeat.set((asset.width - 1) / asset.texture.width, (asset.depth - 1) / asset.texture.height);
    const material = new THREE.MeshBasicMaterial({
      map: texture, alphaTest: .5, alphaToCoverage: true, side: THREE.DoubleSide,
    });
    const slice = new THREE.Mesh(geometry, material);
    let x0 = asset.width, y0 = asset.depth, x1 = -1, y1 = -1;
    if (!roll) for (let y = 0; y < asset.depth; y++) for (let x = 0; x < asset.width; x++) {
      if (asset.texture.data[((top + y) * asset.texture.width + left + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    // Include a texel around the mask for bilinear filtering.
    stackSlices.set(slice, { stack: asset, layer, roll, bounds: roll ? [0, 0, 1, 1] : x1 < 0 ? null : [
      Math.max(0, x0 - 1) / (asset.width - 1), Math.max(0, y0 - 1) / (asset.depth - 1),
      Math.min(asset.width - 1, x1 + 1) / (asset.width - 1), Math.min(asset.depth - 1, y1 + 1) / (asset.depth - 1),
    ] });
    slice.position.y = (layer + .5) * asset.spacing - asset.pivot[2];
    group.add(slice);
  }
  return group;
}

function updateSliceTextures(object: THREE.Group) {
  for (const child of object.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]) {
    child.material.map!.needsUpdate = true;
  }
}

export function createRollingStackObject(source: StackData) {
  const roll = new RollingStack(source);
  const object = makeStack(roll.asset, roll);
  return {
    object,
    setRoll(degrees: number, spacing: number) {
      if (roll.update(degrees, spacing)) updateSliceTextures(object);
    },
  };
}

export function createTrackBeltObject(source: StackData, tread: Raster) {
  const belt = new TrackBelt(source, tread);
  const object = makeStack(belt.asset);
  return {
    object,
    setTravel(travel: number | undefined, depth: number, height: number) {
      if (belt.update(travel, depth, height)) updateSliceTextures(object);
    },
  };
}

export function setStackPreviewFilters(object: THREE.Object3D, pixelArt: boolean, smoothEdges: boolean) {
  const filter = pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
  object.traverse(slice => {
    if (!(slice instanceof THREE.Mesh) ||
      !(slice.material instanceof THREE.MeshBasicMaterial || slice.material instanceof THREE.MeshLambertMaterial)) return;
    const { material } = slice;
    const texture = material.map;
    if (texture && texture.magFilter !== filter) {
      texture.magFilter = filter;
      texture.minFilter = filter;
      texture.needsUpdate = true;
    }
    if (material.alphaToCoverage !== smoothEdges) {
      material.alphaToCoverage = smoothEdges;
      material.needsUpdate = true;
    }
  });
}

export function createAssetObject(asset: AssetData): THREE.Object3D {
  return asset.target === 'mesh' ? makeMesh(asset) : makeStack(asset);
}

export function setPreviewLighting(object: THREE.Object3D, enabled: boolean) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const current = child.material;
    if (enabled && !(current instanceof THREE.MeshBasicMaterial)) return;
    if (!enabled && !(current instanceof THREE.MeshLambertMaterial)) return;
    const parameters = {
      map: current.map, side: current.side, alphaTest: current.alphaTest, alphaToCoverage: current.alphaToCoverage,
    };
    child.material = enabled ? new THREE.MeshLambertMaterial(parameters) : new THREE.MeshBasicMaterial(parameters);
    current.dispose();
  });
}

export function disposeAssetObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      if (material.map instanceof THREE.Texture) textures.add(material.map);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}
