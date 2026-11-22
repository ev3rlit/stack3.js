import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { summarizeProject, type SceneProject } from '@stack3/core';
import { editProject, projectReader, RevisionConflict } from './project-store';

const limit = 80 * 1024 * 1024;
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const data of request) {
    const chunk = Buffer.from(data);
    size += chunk.length;
    if (size > limit) throw new Error('Request exceeds the project editor upload limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

const fingerprint = (png: string) => createHash('sha256').update(png).digest('hex');
function browserSummary(project: SceneProject) {
  const summary = summarizeProject(project);
  for (const [index, item] of summary.atlases.entries()) {
    item.fingerprint = fingerprint(project.atlases[index].png);
  }
  return summary;
}

export async function openProject(file: string, open: boolean, playground: boolean) {
  const read = projectReader(file);
  await read();
  const token = randomUUID();
  const prefix = '/__stack3_project/' + token;
  const page = '/project.html?session=' + token + (playground ? '&playground=1' : '');
  const root = fileURLToPath(new URL('../../viewer/', import.meta.url));
  const vite = await createServer({
    root, configFile: false,
    server: { host: '127.0.0.1', cors: false, open: open ? page : false },
    plugins: [{
      name: 'stack3-project-server',
      configureServer({ middlewares }) {
        middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (!url.pathname.startsWith(prefix + '/')) return next();
          const route = url.pathname.slice(prefix.length + 1);
          try {
            if (request.method === 'GET' && route === 'state') {
              const project = await read();
              if (url.searchParams.get('after') === String(project.revision)) { response.writeHead(204).end(); return; }
              json(response, browserSummary(project));
              return;
            }
            if (request.method === 'GET' && route.startsWith('atlas/')) {
              const id = route.slice(6);
              const embedded = (await read()).atlases.find(item => item.id === id);
              if (!embedded) { json(response, { error: 'Atlas not found.' }, 404); return; }
              const expected = url.searchParams.get('fingerprint');
              if (expected && expected !== fingerprint(embedded.png)) { json(response, { error: 'Atlas changed.' }, 409); return; }
              const bytes = Buffer.from(embedded.png, 'base64');
              response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
              response.end(bytes);
              return;
            }
            if (request.method === 'POST' && route === 'actions') {
              if (!request.headers['content-type']?.startsWith('application/json') ||
                (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) {
                json(response, { error: 'Expected same-origin JSON.' }, 403); return;
              }
              const { actions, revision } = await body(request);
              if (!Number.isInteger(revision)) throw new Error('Expected a numeric project revision.');
              json(response, browserSummary(await editProject(file, actions, revision)));
              return;
            }
            json(response, { error: 'Unknown project route.' }, 404);
          } catch (error) {
            json(response, { error: (error as Error).message }, error instanceof RevisionConflict ? 409 : 400);
          }
        });
      },
    }],
  });
  await vite.listen();
  const origin = vite.resolvedUrls!.local[0];
  console.log(JSON.stringify({ file, url: new URL(page, origin).href, mode: playground ? 'playground' : 'editor' }));
}
