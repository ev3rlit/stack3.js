import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StackData } from '@stack3/core';
import { TrackBelt } from '../../../packages/three/src/track-belt';

test('track belt shifts the outer tread in both directions, preserves the interior and restores its texture', () => {
  const depth = 9, layers = 5, width = 2;
  const texture = { width, height: depth * layers, data: new Uint8Array(width * depth * layers * 4).fill(100) };
  const stack: StackData = { target: 'stack', texture, width, depth, layers, columns: 1,
    size: [1, 3, 1], pivot: [0, 0, 0], spacing: .2 };
  const tread = { width: 1, height: 32, data: new Uint8Array(32 * 4) };
  for (let i = 0; i < 32; i++) tread.data.set([i * 8, 0, 0, 255], i * 4);
  const belt = new TrackBelt(stack, tread);
  assert(belt.update(.5, 3, 1));
  const forward = belt.asset.texture.data.slice();
  assert(belt.update(-.5, 3, 1));
  assert.notDeepEqual(belt.asset.texture.data, forward);
  const interior = ((2 * depth + 4) * width) * 4;
  assert.deepEqual(belt.asset.texture.data.slice(interior, interior + 4), Uint8Array.of(100, 100, 100, 100));
  assert(belt.asset.texture.data.every((value, i) => i % 4 !== 3 || value === 100));
  assert(texture.data.every(value => value === 100));
  assert(belt.update(undefined, 3, 1));
  assert.deepEqual(belt.asset.texture.data, texture.data);
});
