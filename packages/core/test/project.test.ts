import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyProjectActions, newProject, playTime, summarizeProject, vehicleScript } from '../src/index';

const png = readFileSync(new URL('../../../apps/viewer/public/examples/traffic-cone-4view.png', import.meta.url)).toString('base64');

function scene() {
  return applyProjectActions(newProject('Yard'), [
    { action: 'atlas.embed', id: 'cone', name: 'Cone', layout: 'top,left,front,rear', png },
    { action: 'node.add', id: 'props', name: 'Props' },
    { action: 'node.add', id: 'close', name: 'Close cone', parentId: 'props', atlasId: 'cone' },
    { action: 'node.add', id: 'far', name: 'Far cone', parentId: 'props', atlasId: 'cone' },
  ]);
}

test('instances share embedded sources and retain independent settings', () => {
  const before = scene();
  const after = applyProjectActions(before, [
    { action: 'node.set', id: 'close', patch: { settings: { spacing: 1.5, layers: 32, format: 'glb' } } },
  ]);
  assert.equal(after.atlases[0].png, png);
  assert.equal(after.nodes.find(node => node.id === 'close')?.settings.spacing, 1.5);
  assert.equal(after.nodes.find(node => node.id === 'far')?.settings.spacing, 1);
  assert.equal(before.nodes.find(node => node.id === 'close')?.settings.spacing, 1);
  assert.ok(!Object.hasOwn(summarizeProject(after).atlases[0], 'png'));
});

test('cyclic reparenting rejects the batch and removing a subtree preserves sources', () => {
  const before = scene();
  assert.throws(() => applyProjectActions(before, [
    { action: 'node.set', id: 'props', patch: { name: 'New name' } },
    { action: 'node.move', id: 'props', parentId: 'close' },
  ]), /own ancestor/);
  assert.equal(before.nodes[0].name, 'Props');
  assert.throws(() => applyProjectActions(before, [{ action: 'atlas.remove', id: 'cone' }]), /still in use/);
  const after = applyProjectActions(before, [
    { action: 'view.set', patch: { selected: 'close' } },
    { action: 'node.remove', id: 'props' },
  ]);
  assert.equal(after.nodes.length, 0);
  assert.equal(after.view.selected, null);
  assert.equal(after.atlases.length, 1);
});

test('play resumes, pauses, and steps from the same clock', () => {
  let project = applyProjectActions(newProject('Yard'), [{ action: 'play.start' }], 1000);
  assert.equal(playTime(project.play, 2300), 1.3);
  project = applyProjectActions(project, [{ action: 'play.step', seconds: 2 }], 2500);
  assert.equal(playTime(project.play, 9000), 3.5);
  assert.equal(project.play.startedAt, null);
  project = applyProjectActions(project, [{ action: 'play.reset' }], 10000);
  assert.equal(playTime(project.play, 23000), 0);
});

test('Playground offsets do not alter authored transforms and reset clears them', () => {
  const before = scene();
  const after = applyProjectActions(before, [
    { action: 'play.nudge', id: 'close', translation: [1, 0, -.5] },
    { action: 'play.nudge', id: 'close', translation: [0, 0, -.5], rotation: [0, 25, 0] },
    { action: 'play.step', seconds: 2 },
  ]);
  assert.deepEqual(after.play.offsets, [{ id: 'close', translation: [1, 0, -1], rotation: [0, 25, 0] }]);
  assert.deepEqual(after.nodes.find(node => node.id === 'close')?.position, before.nodes.find(node => node.id === 'close')?.position);
  assert.equal(applyProjectActions(after, [{ action: 'play.reset' }]).play.offsets, undefined);
});

test('script components persist on their owner, validate fields, and survive playback reset', () => {
  const attach = { action: 'script.set', nodeId: 'props', id: 'drive', patch: vehicleScript };
  const before = scene();
  const attached = applyProjectActions(before, [attach, { action: 'view.set', patch: { follow: 'props' } }]);
  const after = applyProjectActions(attached, [
    { action: 'script.set', nodeId: 'props', id: 'drive', patch: { enabled: false } },
    { action: 'play.reset' },
  ]);
  assert.equal(before.nodes[0].scripts, undefined);
  assert.deepEqual(summarizeProject(after).nodes[0].scripts, [{ id: 'drive', ...vehicleScript, enabled: false }]);
  assert.equal(after.play.resetCount, 1);
  assert.throws(() => applyProjectActions(attached, [{ ...attach, patch: {
    fields: [{ ...vehicleScript.fields[0], value: 100 }],
  } }]), /Invalid bounds/);
  const removed = applyProjectActions(after, [{ action: 'script.remove', nodeId: 'props', id: 'drive' }]);
  assert.deepEqual(removed.nodes[0].scripts, []);
  assert.equal(applyProjectActions(after, [{ action: 'node.remove', id: 'props' }]).view.follow, null);
});
