import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export async function serveViewer(page: string, open: boolean, middleware: Middleware) {
  const server = { host: '127.0.0.1', port: 0, cors: false, open: open ? page : false };
  const packagedRoot = fileURLToPath(new URL('../viewer/', import.meta.url));
  if (existsSync(new URL('../viewer/dist/index.html', import.meta.url))) {
    const built = await preview({
      root: packagedRoot,
      configFile: false,
      preview: server,
      plugins: [{
        name: 'stack3-cli-preview',
        configurePreviewServer(server) { server.middlewares.use(middleware); },
      }],
    });
    return new URL(page, built.resolvedUrls!.local[0]);
  }

  const dev = await createServer({
    root: fileURLToPath(new URL('../../viewer/', import.meta.url)),
    configFile: false,
    server,
    plugins: [{
      name: 'stack3-cli-preview',
      configureServer(server) { server.middlewares.use(middleware); },
    }],
  });
  await dev.listen();
  return new URL(page, dev.resolvedUrls!.local[0]);
}
