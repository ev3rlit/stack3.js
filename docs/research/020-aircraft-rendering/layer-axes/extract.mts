import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSurface, extractVoxelSurface } from '../../../../packages/core/src/surface';

const here = dirname(fileURLToPath(import.meta.url));
const setup = JSON.parse(readFileSync(join(here, 'experiment.json'), 'utf8'));
const scratch = process.argv[2];
const [width, depth, layers] = setup.shape;
for (const name of [...Object.keys(setup.cases), 'voxel']) {
  const mask = readFileSync(join(scratch, name + '.bin'));
  if (mask.length !== width * depth * layers) throw new Error('Unexpected grid size');
  const extract = name === 'voxel' ? extractVoxelSurface : extractSurface;
  const result = extract(mask, width, depth, layers);
  writeFileSync(join(scratch, name + '.xyz'), Buffer.from(Float32Array.from(result.positions).buffer));
  writeFileSync(join(scratch, name + '.tri'), Buffer.from(Uint32Array.from(result.indices).buffer));
}
