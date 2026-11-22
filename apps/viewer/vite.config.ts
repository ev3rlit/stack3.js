import { createReadStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const demo = fileURLToPath(new URL('../demo/index.html', import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'stack3-demo-yard',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (path !== '/playground/' && path !== '/playground/index.html') return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (request.method === 'HEAD') { response.end(); return; }
        const content = createReadStream(demo);
        content.on('error', next);
        content.pipe(response);
      });
    },
    async writeBundle({ dir }) {
      if (!dir) return;
      const output = join(dir, 'playground');
      await mkdir(output, { recursive: true });
      await copyFile(demo, join(output, 'index.html'));
    },
  }],
  build: {
    rollupOptions: {
      input: {
        viewer: fileURLToPath(new URL('./index.html', import.meta.url)),
        compare: fileURLToPath(new URL('./compare.html', import.meta.url)),
        project: fileURLToPath(new URL('./project.html', import.meta.url)),
      },
    },
  },
});
