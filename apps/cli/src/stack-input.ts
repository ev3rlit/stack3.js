import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readStackPngSize, readStackBundle } from '@stack3/core';
import { PNG } from 'pngjs';

export async function loadStack(directory: string) {
  const [metadata, png] = await Promise.all([
    readFile(join(directory, 'stack.json'), 'utf8'),
    readFile(join(directory, 'stack.png')),
  ]);
  const manifest: unknown = JSON.parse(metadata);
  readStackPngSize(png, manifest);
  const stack = readStackBundle(manifest, PNG.sync.read(png));
  return { metadata, png, stack };
}
