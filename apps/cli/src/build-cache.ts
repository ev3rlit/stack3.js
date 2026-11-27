import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { DIRECTIONS, type MeshData, type Settings, type ViewSet } from '@stack3/core';

const version = 'render-data-4';
const directory = process.env.STACK3_CACHE_DIR
  ? resolve(process.env.STACK3_CACHE_DIR)
  : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'stack3', version);

export type BuildOutput = { format: 'glb'; bytes: Uint8Array }
  | { format: 'stack'; png: Uint8Array; manifest: string };

type CacheEntry = BuildOutput | { format: 'surface'; mesh: MeshData };

async function readCache(key: string): Promise<CacheEntry | undefined> {
  try {
    return deserialize(await readFile(join(directory, key + '.cache')));
  } catch { /* A missing or unreadable entry is a cache miss. */ }
}

export function buildCacheKey(views: ViewSet, format: BuildOutput['format'], settings: Settings, spacing: number) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([version, format, settings, spacing]));
  for (const direction of DIRECTIONS) {
    const view = views[direction];
    if (!view) continue;
    hash.update(JSON.stringify([direction, view.width, view.height]));
    hash.update(view.data);
  }
  return hash.digest('hex');
}

export async function readBuildCache(key: string, format: BuildOutput['format']): Promise<BuildOutput | undefined> {
  const data = await readCache(key);
  if (data?.format !== format) return;
  if (data.format === 'glb' ? data.bytes instanceof Uint8Array
    : data.png instanceof Uint8Array && typeof data.manifest === 'string') return data;
}

export async function readSurfaceCache(key: string) {
  const data = await readCache(key);
  if (data?.format === 'surface' && data.mesh?.positions instanceof Float32Array && data.mesh.indices instanceof Uint32Array) return data.mesh;
}

export async function writeBuildCache(key: string, output: CacheEntry) {
  const temporary = join(directory, randomUUID() + '.tmp');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, serialize(output), { flag: 'wx' });
    await rename(temporary, join(directory, key + '.cache'));
    const entries = (await readdir(directory)).filter(name => /^[0-9a-f]{64}\.cache$/.test(name));
    if (entries.length <= 12) return;
    const dated = await Promise.all(entries.map(async name => ({ name, time: (await stat(join(directory, name))).mtimeMs })));
    await Promise.all(dated.sort((a, b) => b.time - a.time).slice(12).map(({ name }) => unlink(join(directory, name))));
  } catch {
    await unlink(temporary).catch(() => {});
    // Cache errors do not affect the requested export.
  }
}
