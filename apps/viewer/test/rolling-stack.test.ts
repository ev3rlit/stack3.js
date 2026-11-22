import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StackData } from '@stack3/core';
import { RollingStack } from '../../../packages/three/src/rolling-stack';

test('wheel roll resamples source voxels into horizontal slices without mutating the atlas', () => {
  const data = new Uint8Array(6 * 3 * 4);
  const source = { target: 'stack', width: 2, depth: 3, layers: 3, columns: 3, spacing: 1,
    size: [2, 2, 3], pivot: [0, 0, 0], texture: {width: 6, height: 3, data} } satisfies StackData;
  const pixel = (layer: number, y: number) => (y * 6 + layer * 2) * 4;
  data.set([120, 80, 60, 255], pixel(1, 2));
  const wheel = new RollingStack(source);
  assert.deepEqual(wheel.asset.texture.data, data);
  assert.equal(wheel.update(90, 1), true);
  assert.deepEqual(wheel.asset.texture.data.slice(pixel(0, 1), pixel(0, 1) + 4), Uint8Array.of(120, 80, 60, 255));
  assert.equal(wheel.rows[1], 5);
  assert.equal(data[pixel(1, 2) + 3], 255);
  assert.equal(wheel.update(90, 1), false);
  wheel.update(0, 1);
  assert.deepEqual(wheel.asset.texture.data, data);
});
