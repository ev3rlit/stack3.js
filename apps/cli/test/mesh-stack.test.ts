import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

test('mesh consumes saved layers, including an edited internal cell, without an atlas', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-mesh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
  const image = new PNG({ width: 10, height: 15 });
  image.data.fill(255);
  // Five 5x5 slices in two columns. The sixth tile is unused padding.
  const meta = { version: 1, atlas: 'stack.png', width: 5, depth: 5, layers: 5, columns: 2,
    spacing: 2, size: [5, 5, 10], pivot: [1, 2, 5], layout: 'row-major',
    layerOrder: 'bottom-to-top', axes: 'xy-ground-z-up-y-forward' };
  writeFileSync(join(dir, 'stack.json'), JSON.stringify(meta));
  const run = () => {
    writeFileSync(join(dir, 'stack.png'), PNG.sync.write(image));
    return spawnSync(process.execPath, [cli, 'mesh', '.', '--output', 'result.glb'], { cwd: dir, encoding: 'utf8' });
  };
  const read = () => {
    const glb = readFileSync(join(dir, 'result.glb'));
    return JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  };
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const solid = read();
  const positions = solid.accessors[0];
  const center = positions.min.map((v: number, i: number) => (v + positions.max[i]) / 2);
  center.forEach((v: number, i: number) => assert.ok(Math.abs(v - [-1, 0, 2][i]) < 1e-5));
  image.data[4 * (7 * image.width + 2) + 3] = 0; // center cell of the middle slice
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const cavity = read();
  assert.ok(cavity.accessors[3].count > solid.accessors[3].count);
  assert.deepEqual(cavity.accessors[0].max, positions.max);
  // Fully empty slices, even with opaque padding, cannot produce a surface.
  for (let y = 0; y < 15; y++) for (let x = 0; x < 10; x++) {
    if (y < 10 || x < 5) image.data[4 * (y * 10 + x) + 3] = 0;
  }
  assert.match(run().stderr, /no occupied samples/);
});

test('stack mesh methods preserve cavities and winding, and expose different surfaces', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-methods-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
  const image = new PNG({ width: 15, height: 5 }); // five 3x5 layers in a single row
  image.data.fill(255);
  writeFileSync(join(dir, 'stack.json'), JSON.stringify({ version: 1, atlas: 'stack.png', width: 3, depth: 5,
    layers: 5, columns: 5, spacing: 2, size: [3, 5, 10], pivot: [0, 0, 5], layout: 'row-major',
    layerOrder: 'bottom-to-top', axes: 'xy-ground-z-up-y-forward' }));
  image.data[4 * (2 * 15 + 2 * 3 + 1) + 3] = 0;
  writeFileSync(join(dir, 'stack.png'), PNG.sync.write(image));
  const run = (method: string) => spawnSync(process.execPath, [cli, 'mesh', '.', '--mesh-method', method,
    '--output', 'result.glb'], { cwd: dir, encoding: 'utf8' });
  const volumes = new Set<number>();
  for (const method of ['marching-cubes', 'surface-nets', 'voxel']) {
    const result = run(method);
    assert.equal(result.status, 0, result.stderr);
    const bytes = readFileSync(join(dir, 'result.glb'));
    const length = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + length));
    const binary = 28 + length;
    const indexStart = binary + doc.bufferViews[3].byteOffset, positionStart = binary + doc.bufferViews[0].byteOffset;
    const edges = new Map<string, number>();
    const vertex = (i: number) => {
      const start = positionStart + 12 * bytes.readUInt32LE(indexStart + 4 * i);
      return [0, 4, 8].map(offset => bytes.readFloatLE(start + offset));
    };
    let volume = 0;
    for (let i = 0; i < doc.accessors[3].count; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      volume += (a[0] * (b[1]*c[2] - b[2]*c[1]) + a[1] * (b[2]*c[0] - b[0]*c[2])
        + a[2] * (b[0]*c[1] - b[1]*c[0])) / 6;
      for (const [p, q] of [[a,b],[b,c],[c,a]]) {
        const key = [p.join(','), q.join(',')].sort().join('|');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(n => n === 2), method);
    assert.ok(volume > 0, method);
    volumes.add(Math.round(volume * 1000));
    if (method === 'voxel') assert.ok(Math.abs(volume - (3 * 5 * 5 - 1) * 2) < 1e-5);
    if (method === 'surface-nets' || method === 'voxel') {
      assert.equal(doc.accessors[3].count / 3, (2 * (15 + 15 + 25) + 6) * 2);
    }
  }
  assert.equal(volumes.size, 3);
  assert.match(run('contour').stderr, /marching-cubes, surface-nets, voxel/);
});
