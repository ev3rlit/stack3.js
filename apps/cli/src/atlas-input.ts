import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { DIRECTIONS, parseLayout, readPngSize, splitAtlas, type Direction, type Raster, type ViewSet } from '@stack3/core';
import { PNG } from 'pngjs';
import { sha256 } from './verification-gate';

async function png(path: string, onRead?: (hash: string) => void): Promise<Raster> {
  const bytes = await readFile(path);
  if (onRead) onRead(sha256(bytes));
  readPngSize(bytes);
  const image = PNG.sync.read(bytes);
  return { width: image.width, height: image.height, data: image.data };
}

export async function readInput(path: string, layout: string | undefined, threshold: number, hashes?: Map<string, string>): Promise<ViewSet> {
  if (extname(path).toLowerCase() === '.png') {
    if (!layout) throw new Error('A PNG atlas needs an explicit --layout.');
    const directions = parseLayout(layout);
    const image = await png(path, hashes && (hash => directions.forEach(name => hashes.set(name, hash))));
    return splitAtlas(image, directions, threshold);
  }
  if (extname(path).toLowerCase() !== '.json') throw new Error('Choose a PNG atlas or a JSON view manifest.');
  if (layout) throw new Error('View manifests define their directions in the views field.');
  const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
  const views = manifest && typeof manifest === 'object' && 'views' in manifest ? manifest.views : null;
  if (!views || typeof views !== 'object' || Array.isArray(views)) throw new Error('The manifest needs a views object.');
  const entries = Object.entries(views);
  parseLayout(entries.map(([name]) => name).join(','));
  return Object.fromEntries(await Promise.all(entries.map(async ([name, file]) => {
    if (!DIRECTIONS.includes(name as Direction) || typeof file !== 'string' || !file) throw new Error(`Invalid view entry: ${name}`);
    return [name, await png(resolve(dirname(path), file), hashes && (hash => hashes.set(name, hash)))];
  })));
}
