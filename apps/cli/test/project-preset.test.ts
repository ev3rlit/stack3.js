import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { applyProjectActions, newProject, type ProjectAction, type SceneProject } from '@stack3/core';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
const png = readFileSync(new URL('../../viewer/public/examples/traffic-cone-4view.png', import.meta.url)).toString('base64');

function project(...args: string[]) {
  return spawnSync(process.execPath, [cli, 'project', ...args], { encoding: 'utf8' });
}

function json(...args: string[]) {
  const result = project(...args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('CLI discovers built-in script components and exposes their source and fields', () => {
  assert.deepEqual(json('components').map((component: { id: string }) => component.id), ['wasd-vehicle', 'sprite-stack-wheel', 'tracked-drive', 'turret-control', 'track-belt']);
  const wheel = json('components', 'sprite-stack-wheel');
  assert.match(wheel.source, /stackWheel/);
  assert.deepEqual(wheel.fields.map((field: { name: string }) => field.name), ['rollScale', 'steeringScale']);
  assert.match(project('components', 'unknown').stderr, /Unknown built-in component/);
});

test('four-wheel preset discovers and binds the wheels atomically, preserves tuning, and accepts explicit IDs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-preset-test-'));
  const file = join(dir, 'cart.stack3.json');
  const write = (value: SceneProject) => writeFileSync(file, JSON.stringify(value));
  const names = ['one', 'two', 'three', 'four'];
  const positions = [[-.3, 0, -.5], [.3, 0, -.5], [-.3, 0, .5], [.3, 0, .5]];
  try {
    const actions: ProjectAction[] = [
      { action: 'atlas.embed', id: 'body', name: 'Body', layout: 'top,left,front,rear', png },
      { action: 'atlas.embed', id: 'tires', name: 'Tires', layout: 'top,left,front,rear', png },
      { action: 'node.add', id: 'cart', name: 'Utility cart' },
      { action: 'node.add', id: 'body', name: 'Chassis', atlasId: 'body', parentId: 'cart' },
      ...names.map((id, i): ProjectAction => ({ action: 'node.add', id, name: id, atlasId: 'tires', parentId: 'cart',
        position: positions[i], settings: { height: .4 } })).reverse(),
    ];
    const scene = applyProjectActions(newProject('Cart'), actions);
    write(scene);
    const installed = json('preset', file, 'four-wheel', 'cart', '--revision', String(scene.revision));
    assert(installed.changed);
    assert.equal(installed.revision, scene.revision + 1);
    assert.deepEqual(installed.wheels.map((wheel: { node: string }) => wheel.node), names);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as SceneProject;
    const root = stored.nodes.find(node => node.id === 'cart')!;
    const [driver] = root.scripts!;
    assert.match(driver.source, /const wheels = \["one","two","three","four"\]/);
    assert.equal(driver.fields.find(field => field.name === 'wheelbase')?.value, 1);
    assert.equal(driver.fields.find(field => field.name === 'wheelRadius')?.value, .2);
    assert.equal(stored.nodes.filter(node => node.scripts?.some(script => script.id === 'sprite-stack-wheel')).length, 4);
    assert.deepEqual(stored.nodes.map(({ scripts: _, ...node }) => node), scene.nodes);
    const tuned = applyProjectActions(stored, [{ action: 'script.set', nodeId: 'cart', id: driver.id,
      patch: { fields: driver.fields.map(field => field.name === 'forwardSpeed' ? { ...field, value: 2 } : field) } }]);
    write(tuned);
    assert.equal(json('preset', file, 'four-wheel', 'cart').changed, false);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), tuned);
    assert.match(project('preset', file, 'four-wheel', 'cart', '--revision', '0').stderr, /revision changed/);
    const ambiguous = applyProjectActions(scene, [{ action: 'node.add', id: 'spare', name: 'Spare', atlasId: 'tires', parentId: 'cart' }]);
    write(ambiguous);
    assert.match(project('preset', file, 'four-wheel', 'cart').stderr, /Cannot identify four wheels/);
    assert.match(project('preset', file, 'four-wheel', 'cart', '--wheels', 'one,two,three,three').stderr, /four distinct node IDs/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ambiguous);
    assert.equal(json('preset', file, 'four-wheel', 'cart', '--wheels', names.join(',')).wheels.length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tracked-tank preset installs four scripts and stationary turns drive the belts in opposite directions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-tank-test-'));
  const file = join(dir, 'tank.stack3.json');
  try {
    const scene = applyProjectActions(newProject('Demo'), [
      { action: 'atlas.embed', id: 'track', name: 'Track', layout: 'top,left,front,rear', png },
      { action: 'atlas.embed', id: 'turret', name: 'Turret', layout: 'top,left,front,rear', png },
      { action: 'node.add', id: 'tank', name: 'Tank' },
      { action: 'node.add', id: 'right', name: 'Right track', parentId: 'tank', atlasId: 'track', position: [.5, 0, 0] },
      { action: 'node.add', id: 'left', name: 'Left track', parentId: 'tank', atlasId: 'track', position: [-.5, 0, 0] },
      { action: 'node.add', id: 'turret-pivot', name: 'Turret pivot', parentId: 'tank' },
      { action: 'node.add', id: 'turret-mesh', name: 'Turret', parentId: 'turret-pivot', atlasId: 'turret' },
    ]);
    writeFileSync(file, JSON.stringify(scene));
    const installed = json('preset', file, 'tracked-tank', 'tank');
    assert.equal(installed.changed, true);
    assert.equal(installed.turret.node, 'turret-pivot');
    assert.deepEqual(installed.tracks.map((track: { node:string }) => track.node), ['left', 'right']);
    assert.equal(json('preset', file, 'tracked-tank', 'tank').changed, false);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as SceneProject;
    const driver = stored.nodes.find(node => node.id === 'tank')!.scripts![0];
    assert.equal(stored.nodes.filter(node => node.scripts?.some(script => script.id === 'track-belt')).length, 2);
    const update = (keys: string[]) => runInNewContext(driver.source + '\nupdate(input)', {
      input: { dt: .05, keys, state: {}, rotation: [0, 0, 0], fields: Object.fromEntries(driver.fields.map(f => [f.name, f.value])) },
    });
    const leftTurn = update(['KeyA']);
    assert.equal(leftTurn.translation[2], 0);
    assert(leftTurn.childTrackTravel.left < 0);
    assert.equal(leftTurn.childTrackTravel.left, -leftTurn.childTrackTravel.right);
    const rightTurn = update(['KeyD']);
    assert.equal(rightTurn.childTrackTravel.left, -leftTurn.childTrackTravel.left);
    const forward = update(['KeyW']);
    assert(forward.childTrackTravel.left > 0);
    assert.equal(forward.childTrackTravel.left, forward.childTrackTravel.right);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
