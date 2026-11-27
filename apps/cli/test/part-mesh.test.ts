import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));

test('part guides, packed alpha and offline extractors through the CLI', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-guides-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const meta = { version: 1, atlas: 'stack.png', width: 8, depth: 8, layers: 8, columns: 3,
    spacing: .5, size: [8, 8, 4], pivot: [1, 0, 1], layout: 'row-major',
    layerOrder: 'bottom-to-top', axes: 'xy-ground-z-up-y-forward' };
  writeFileSync(join(dir, 'stack.json'), JSON.stringify(meta));
  const image = new PNG({ width: 24, height: 24 });
  image.data.fill(255);
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = 4 * ((Math.floor(z/3)*8+y)*24+(z%3)*8+x);
    image.data[offset] = 20*x;
    image.data[offset+3] = [x,y,z].every(n => n >= 1 && n <= 6) ? 128 : 127;
  }
  writeFileSync(join(dir, 'stack.png'), PNG.sync.write(image));
  const run = (method: string, guide?: unknown) => {
    const args = [cli, 'mesh', dir, '--mesh-method', method, '--output', join(dir, method+'.glb')];
    if (guide !== undefined) {
      writeFileSync(join(dir, 'guide.json'), JSON.stringify(guide));
      args.push('--guide', join(dir, 'guide.json'));
    }
    return spawnSync(process.execPath, args, { encoding: 'utf8' });
  };
  const section = { source: 'independent', origin: [-1,0,1], u: [1,0,0], v: [0,1,0],
    outer: [[-3,-3],[3,-3],[3,3],[-3,3]] };
  const other = { ...section, v: [0,0,1], outer: [[-3,-1.5],[3,-1.5],[3,1.5],[-3,1.5]] };
  const guides: Record<string, unknown> = {
    'section-loft': { axis: 'x' }, 'smooth-loft': { axis: 'y' }, heightfield: undefined,
    revolve: { axis: 'z', origin: [-1,0,0] }, 'extended-mc': undefined, 'hermite-dc': undefined,
    mc33: undefined, 'branch-loft': undefined, 'path-sweep': { path: [[-1,0,-.5],[-1,0,1],[-.5,0,2.4]],
      profile: { outer: [[-1,-1],[1,-1],[1,1],[-1,1]] } }, 'section-network': { sections: [section,other] },
    greedy: undefined, monotone: undefined, 'signed-distance-dc': { outerIterations: 1, innerIterations: 3 },
  };
  const help = spawnSync(process.execPath, [cli, 'mesh', '--help'], { encoding: 'utf8' }).stdout;
  for (const [method, guide] of Object.entries(guides)) {
    assert.ok(help.includes(method));
    const result = run(method, guide);
    assert.equal(result.status, 0, result.stderr);
    const bytes = readFileSync(join(dir, method+'.glb'));
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20+bytes.readUInt32LE(12)));
    assert.deepEqual(gltf.nodes[0].extras, { size: meta.size, pivot: meta.pivot });
    assert.ok(gltf.accessors[3].count > 0);
    assert.equal(gltf.images[0].mimeType, 'image/png');
    if (method === 'signed-distance-dc') {
      const repeated = run(method, guide);
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.deepEqual(readFileSync(join(dir, method+'.glb')), bytes);
    }
  }
  const dexelSource = `
import numpy as np
import sys
data = dict(version=np.array(1), grid=np.array([8,8,8]), origin=np.array([-5,-4,-1]), step=np.array([1,1,.5]))
lower, upper = [1.1,1.2,1.3], [6.8,6.9,6.75]
for axis, name in enumerate('xyz'):
    r = np.arange(8)
    hits = ((r[:,None]>=1)&(r[:,None]<=6)&(r[None,:]>=1)&(r[None,:]<=6)).ravel()
    data[name+'_offsets'] = np.r_[0,np.cumsum(hits)*2].astype(np.uint32)
    data[name+'_depth'] = np.tile(np.array([lower[axis],upper[axis]])*data['step'][axis],int(hits.sum()))
    data[name+'_normals'] = np.tile(np.array([-np.eye(3)[axis],np.eye(3)[axis]]),(int(hits.sum()),1))
np.savez_compressed(sys.argv[1],**data)
`;
  const python = process.env.STACK3_PYTHON;
  const generate = spawnSync(python || 'uv', [...(python ? [] : ['run', '--no-project', '--with', 'numpy==2.2.6', 'python']),
    '-c', dexelSource, join(dir, 'box.npz')], { encoding: 'utf8' });
  assert.equal(generate.status, 0, generate.stderr);
  const fitted = run('hermite-dc', { dexel: 'box.npz' });
  assert.equal(fitted.status, 0, fitted.stderr);
  assert.match(fitted.stderr, /triple-dexel: used 216 measured crossings/);
  const measured = readFileSync(join(dir, 'hermite-dc.glb'));
  const measuredGlb = JSON.parse(measured.toString('utf8', 20, 20+measured.readUInt32LE(12)));
  for (const [field, expected] of [['min', [-3.9, -.35, -2.9]], ['max', [1.8, 2.375, 2.8]]] as const) {
    expected.forEach((coordinate, i) => assert.ok(Math.abs(measuredGlb.accessors[0][field][i]-coordinate) < 1e-5));
  }
  assert.match(run('hermite-dc', { dexel: 'box.npz', field: 'other.npy' }).stderr, /choose either/);
  for (const [method,guide,error] of [
    ['revolve', undefined, /axis and origin/], ['path-sweep', {}, /path requires/],
    ['heightfield', { axis: 'w' }, /axis must/],
    ['section-network', { sections: [section, { ...other, source: 'silhouette' }] }, /independent/],
    ['section-network', { sections: [section, { ...other, origin: [-.5,0,1] }] }, /disagree/],
    ['mc33', { axis: 'z' }, /guide object/],
  ] as const) {
    const before = readFileSync(join(dir, method+'.glb'));
    const result = run(method,guide);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(dir));
    assert.match(result.stderr, error);
    assert.deepEqual(readFileSync(join(dir, method+'.glb')), before);
  }
});
