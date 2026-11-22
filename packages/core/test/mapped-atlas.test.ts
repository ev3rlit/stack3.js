import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { decodeDepthPng, reconstructMappedAtlas, type AtlasCalibration } from '../src/index';

const sample = new URL('../../../samples/future-tank/', import.meta.url);
const read = (filename: string) => readFileSync(new URL(filename, sample));
const image = (pass: string) => PNG.sync.read(read('hull-' + pass + '-4view.png'));

test('registered depth preserves 16-bit values and reconstructs a textured hull from the four views', () => {
  const depth = decodeDepthPng(read('hull-depth-4view.png'));
  const clay = image('clay');
  assert.deepEqual([depth.width, depth.height], [1874, 692]);
  let covered = 0, maximum = 0;
  for (let i = 0; i < depth.data.length; i++) {
    assert.equal(depth.data[i] !== 0, clay.data[i * 4 + 3] > 127);
    if (depth.data[i]) covered++;
    maximum = Math.max(maximum, depth.data[i]);
  }
  assert.equal(covered, 343855);
  assert.equal(maximum, 63571);
  assert.throws(() => decodeDepthPng(read('hull-clay-4view.png')), /16-bit grayscale/);

  const calibration = JSON.parse(read('hull-depth-4view.json').toString()) as AtlasCalibration;
  const { mesh, normalMap, grid, silhouetteMesh, fit } = reconstructMappedAtlas({
    calibration, depth, clay, baseColor: image('base-color'), normal: image('normal'),
  }, { layers: 18, resolution: 32 });
  assert.deepEqual(grid, [17, 32, 18]);
  assert.deepEqual(mesh.size, calibration.size);
  assert.deepEqual(silhouetteMesh.size, mesh.size);
  assert.equal(fit.referencePixels, covered);
  assert.ok(fit.sharedPixels > 0.95 * covered);
  assert.equal(fit.byView.length, 4);
  assert.ok(fit.baselineMae !== null && fit.carvedMae !== null && fit.carvedMae < fit.baselineMae);
  assert.ok(mesh.indices.length > 2000);
  assert.equal(mesh.uvs.length, mesh.positions.length / 3 * 2);
  assert.equal(mesh.texture.width, normalMap.width);
  const offset = (322 * normalMap.width + 199) * 4;
  assert.equal(normalMap.data[offset + 3], 255);
  assert.ok(normalMap.data[offset + 1] > 245, 'the top-facing normal maps to object-space +Y');
});
