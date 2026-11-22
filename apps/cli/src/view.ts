import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveViewer } from './preview-server';
import { readPngSize, readStackBundle } from '@stack3/core';
import { PNG } from 'pngjs';

export async function viewStack(directory: string, open: boolean) {
  const [metadata, png] = await Promise.all([
    readFile(join(directory, 'stack.json'), 'utf8'),
    readFile(join(directory, 'stack.png')),
  ]);
  readPngSize(png);
  readStackBundle(JSON.parse(metadata), PNG.sync.read(png));

  const token = randomUUID();
  const prefix = '/__stack3/' + token + '/';
  const url = await serveViewer('/?stack=' + token, open, (request, response, next) => {
    if (request.method !== 'GET') return next();
    if (request.url === prefix + 'stack.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(metadata);
    } else if (request.url === prefix + 'stack.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(png);
    } else {
      next();
    }
  });
  console.log('Stack preview ' + url.href);
  console.log('Press Ctrl+C to stop the local viewer.');
}
