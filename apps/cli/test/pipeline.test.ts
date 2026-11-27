import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
const atlas = fileURLToPath(new URL('../../../samples/props/traffic-cone-4view.png', import.meta.url));

test('pipeline renders includes and layered values, then runs the same graph with two extractors', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-pipeline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, STACK3_CACHE_DIR: join(dir, 'cache') },
  });
  const recipe = join(dir, 'pipeline.yaml');
  mkdirSync(join(dir, 'nodes'));
  writeFileSync(recipe, `version: 1
includes: [nodes/outputs.yaml]
values:
  asset:
    atlas: ${JSON.stringify(atlas)}
    layers: 12
nodes:
  - id: source
    type: reconstruct-stack
    path: '{{ .Values.asset.atlas }}'
    layout: top,left,front,rear
    layers: '{{ .Values.asset.layers }}'
    resolution: 16
`);
  writeFileSync(join(dir, 'nodes/outputs.yaml'), `values: { output: default }
nodes:
  - { id: save-fast, type: write-glb, input: fast, path: '{{ .Values.output }}/fast.glb' }
  - { id: save-voxel, type: write-glb, input: voxel, path: '{{ .Values.output }}/voxel.glb', lit: true, instances: [[0, 0, 0], [2, 0, 0]] }
  - { id: fast, type: extract-mesh, input: source, method: surface-nets }
  - { id: voxel, type: extract-mesh, input: source, method: voxel, cache: true }
`);
  writeFileSync(join(dir, 'first.yaml'), 'output: intermediate\nasset: { layers: 9 }\n');
  writeFileSync(join(dir, 'second.yaml'), 'output: release\nasset: { layers: 8 }\n');
  const render = run('pipeline', 'render', recipe, '-f', 'first.yaml', '--values', 'second.yaml');
  assert.equal(render.status, 0, render.stderr);
  const rendered = parse(render.stdout);
  assert.deepEqual(rendered.nodes.map((node: { id: string }) => node.id), ['source', 'fast', 'save-fast', 'voxel', 'save-voxel']);
  assert.equal(rendered.nodes[0].layers, 8);
  assert.equal(rendered.nodes[2].path, join(dir, 'release/fast.glb'));
  assert.equal(existsSync(join(dir, 'release')), false);

  mkdirSync(join(dir, 'compiled'));
  writeFileSync(join(dir, 'compiled/resolved.yaml'), render.stdout);
  const result = run('pipeline', 'run', 'compiled/resolved.yaml');
  assert.equal(result.status, 0, result.stderr);
  const stack = run('build', atlas, '--layout', 'top,left,front,rear', '--resolution', '16', '--layers', '8',
    '--format', 'stack', '--output', 'stack', '--no-cache');
  assert.equal(stack.status, 0, stack.stderr);
  const direct = run('mesh', 'stack', '--mesh-method', 'surface-nets', '--output', 'direct.glb');
  assert.equal(direct.status, 0, direct.stderr);
  const fast = readFileSync(join(dir, 'release/fast.glb'));
  const voxel = readFileSync(join(dir, 'release/voxel.glb'));
  assert.equal(voxel.subarray(0, 4).toString(), 'glTF');
  assert.notDeepEqual(fast, voxel);
  assert.deepEqual(fast, readFileSync(join(dir, 'direct.glb')));
  const doc = JSON.parse(voxel.toString('utf8', 20, 20 + voxel.readUInt32LE(12)));
  const extension = 'EXT_mesh_gpu_instancing';
  assert.deepEqual(doc.extensionsRequired, [extension]);
  const translation = doc.nodes[0].extensions[extension].attributes.TRANSLATION;
  assert.equal(doc.accessors[translation].count, 2);
  assert.equal(doc.materials[0].pbrMetallicRoughness.metallicFactor, 0);
  const cached = run('pipeline', 'run', 'compiled/resolved.yaml');
  assert.equal(cached.status, 0, cached.stderr);
  assert.match(cached.stderr, /voxel: geometry cache hit/);
  assert.deepEqual(readFileSync(join(dir, 'release/voxel.glb')), voxel);
});

test('pipeline rejects invalid dependencies before writing any output', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-invalid-pipeline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const atlasSource = { id: 'source', type: 'load-stack', path: 'missing' };
  const mesh = { id: 'mesh', type: 'extract-mesh', input: 'source', method: 'surface-nets' };
  const output = { id: 'export', type: 'write-glb', input: 'mesh', path: 'release/model.glb' };
  const cases = [
    [[atlasSource, mesh, output, { ...output, id: 'duplicate' }], /Duplicate output path/],
    [[atlasSource, mesh, output, mesh], /Duplicate node ID mesh/],
    [[atlasSource, mesh, { ...output, input: 'missing' }], /unknown input missing/],
    [[atlasSource, mesh, { ...output, input: 'source' }], /unsupported input type load-stack/],
    [[atlasSource, { ...mesh, input: 'export' }, output], /Dependency cycle/],
    [[{ ...atlasSource, path: '{{ .Values.stack }}' }, mesh, output], /missing \.Values\.stack/],
  ] as const;
  for (const [nodes, message] of cases) {
    writeFileSync(join(dir, 'invalid.yaml'), stringify({ version: 1, nodes }, { aliasDuplicateObjects: false }));
    const result = spawnSync(process.execPath, [cli, 'pipeline', 'run', 'invalid.yaml'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, 'release')), false);
  }
});
