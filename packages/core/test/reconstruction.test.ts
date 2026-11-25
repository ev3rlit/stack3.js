import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { compareAtlasMeshes, compareAtlasPipeline, DIRECTIONS, encodeGlb, encodePng, encodeStack, inspectViews, parseLayout, prepareViews, respaceStack,
  readPngSize, readStackPngSize, readStackBundle, reconstruct, splitAtlas, type Raster, type ViewSet } from '../src/index';

const example = readFileSync(new URL('../../../apps/viewer/public/examples/traffic-cone-4view.png', import.meta.url));
const atlas = PNG.sync.read(example);
const layout = parseLayout('top,left,front,rear');

test('round-base retains the square foot while rounding the cone above it', () => {
  const views = splitAtlas(atlas, layout);
  const sample = { layers: 24, resolution: 48, pivot: 'center' } as const;
  const silhouette = reconstruct(views, 'stack', sample);
  const rounded = reconstruct(views, 'stack', { ...sample, profile: 'round-base' });
  assert.equal(silhouette.target, 'stack');
  assert.equal(rounded.target, 'stack');
  const coverage = (stack: typeof rounded, layer: number) => {
    let occupied = 0;
    for (let y = 0; y < stack.depth; y++) for (let x = 0; x < stack.width; x++) {
      const row = Math.floor(layer / stack.columns) * stack.depth + y;
      const column = (layer % stack.columns) * stack.width + x;
      occupied += Number(stack.texture.data[4 * (row * stack.texture.width + column) + 3] > 0);
    }
    return occupied;
  };
  assert.equal(coverage(rounded, 0), coverage(silhouette, 0));
  assert.ok(coverage(rounded, 12) < coverage(silhouette, 12));
  const spaced = respaceStack(rounded, 1.5);
  assert.equal(spaced.texture, rounded.texture);
  assert.equal(spaced.spacing, rounded.spacing * 1.5);
  assert.equal(spaced.pivot[2], rounded.pivot[2] * 1.5);
});

test('four-view PNG atlas and separate view PNGs yield the same mesh and stack', () => {
  const tiles = splitAtlas(atlas, layout);
  const separate = Object.fromEntries(Object.entries(tiles).map(([name, image]) =>
    [name, PNG.sync.read(Buffer.from(encodePng(image)))]));
  assert.equal(inspectViews(prepareViews(tiles)).warnings.length, 0);
  const settings = { layers: 24, resolution: 40, height: 1.4 } as const;
  const mesh = reconstruct(tiles, 'mesh', settings);
  const stack = reconstruct(tiles, 'stack', settings);
  assert.deepEqual(mesh, reconstruct(separate, 'mesh', settings));
  assert.deepEqual(stack, reconstruct(separate, 'stack', settings));
  assert.deepEqual(mesh.size, stack.size);
  assert.deepEqual(mesh.pivot, stack.pivot);
  assert.deepEqual(mesh.size, reconstruct(tiles, 'mesh', { ...settings, layers: 30 }).size);
});

test('exports carry valid GLB geometry, an embedded image and stack spacing', () => {
  const tiles = splitAtlas(atlas, layout);
  const mesh = reconstruct(tiles, 'mesh', { layers: 22, resolution: 36 });
  const stack = reconstruct(tiles, 'stack', { layers: 22, resolution: 36 });
  assert.equal(mesh.target, 'mesh');
  assert.equal(stack.target, 'stack');
  assert(mesh.indices.length > 600);
  const glb = encodeGlb(mesh), head = new DataView(glb.buffer);
  assert.equal(head.getUint32(0, true), 0x46546c67);
  assert.equal(head.getUint32(8, true), glb.length);
  const jsonLength = head.getUint32(12, true);
  const graph = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  assert.equal(graph.accessors[0].count, mesh.positions.length / 3);
  assert.equal(graph.accessors[3].count, mesh.indices.length);
  const bufferView = graph.bufferViews[graph.images[0].bufferView];
  const offset = 28 + jsonLength + bufferView.byteOffset;
  const png = glb.subarray(offset, offset + bufferView.byteLength);
  assert.deepEqual(readPngSize(png), { width: mesh.texture.width, height: mesh.texture.height });
  const bundle = encodeStack(stack);
  assert.equal(bundle.manifest.spacing * bundle.manifest.layers, 1);
  assert.equal(bundle.manifest.layerOrder, 'bottom-to-top');
  const decoded = PNG.sync.read(Buffer.from(bundle.png));
  const texture = { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
  assert.deepEqual(readStackBundle(JSON.parse(JSON.stringify(bundle.manifest)), texture), stack);
  assert.throws(() => readStackBundle({ ...bundle.manifest, width: stack.width + 1 }, texture), /does not match/);
});

test('six directional views paint their own faces', () => {
  function solid(color: [number, number, number]): Raster {
    const data = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i);
    return { width: 8, height: 8, data };
  }
  const samples: Array<[number, number, number]> = [[29,45,72],[27,63,119],[133,42,61],[73,13,28],[13,154,15],[106,20,121]];
  const views: ViewSet = Object.fromEntries(DIRECTIONS.map((dir,index) => [dir,solid(samples[index])]));
  const mesh = reconstruct(views, 'mesh', { layers: 8, resolution: 16 });
  assert.equal(mesh.target, 'mesh');
  const readColor = (i: number) => {
    const u = Math.floor(mesh.uvs[i * 2] * mesh.texture.width), v = Math.floor(mesh.uvs[i * 2 + 1] * mesh.texture.height);
    const p = (v * mesh.texture.width + u) * 4;
    return [...mesh.texture.data.subarray(p, p + 3)];
  };
  assert(mesh.normals.length > 0);
  let right = 0, bottom = 0;
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    if (mesh.normals[i * 3] > .99) { assert.deepEqual(readColor(i), samples[4]); right++; }
    if (mesh.normals[i * 3 + 1] < -.99) { assert.deepEqual(readColor(i), samples[5]); bottom++; }
  }
  assert(right > 10 && bottom > 10);
});

test('invalid layouts and PNG dimensions are rejected', () => {
  assert.throws(() => parseLayout('top,left,front,front'), /duplicates/);
  assert.throws(() => splitAtlas(atlas, parseLayout('top,left,front,rear,right,bottom')), /Expected 6/);
  const png = new Uint8Array(example);
  new DataView(png.buffer).setUint32(16, 9000);
  assert.throws(() => readPngSize(png), /input limit/);
});


test('comparison isolates accent projection from geometry fitting', () => {
  const views = splitAtlas(atlas, layout);
  const settings = { layers: 24, resolution: 40 };
  const [rgb, id, depth] = compareAtlasMeshes(views, settings);
  assert.deepEqual(rgb, reconstruct(views, 'mesh', settings));
  assert.notDeepEqual(rgb.texture, id.texture);
  function expandedVertices(mesh: typeof rgb) {
    const vertices = new Float32Array(mesh.indices.length * 3);
    mesh.indices.forEach((index, i) => vertices.set(mesh.positions.subarray(index * 3, index * 3 + 3), i * 3));
    return vertices;
  }
  assert.deepEqual(expandedVertices(id), expandedVertices(rgb));
  assert.deepEqual(id.texture, depth.texture);
  assert.ok(depth.indices.length > 0);
  assert.notDeepEqual(expandedVertices(depth), expandedVertices(id));
  assert.deepEqual(depth.size, rgb.size);
});

test('a small front light becomes a separate planar decal in both comparison modes', () => {
  const makeView = (light: boolean): Raster => {
    const width = 24, height = 24;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([120, 120, 120, 255], i * 4);
    if (light) {
      for (let y = 11; y < 15; y++) for (let x = 8; x < 12; x++) {
        data.set([244, 170, 14, 255], (y * width + x) * 4);
      }
    }
    return { width, height, data };
  };
  const [rgb, id, depth] = compareAtlasMeshes({
    top: makeView(true), left: makeView(false), front: makeView(true), rear: makeView(false),
  }, { layers: 24, resolution: 32 });
  assert.equal(rgb.frontAccents, undefined);
  const decal = id.frontAccents;
  assert.ok(decal);
  assert.deepEqual(decal, depth.frontAccents);
  assert.ok(decal.texture.data.some((value, i) => i % 4 === 3 && value === 0));
  for (let i = 0; i < decal.indices.length; i += 3) {
    const [a, b, c] = decal.indices.subarray(i, i + 3);
    assert.equal(decal.positions[a * 3 + 2], decal.positions[b * 3 + 2]);
    assert.equal(decal.positions[a * 3 + 2], decal.positions[c * 3 + 2]);
    assert.equal(decal.normals[a * 3 + 2], -1);
  }
});


test('pipeline shows voxel and interpolated surfaces at the same coarse grid before increasing samples', () => {
  const views = splitAtlas(atlas, layout);
  const settings = { layers: 32, resolution: 56 };
  const result = compareAtlasPipeline(views, settings);
  assert.equal(Math.max(...result.coarseGrid.slice(0, 2)), 28);
  assert.equal(Math.max(...result.fullGrid.slice(0, 2)), 56);
  assert.equal(result.coarseGrid[2], 16);
  assert.equal(result.fullGrid[2], 32);
  assert.equal(result.stack.layers, 32);
  assert.equal(result.stack.spacing * result.stack.layers, result.stack.size[2]);
  assert.deepEqual(result.stack.size, result.meshes[0].size);
  assert.deepEqual(result.voxel.size, result.marching.size);
  assert.deepEqual(result.voxel.size, result.meshes[0].size);
  assert.notDeepEqual(result.voxel.positions, result.marching.positions);
  for (let i = 0; i < result.voxel.normals.length; i += 3) {
    assert.equal(Math.abs(result.voxel.normals[i]) + Math.abs(result.voxel.normals[i + 1]) +
      Math.abs(result.voxel.normals[i + 2]), 1);
  }
  assert.deepEqual(result.meshes[0], reconstruct(views, 'mesh', settings));
});

test('default stacks have 128 layers even when a fitted elevation has fewer rows', () => {
  const raster = { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(127) };
  for (let i = 3; i < raster.data.length; i += 4) raster.data[i] = 255;
  const views = { top: raster, left: raster, front: raster, rear: raster };
  assert.deepEqual(inspectViews(views).nativeSamples, { x: 20, y: 20, z: 20 });
  const stack = reconstruct(views, 'stack', { resolution: 20 });
  assert.equal(stack.target, 'stack');
  assert.equal(stack.layers, 128);
});

test('stacks beyond the old layer, XY and cell ceilings round-trip through PNG and manifest', () => {
  const views = splitAtlas(atlas, layout);
  const stack = reconstruct(views, 'stack', { resolution: 200, layers: 144, size: [1, 1, 1] });
  assert.equal(stack.target, 'stack');
  assert.deepEqual([stack.width, stack.depth, stack.layers], [200, 200, 144]);
  const bundle = encodeStack(stack);
  assert.deepEqual(readStackBundle(bundle.manifest, PNG.sync.read(Buffer.from(bundle.png))).texture.data,
    Buffer.from(stack.texture.data));
  // Output tile sheets can be much larger than the source PNGs accepted for carving.
  const header = bundle.png.slice(0, 33);
  const height = stack.depth * Math.ceil(500 / stack.columns);
  new DataView(header.buffer).setUint32(20, height);
  assert.throws(() => readPngSize(header), /input limit/);
  assert.throws(() => readStackPngSize(header, bundle.manifest), /manifest/);
  assert.deepEqual(readStackPngSize(header, { ...bundle.manifest, layers: 500 }), { width: stack.texture.width, height });
});

test('Surface Nets has finite normals for every binary corner configuration', async () => {
  const { extractSurfaceNets } = await import('../src/surface');
  for (let mask = 1; mask < 256; mask++) {
    const volume = Uint8Array.from({ length: 8 }, (_, i) => (mask >> i) & 1);
    const { gradients } = extractSurfaceNets(volume, 2, 2, 2);
    for (let i = 0; i < gradients.length; i += 3) {
      const length = Math.hypot(gradients[i], gradients[i + 1], gradients[i + 2]);
      assert.ok(Number.isFinite(length) && length > 1e-10, String(mask));
    }
  }
});
