import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));

test('native sampling uses fitted image spans while an omitted layer count always uses 128', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-sampling-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dims = { top: [30, 60], left: [60, 150], front: [30, 150], rear: [30, 150] };
  const views: Record<string, string> = {};
  for (const [direction, [width, height]] of Object.entries(dims)) {
    const image = new PNG({ width: width + 2, height: height + 2 });
    image.data.fill(0);
    for (let y = 1; y <= height; y++) for (let x = 1; x <= width; x++) {
      image.data[((y * image.width + x) * 4) + 3] = 255;
    }
    views[direction] = direction + '.png';
    writeFileSync(join(dir, views[direction]), PNG.sync.write(image));
  }
  writeFileSync(join(dir, 'input.json'), JSON.stringify({ views }));
  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  assert.deepEqual(JSON.parse(run('inspect', 'input.json')).nativeSamples, { x: 30, y: 60, z: 150 });
  function build(...args: string[]) {
    run('build', 'input.json', '--format', 'stack', '--output', 'out', '--no-cache', ...args);
    const { width, depth, layers } = JSON.parse(readFileSync(join(dir, 'out', 'stack.json'), 'utf8'));
    return [width, depth, layers];
  }
  assert.deepEqual(build(), [48, 96, 128]);
  assert.deepEqual(build('--layers', 'native', '--resolution', 'native'), [30, 60, 150]);
  assert.deepEqual(build('--layers', '180', '--resolution', '210'), [105, 210, 180]);
});
