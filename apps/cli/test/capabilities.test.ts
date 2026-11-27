import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
const run = (args: string[], cwd?: string) => spawnSync(process.execPath, [cli, ...args], {
  cwd, encoding: 'utf8',
  env: { ...process.env, STACK3_PYTHON: '/missing/stack3-python', BLENDER_BIN: '/missing/stack3-blender' },
});

test('the Node CLI discovers backends, standalone pipeline schemas and working sample paths', t => {
  const help = run(['help', 'pipeline']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pipeline schema \[recipe\|fragment\]/);
  const listed = run(['capabilities', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  const catalog = JSON.parse(listed.stdout);
  assert.equal(catalog.version, 1);
  assert.deepEqual(Object.keys(catalog.pipeline.nodes), ['load-stack','reconstruct-stack','extract-mesh','write-glb']);
  const hermite = catalog.meshMethods.find(({ id }: { id: string }) => id === 'hermite-dc');
  assert.deepEqual(hermite.guideFields, ['field','dexel']);
  assert.equal(hermite.backend, 'python');
  assert.ok(catalog.stages.some(({ name, backend }: { name: string; backend: string }) =>
    name === 'Procedural Bevel' && backend === 'blender'));

  const root = run(['pipeline', 'schema']);
  assert.equal(root.status, 0, root.stderr);
  assert.equal(root.stdout, readFileSync(catalog.pipeline.schemas.recipe, 'utf8'));
  const rootSchema = JSON.parse(root.stdout);
  assert.deepEqual(rootSchema.$defs.method.enum, catalog.meshMethods.map(({ id }: { id: string }) => id));
  const fragment = run(['pipeline', 'schema', 'fragment']);
  assert.equal(fragment.status, 0, fragment.stderr);
  const fragmentSchema = JSON.parse(fragment.stdout);
  assert.equal(fragmentSchema.$ref, '#/$defs/manifest');
  assert.deepEqual(fragmentSchema.$defs, rootSchema.$defs);
  assert.equal(fragmentSchema.required, undefined);
  for (const kind of ['recipe', 'fragment']) {
    const name = kind === 'recipe' ? 'pipeline.schema.json' : 'pipeline-fragment.schema.json';
    const copy = new URL('../../../skills/stack3/references/hard-surface/schema/' + name, import.meta.url);
    assert.equal(readFileSync(copy, 'utf8'), readFileSync(catalog.pipeline.schemas[kind], 'utf8'));
  }

  for (const sample of catalog.samples) {
    assert.ok(existsSync(sample.path), sample.path);
    const rendered = run(['pipeline', 'render', sample.path]);
    assert.equal(rendered.status, 0, rendered.stderr);
    const nodes = parse(rendered.stdout).nodes;
    for (const node of nodes) {
      if (node.path && node.type !== 'write-glb') assert.ok(existsSync(node.path), node.path);
      if (node.guide) assert.ok(existsSync(node.guide), node.guide);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'stack3-reference-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preview = catalog.samples.find(({ id }: { id: string }) => id === 'atlas-preview');
  assert.deepEqual(preview.backends, ['node']);
  cpSync(dirname(preview.path), dir, { recursive: true });
  const result = run(['pipeline', 'run', 'preview.pipeline.yaml'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'out/preview.glb')).subarray(0, 4).toString(), 'glTF');
});
