import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { MeshData, StackData } from '@stack3/core';

export const partMethods = [
  'section-loft', 'heightfield', 'smooth-loft', 'revolve', 'extended-mc', 'hermite-dc',
  'mc33', 'branch-loft', 'path-sweep', 'section-network', 'greedy', 'monotone',
] as const;

export async function partMesh(stack: StackData, method: string, guidePath?: string): Promise<MeshData> {
  const guide: unknown = guidePath ? JSON.parse(await readFile(guidePath, 'utf8')) : {};
  const { width, depth, layers, columns, spacing, pivot } = stack;
  const size: StackData['size'] = [stack.size[0], stack.size[1], layers * spacing];
  const temporary = await mkdtemp(join(tmpdir(), 'stack3-part-'));
  try {
    await Promise.all([
      writeFile(join(temporary, 'stack.rgba'), stack.texture.data),
      writeFile(join(temporary, 'input.json'), JSON.stringify({ width, depth, layers, columns, size, pivot, guide })),
    ]);
    const script = fileURLToPath(new URL('../meshing/mesh.py', import.meta.url));
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
    return { target: 'mesh', size, pivot, positions: new Float32Array(positions), normals: new Float32Array(normals),
      uvs: new Float32Array(uvs), indices: new Uint32Array(indices), texture: { width: dims.width, height: dims.height,
        data: new Uint8Array(pixels) }, nearestTexture: method === 'greedy' || method === 'monotone' };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
