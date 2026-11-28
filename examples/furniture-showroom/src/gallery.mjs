import * as T from 'three';
import { block } from './furniture.mjs';

const mat = (color) => new T.MeshStandardMaterial({ color, roughness: 0.91 });
export function makeStage(room) {
  const stage = new T.Group();
  const plaster = mat(0xe8deca),
    rim = mat(0xb6a88c),
    floor = mat(0xe2d5bb);
  if (!room) {
    block(stage, 'Studio floor', [100, 0.08, 100], [0, -0.041, 0], plaster);
    return stage;
  }
  block(stage, 'Gallery floor', [6.52, 0.16, 4.75], [0, -0.08, 0], floor, 0.025);
  block(stage, 'Rear wall', [6.52, 2.35, 0.09], [0, 1.175, -2.33], plaster);
  block(stage, 'Low side return', [0.09, 0.54, 4.66], [-3.215, 0.27, 0.02], plaster);
  block(stage, 'Skirting', [6.4, 0.052, 0.02], [0, 0.026, -2.275], rim);
  const rug = mat(0xc6b99e),
    weave = mat(0x9e9078);
  block(stage, 'Flatweave rug', [3.48, 0.009, 2.18], [-0.45, 0.005, 0.43], rug, 0.004);
  for (const x of [-2.08, -2.04, 1.14, 1.18])
    block(stage, 'Woven border', [0.013, 0.002, 2.12], [x, 0.0105, 0.43], weave);
  const frame = mat(0x714a31),
    paper = mat(0xead9bb);
  block(stage, 'Print frame', [0.96, 0.94, 0.04], [0.28, 1.57, -2.262], frame);
  block(stage, 'Paper', [0.925, 0.905, 0.011], [0.28, 1.57, -2.236], paper);
  const print = (name, geometry, material, x, y, z) => {
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    stage.add(mesh);
    return mesh;
  };
  print('Ochre half circle', new T.CircleGeometry(0.31, 64, 0, Math.PI), mat(0xb65c3b), 0.28, 1.52, -2.228);
  block(stage, 'Ink rectangle', [0.62, 0.12, 0.002], [0.28, 1.429, -2.229], mat(0x464e42));
  block(stage, 'Ochre rule', [0.62, 0.023, 0.002], [0.28, 1.336, -2.229], mat(0xc18d51));
  block(stage, 'Ground', [100, 0.1, 100], [0, -0.217, 0], mat(0xe8e1d3));
  return stage;
}
export const sunPosition = [-3.8, 6.5, 4.4];
