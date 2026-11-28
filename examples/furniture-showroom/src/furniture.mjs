import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const finish = (name, color, roughness, metalness = 0) =>
  new T.MeshStandardMaterial({ name, color, roughness, metalness });
const oak = finish('Natural oak', 0xc69a6b, 0.64);
const edge = finish('Oak end grain', 0xb28558, 0.67);
const walnut = finish('Oiled walnut', 0x80553d, 0.53);
const linen = finish('Ivory woven linen', 0xe9deca, 0.97);
const wool = finish('Pebble wool', 0xb2afa0, 0.96);
const steel = finish('Graphite lacquer', 0x353932, 0.4, 0.24);
const rubber = finish('Caster rubber', 0x282a27, 0.97);
const inside = finish('Shade interior', 0xe7dec8, 0.64);
const vector = (a) => new T.Vector3(...a);

function part(group, name, geometry, material, xyz) {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...xyz);
  group.add(mesh);
  return mesh;
}
export function block(group, name, size, xyz, material, radius = 0) {
  const geometry = radius ? new RoundedBoxGeometry(...size, 2, radius) : new T.BoxGeometry(...size);
  return part(group, name, geometry, material, xyz);
}
function rod(group, name, start, end, r0, r1, material) {
  const axis = vector(end).sub(vector(start));
  const mesh = part(
    group,
    name,
    new T.CylinderGeometry(r1, r0, axis.length(), 24),
    material,
    vector(start).addScaledVector(axis, 0.5).toArray(),
  );
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
  return mesh;
}
function rail(group, name, start, end, width, depth, material) {
  const axis = vector(end).sub(vector(start));
  const mesh = block(
    group,
    name,
    [width, axis.length(), depth],
    vector(start).addScaledVector(axis, 0.5).toArray(),
    material,
    0.008,
  );
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
  return mesh;
}

const designs = {
  stool(g) {
    rod(g, 'Round seat', [0, 0.41, 0], [0, 0.455, 0], 0.181, 0.182, walnut);
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      rod(
        g,
        'Splayed leg',
        [0.169 * Math.sin(a), 0.004, 0.169 * Math.cos(a)],
        [0.108 * Math.sin(a), 0.42, 0.108 * Math.cos(a)],
        0.018,
        0.022,
        walnut,
      );
    }
  },
  table(g) {
    block(g, 'Soft-edged top', [1.16, 0.052, 0.64], [0, 0.384, 0], oak, 0.022);
    for (const x of [-0.528, 0.528])
      for (const z of [-0.269, 0.269])
        block(g, 'Rounded leg', [0.083, 0.373, 0.083], [x, 0.1865, z], oak, 0.024);
    for (const z of [-0.269, 0.269]) block(g, 'Long apron', [1.07, 0.065, 0.04], [0, 0.344, z], edge, 0.009);
    for (const x of [-0.528, 0.528]) block(g, 'End apron', [0.04, 0.065, 0.56], [x, 0.344, 0], edge, 0.009);
  },
  bookshelf(g) {
    for (const x of [-0.613, 0, 0.613]) block(g, 'Oak upright', [0.035, 1.43, 0.32], [x, 0.715, 0], oak);
    for (const y of [0.018, 1.412]) block(g, 'Cap', [1.26, 0.036, 0.32], [0, y, 0], oak);
    for (const [x, y] of [
      [-0.305, 0.36],
      [-0.305, 0.7],
      [0.305, 0.42],
      [0.305, 1.07],
    ])
      block(g, 'Offset shelf', [0.6, 0.03, 0.32], [x, y, 0], oak);
    for (const [x, y, h] of [
      [-0.305, 0.36, 0.65],
      [0.305, 0.75, 0.62],
    ])
      block(g, 'Inset back', [0.585, h, 0.014], [x, y, -0.151], edge);
    block(g, 'Open bay mullion', [0.032, 0.7, 0.032], [-0.305, 1.06, -0.142], oak);
  },
  armchair(g) {
    for (const x of [-0.328, 0.328]) {
      rail(g, 'Rear diagonal', [x, 0.013, -0.39], [x, 0.58, 0.18], 0.046, 0.064, walnut);
      rail(g, 'Front leg', [x, 0.012, 0.34], [x, 0.53, 0.13], 0.042, 0.052, walnut);
      rail(g, 'Back stile', [x, 0.27, -0.19], [x, 0.87, -0.36], 0.039, 0.055, walnut);
      block(g, 'Floating arm', [0.073, 0.033, 0.57], [x, 0.559, -0.015], walnut, 0.012).rotation.x = 0.045;
    }
    block(g, 'Seat frame', [0.64, 0.053, 0.56], [0, 0.295, -0.018], walnut, 0.014);
    block(g, 'Seat cushion', [0.615, 0.14, 0.56], [0, 0.376, 0.006], linen, 0.058);
    block(g, 'Sloped back', [0.615, 0.52, 0.14], [0, 0.62, -0.265], linen, 0.062).rotation.x = -0.23;
  },
  cabinet(g) {
    block(g, 'Recessed plinth', [1.105, 0.068, 0.342], [0, 0.034, -0.008], edge);
    block(g, 'Carcass', [1.2, 0.728, 0.36], [0, 0.432, -0.02], oak, 0.009);
    // Build each door from two fields and a recessed rail. The central finger pull is real geometry.
    for (const side of [-1, 1]) {
      const x = side * 0.28;
      for (const [y, h] of [
        [0.258, 0.302],
        [0.606, 0.303],
      ])
        block(g, 'Door field', [0.545, h, 0.035], [x, y, 0.181], oak, 0.003);
      block(g, 'Recess floor', [0.545, 0.048, 0.01], [x, 0.432, 0.1685], edge);
      block(g, 'Outer door rail', [0.203, 0.048, 0.035], [side * 0.451, 0.432, 0.181], oak, 0.002);
    }
    for (const x of [-0.582, 0.582]) block(g, 'Outer stile', [0.036, 0.73, 0.041], [x, 0.431, 0.18], oak);
    for (const y of [0.088, 0.778]) block(g, 'Outer rail', [1.17, 0.036, 0.041], [0, y, 0.18], oak);
  },
  lamp(g) {
    rod(g, 'Weighted foot', [-0.1, 0, 0], [-0.1, 0.035, 0], 0.155, 0.15, steel);
    const curve = new T.CatmullRomCurve3(
      [
        [-0.1, 0.03, 0],
        [-0.31, 0.39, 0],
        [-0.36, 0.92, 0],
        [-0.29, 1.4, 0],
        [-0.14, 1.65, 0],
        [0.105, 1.72, 0],
      ].map(vector),
    );
    part(g, 'Bent steel stem', new T.TubeGeometry(curve, 48, 0.012, 10, false), steel, [0, 0, 0]);
    // Revolve the inner wall and lip together with the outer dome, leaving the underside open.
    const profile = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i * Math.PI) / 32;
      profile.push(new T.Vector2(0.205 * Math.sin(a), 0.185 * Math.cos(a)));
    }
    for (let i = 16; i >= 0; i--) {
      const a = (i * Math.PI) / 32;
      profile.push(new T.Vector2(0.196 * Math.sin(a), 0.176 * Math.cos(a)));
    }
    part(g, 'Open domed shade', new T.LatheGeometry(profile, 40), steel, [0.109, 1.53, 0]).rotation.z = 0.1;
    part(g, 'Bulb', new T.SphereGeometry(0.048, 20, 16), inside, [0.11, 1.59, 0]);
  },
  sofa(g) {
    block(g, 'Shadow plinth', [1.81, 0.085, 0.7], [0, 0.043, -0.13], steel, 0.035);
    for (const [x, z, depth] of [
      [-0.445, 0.11, 1.15],
      [0.445, -0.105, 0.72],
    ]) {
      block(g, 'Upholstered seat', [0.89, 0.36, depth], [x, 0.254, z], wool, 0.126);
      block(g, 'Back cushion', [0.895, 0.44, 0.263], [x, 0.487, -0.371], wool, 0.11).rotation.x = -0.075;
    }
    block(g, 'Rolled end', [0.205, 0.48, 0.74], [-0.958, 0.324, -0.105], wool, 0.092);
  },
  trolley(g) {
    for (const x of [-0.28, 0.28])
      for (const z of [-0.177, 0.177]) {
        rod(g, 'Caster axle', [x - 0.026, 0.054, z], [x + 0.026, 0.054, z], 0.054, 0.054, rubber);
        block(g, 'Fork', [0.023, 0.079, 0.021], [x, 0.11, z], steel);
        block(g, 'Square post', [0.025, 0.79, 0.025], [x, 0.529, z], steel);
      }
    for (const y of [0.18, 0.5, 0.807]) {
      block(g, 'Tray base', [0.576, 0.019, 0.36], [0, y, 0], steel);
      const h = y < 0.2 ? 0.092 : 0.043;
      for (const z of [-0.175, 0.175]) block(g, 'Tray lip', [0.577, h, 0.011], [0, y + h / 2, z], steel);
      for (const x of [-0.282, 0.282]) block(g, 'Tray end', [0.012, h, 0.36], [x, y + h / 2, 0], steel);
    }
    for (const x of [-0.28, 0.28]) block(g, 'Push handle', [0.025, 0.025, 0.38], [x, 0.918, 0], steel);
  },
  staircase(g) {
    rail(g, 'Central stringer', [0, 0.046, 0.57], [0, 0.693, -0.54], 0.16, 0.105, steel);
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + i * 0.185,
        z = 0.444 - i * 0.294;
      block(g, 'Floating tread', [0.88, 0.075, 0.334], [0, y, z], oak, 0.008);
      block(g, 'Mounting plate', [0.235, 0.027, 0.19], [0, y - 0.05, z], steel);
    }
  },
};

export const catalog = [
  ['stool', 'FB-001', '스툴', '경사진 세 다리와 원형 좌판', 0.42, 1.43, -0.2],
  ['table', 'FB-002', '테이블', '상판의 평면과 둥근 모서리', -0.64, 0.8, -0.08],
  ['bookshelf', 'FB-003', '책장', '비대칭 선반과 관통 개구부', -2.12, -1.59, 0.08],
  ['armchair', 'FB-004', '암체어', '경사진 등받이와 대각 프레임', 1.22, 0.23, -0.62],
  ['cabinet', 'FB-005', '캐비닛', '문 중앙에 파인 손잡이', -0.32, -1.67, 0],
  ['lamp', 'FB-006', '플로어 램프', '휘어진 지지대와 열린 갓', -2.69, 0.36, 0.14],
  ['sofa', 'FB-007', '소파', '비대칭 모듈과 둥근 쿠션', -1.49, -0.47, 0.13],
  ['trolley', 'FB-008', '트롤리', '세 단의 트레이와 네 바퀴', 2.52, 0.94, -0.2],
  ['staircase', 'FB-009', '계단', '중앙 스트링거와 열린 단', 2.11, -1.38, -0.38],
].map(([id, code, label, feature, x, z, angle]) => ({ id, code, label, feature, x, z, angle }));

export function makeFurniture(id) {
  const group = new T.Group();
  group.name = id;
  designs[id](group);
  const box = new T.Box3().setFromObject(group, true),
    center = box.getCenter(new T.Vector3());
  for (const child of group.children) child.position.sub(new T.Vector3(center.x, box.min.y, center.z));
  group.updateMatrixWorld(true);
  return group;
}
