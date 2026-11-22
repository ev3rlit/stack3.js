import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
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
  const root = fileURLToPath(new URL('../../viewer/', import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    server: { host: '127.0.0.1', port: 0, cors: false, open: open ? '/?stack=' + token : false },
    plugins: [{
      name: 'stack3-preview-bundle',
      configureServer({ middlewares }) {
        middlewares.use((request, response, next) => {
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
      },
    }],
  });
  await server.listen();
  const url = new URL(server.resolvedUrls!.local[0]);
  url.searchParams.set('stack', token);
  console.log('Stack preview ' + url.href);
  console.log('Press Ctrl+C to stop the local viewer.');
}
