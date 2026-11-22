import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGlb, reconstruct, type MeshData, type Raster, type Settings, type ViewSet } from '../src/index';

function image(width: number, height: number, covered: (x: number, y: number) => boolean): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (covered(x, y)) data.set([70, 90, 180, 255], 4 * (y * width + x));
  }
  return { width, height, data };
}
function extrude(views: ViewSet, settings: Settings = {}) {
  const mesh = reconstruct(views, 'mesh', { meshMethod: 'contour', ...settings });
  assert.equal(mesh.target, 'mesh');
  return mesh;
}
function verifyClosed(mesh: MeshData) {
  // UV and hard-normal seams duplicate vertices. Check oriented geometric edges.
  const edges = new Map<string, number[]>();
  const point = (index: number) => mesh.positions.slice(index * 3, index * 3 + 3).join(',');
  for (let f = 0; f < mesh.indices.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = point(mesh.indices[f + k]), b = point(mesh.indices[f + (k + 1) % 3]);
      assert.notEqual(a, b);
      const key = a < b ? a + '/' + b : b + '/' + a;
      const uses = edges.get(key) ?? [];
      uses.push(a < b ? 1 : -1);
      edges.set(key, uses);
    }
  }
  for (const uses of edges.values()) assert.deepEqual(uses.sort(), [-1, 1]);
}
function frontArea(mesh: MeshData) {
  let area = 0;
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const [a, b, c] = [...mesh.indices.slice(f, f + 3)].map(i => i * 3);
    if (mesh.normals[a + 2] !== -1) continue;
    const v = mesh.positions;
    const cross = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1]);
    assert.ok(cross < 0, 'FRONT faces -Z');
    area -= cross / 2;
  }
  return area;
}
test('contour caps retain through-holes and disconnected islands with closed side walls', () => {
  const front = image(60, 40, (x, y) => x < 40 && !(x >= 10 && x < 30 && y >= 10 && y < 30) ||
    x >= 50 && y >= 12 && y < 28);
  const views = { front, rear: front, top: image(60, 8, () => true), left: image(8, 40, () => true) };
  const mesh = extrude(views, { size: [60, 8, 40], pivot: 'center' });
  verifyClosed(mesh);
  assert.ok(Math.abs(frontArea(mesh) - (1600 - 400 + 160)) < 55);
  assert.deepEqual(mesh.pivot, [0, 0, 20]);
  assert.deepEqual(mesh, extrude(views, { layers: 120, size: [60, 8, 40], pivot: 'center' }));
  assert.ok(mesh.uvs.every(n => n >= 0 && n <= 1));
  assert.equal(new DataView(encodeGlb(mesh).buffer).getUint32(0, true), 0x46546c67);
});
test('round hub joins both caps, projects on each side, and keeps the authored depth', () => {
  const front = image(81, 81, (x, y) => Math.abs(x-y) < 10 || Math.abs(x+y-80) < 10 || Math.hypot(x-40,y-40)<14);
  const top = image(81, 21, (x, y) => Math.abs(y-10) <= 3 || Math.abs(x-40) <= 4);
  const left = image(21, 81, (x, y) => Math.abs(x-10) <= 3 || Math.abs(y-40) <= 8);
  const mesh = extrude({ front, top, left, rear: front }, { contourHub: true, size: [2, .4, 2] });
  verifyClosed(mesh);
  const zs = mesh.positions.filter((_, i) => i % 3 === 2);
  assert.ok(Math.abs(Math.max(...zs) - .2) < 1e-6 && Math.abs(Math.min(...zs) + .2) < 1e-6);
  assert.ok(zs.some(z => z > .03 && z < .1));
  assert.throws(() => extrude({ front, top: image(81, 21, () => true), left, rear: front }, { contourHub: true }), /projecting axle/);
});
