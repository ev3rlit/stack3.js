import { randomUUID } from 'node:crypto';
import { serveViewer } from './preview-server';
import { loadStack } from './stack-input';

export async function viewStack(directory: string, open: boolean, web = false, output?: string) {
  if (web && output) throw new Error('Choose --web or a .blend output file.');
  const { metadata, png } = await loadStack(directory);

  if (!web && (open || output)) {
    const { openBlenderStack } = await import('./blender');
    await openBlenderStack(directory, output, open);
    return;
  }

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
