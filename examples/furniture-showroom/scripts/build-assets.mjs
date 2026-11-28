import { mkdir, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { encodeGlb, encodePng, encodeStack, reconstructPrepared, meshFromStack } from '@stack3/core';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { applyFinishes } from './materials.mjs';
import { catalog, makeFurniture } from '../src/furniture.mjs';

// GLTFExporter uses the browser FileReader contract for its binary buffer.
globalThis.ImageData = ImageData;
globalThis.document = { createElement: () => createCanvas(1, 1) };
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};
const output = new URL('../public/models/', import.meta.url);
const projections = {
  top: ([x, y, z]) => [x, -z, y],
  left: ([x, y, z]) => [z, -y, -x],
  front: ([x, y, z]) => [x, -y, -z],
  rear: ([x, y, z]) => [-x, -y, z],
};
function rasterize(group, direction) {
  const project = projections[direction],
    meshes = [];
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const { position } = mesh.geometry.attributes,
      vertices = [];
    for (let i = 0; i < position.count; i++) {
      const point = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const [x, y, z] = project(point.toArray());
      vertices.push([x, y, z]);
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    const hex = mesh.material.color.getHex();
    meshes.push({
      vertices,
      indices: mesh.geometry.index?.array,
      uv: mesh.geometry.attributes.uv,
      texture: mesh.material.map?.image,
      rgb: [hex >> 16, (hex >> 8) & 255, hex & 255],
    });
  });
  const scale = 256 / Math.max(xmax - xmin, ymax - ymin);
  const width = Math.max(1, Math.round((xmax - xmin) * scale)),
    height = Math.max(1, Math.round((ymax - ymin) * scale));
  const data = new Uint8Array(width * height * 4),
    depth = new Float64Array(width * height).fill(-Infinity);
  for (const { vertices, indices, rgb, uv, texture } of meshes) {
    const screen = vertices.map(([x, y, z]) => [
      ((x - xmin) * width) / (xmax - xmin),
      ((y - ymin) * height) / (ymax - ymin),
      z,
    ]);
    for (let i = 0; i < (indices?.length ?? screen.length); i += 3) {
      const corners = [0, 1, 2].map((j) => (indices ? indices[i + j] : i + j));
      const [a, b, c] = corners.map((j) => screen[j]);
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-10) continue;
      const lowX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
        highX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const lowY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
        highY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = lowY; y <= highY; y++)
        for (let x = lowX; x <= highX; x++) {
          const dx = x + 0.5 - c[0],
            dy = y + 0.5 - c[1];
          const u = ((b[1] - c[1]) * dx + (c[0] - b[0]) * dy) / det;
          const v = ((c[1] - a[1]) * dx + (a[0] - c[0]) * dy) / det,
            w = 1 - u - v;
          if (Math.min(u, v, w) < -1e-8) continue;
          const z = u * a[2] + v * b[2] + w * c[2],
            p = y * width + x;
          if (z <= depth[p]) continue;
          depth[p] = z;
          if (texture) {
            const [i0, i1, i2] = corners;
            const tx = u * uv.getX(i0) + v * uv.getX(i1) + w * uv.getX(i2);
            const ty = u * uv.getY(i0) + v * uv.getY(i1) + w * uv.getY(i2);
            const pixel =
              4 *
              (Math.floor((ty - Math.floor(ty)) * texture.height) * texture.width +
                Math.floor((tx - Math.floor(tx)) * texture.width));
            data.set(texture.data.subarray(pixel, pixel + 4), 4 * p);
          } else {
            data.set(rgb, 4 * p);
            data[4 * p + 3] = 255;
          }
        }
    }
  }
  return { data, width, height };
}
const stats = {};
for (const { id } of catalog) {
  const dir = new URL(id + '/', output);
  await mkdir(dir, { recursive: true });
  const source = makeFurniture(id);
  applyFinishes(source);
  const reference = await new GLTFExporter().parseAsync(source, { binary: true });
  await writeFile(new URL('reference.glb', dir), new Uint8Array(reference));
  const dims = new T.Box3().setFromObject(source, true).getSize(new T.Vector3());
  const views = {};
  for (const key of Object.keys(projections)) {
    views[key] = rasterize(source, key);
    await writeFile(new URL(key + '.png', dir), encodePng(views[key]));
  }
  const stack = reconstructPrepared(views, 'stack', {
    size: [dims.x, dims.z, dims.y],
    pivot: 'ground',
    resolution: 64,
    layers: 64,
  });
  const bundle = encodeStack(stack);
  await writeFile(new URL('stack.png', dir), bundle.png);
  await writeFile(new URL('stack.json', dir), JSON.stringify(bundle.manifest, null, 2) + '\n');
  const mesh = meshFromStack(stack);
  await writeFile(new URL('stack3.glb', dir), encodeGlb(mesh, { lit: true }));
  let triangles = 0;
  source.traverse((object) => {
    if (object.isMesh)
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  stats[id] = {
    size: dims.toArray(),
    reference: triangles,
    stack3: mesh.indices.length / 3,
    grid: [stack.width, stack.depth, stack.layers],
  };
  console.log(id, stats[id].reference, stats[id].stack3);
}
await writeFile(new URL('catalog.json', output), JSON.stringify(stats, null, 2) + '\n');
