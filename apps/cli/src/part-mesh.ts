import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { meshFromStack, type MeshData, type StackData, type StackMeshMethod } from '@stack3/core';
import { checkGridMemory } from './grid-build';
import { blenderExecutable } from './blender';

export const partMethods = [
  'section-loft', 'heightfield', 'smooth-loft', 'revolve', 'extended-mc', 'hermite-dc',
  'mc33', 'branch-loft', 'path-sweep', 'section-network', 'greedy', 'monotone', 'signed-distance-dc',
] as const;

export type MeshMethod = StackMeshMethod | typeof partMethods[number];
type Point = [number, number, number];
type Bounds = [Point, Point];
export type RegularizationFeature = { id: string } & (
  | { type: 'plane'; normal: Point; bounds: Bounds }
  | { type: 'circle'; center: Point; axis: Point; radius: number }
  | { type: 'cylinder'; center: Point; axis: Point; radius: number; bounds: Bounds }
  | { type: 'polygon'; corners: Point[] }
);
export type SurfaceRegularization = {
  tolerance: number;
  features: RegularizationFeature[];
  relations: { type: 'parallel' | 'perpendicular' | 'coplanar'; features: [string, string] }[];
};
export type LodBevel = {
  preTriangleBudget: number;
  rims: { id: string; axis: 'x' | 'y' | 'z'; center: Point; radius: number;
    radialTolerance: number; axialTolerance: number }[];
};
export type SurfaceFinish = {
  fitTolerance?: number;
  primitives?: boolean;
  regularization?: SurfaceRegularization;
  bevelWidth?: number;
  bevelSegments?: number;
  lodBevel?: LodBevel;
  dissolveAngle?: number;
  triangleBudget?: number;
  aoRadius?: number;
};

export function isCoreMeshMethod(method: string): method is StackMeshMethod {
  return method === 'marching-cubes' || method === 'surface-nets' || method === 'voxel';
}

export function isStackMeshMethod(method: string): method is MeshMethod {
  return isCoreMeshMethod(method) || partMethods.some(name => name === method);
}

export async function readStackMesh(stack: StackData, method: MeshMethod, guide?: string, finish?: SurfaceFinish) {
  checkGridMemory(stack.width, stack.depth, stack.layers, 'mesh');
  if (finish && isCoreMeshMethod(method)) throw new Error('Surface finishing needs a Python mesh method, such as hermite-dc or mc33.');
  return isCoreMeshMethod(method) ? meshFromStack(stack, method) : partMesh(stack, method, guide, finish);
}

export async function partMesh(stack: StackData, method: string, guidePath?: string, finish?: SurfaceFinish): Promise<MeshData> {
  const guide: unknown = guidePath ? JSON.parse(await readFile(guidePath, 'utf8')) : {};
  const { width, depth, layers, columns, spacing, pivot } = stack;
  const size: StackData['size'] = [stack.size[0], stack.size[1], layers * spacing];
  const temporary = await mkdtemp(join(tmpdir(), 'stack3-part-'));
  try {
    await Promise.all([
      writeFile(join(temporary, 'stack.rgba'), stack.texture.data),
      writeFile(join(temporary, 'input.json'), JSON.stringify({ width, depth, layers, columns, size, pivot, guide,
        guideDirectory: guidePath && dirname(resolve(guidePath)), finish, blender: finish && blenderExecutable() })),
    ]);
    const scriptName = method === 'signed-distance-dc' ? 'signed_distance.py' : 'mesh.py';
    const script = fileURLToPath(new URL('../meshing/' + scriptName, import.meta.url));
    const python = process.env.STACK3_PYTHON;
    const args = python ? [script] : ['run', '--no-project', '--script', script];
    try {
      const { stdout } = await promisify(execFile)(python || 'uv', [...args, method, temporary],
        { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      if (stdout.trim()) console.error(stdout.trim());
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { stderr?: string };
      throw new Error(e.code === 'ENOENT' ? 'Install uv or set STACK3_PYTHON to a Python environment with the meshing dependencies.'
        : e.stderr?.trim() || e.message);
    }
    const read = async (name: string) => {
      const bytes = await readFile(join(temporary, name));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    };
    const [positions, normals, uvs, indices, pixels, metadata] = await Promise.all(
      ['positions', 'normals', 'uvs', 'indices', 'texture', 'output.json'].map(read));
    const dims = JSON.parse(new TextDecoder().decode(metadata));
    const colors = dims.colors ? new Float32Array(await read('colors')) : undefined;
    return { target: 'mesh', size, pivot, positions: new Float32Array(positions), normals: new Float32Array(normals),
      uvs: new Float32Array(uvs), indices: new Uint32Array(indices), ...(colors && { colors }), texture: { width: dims.width, height: dims.height,
        data: new Uint8Array(pixels) }, nearestTexture: method === 'greedy' || method === 'monotone' };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
