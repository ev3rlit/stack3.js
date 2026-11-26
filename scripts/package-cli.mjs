import { chmod, cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build as bundle } from 'esbuild';
import { build as buildViewer } from 'vite';

const { values } = parseArgs({ options: { version: { type: 'string' }, output: { type: 'string' } } });
const version = values.version;
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('Supply --version X.Y.Z.');
}
if (!values.output) throw new Error('Supply --output <new directory>.');

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(values.output);
await mkdir(output);
await Promise.all(['bin', 'blender', 'examples'].map(directory => mkdir(join(output, directory))));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const dependencies = Object.fromEntries(['vite', 'pngjs'].map(name => [name, lock.packages['node_modules/' + name].version]));
const manifest = {
  name: 'stack3js', version, type: 'module', license: 'MIT',
  description: 'Build 3D meshes and sprite stacks from orthographic atlases.',
  repository: { type: 'git', url: 'git+https://github.com/ev3rlit/stack3.js.git' },
  engines: { node: '>=22.12' }, bin: { stack3: './bin/stack3.mjs' }, dependencies,
  files: ['bin', 'blender', 'meshing', 'verification', 'examples', 'viewer/dist', 'THIRD-PARTY-LICENSES.md'],
};
const cli = join(output, 'bin', 'stack3.mjs');
const [cliBuild] = await Promise.all([
  bundle({
    absWorkingDir: root, entryPoints: ['apps/cli/src/main.ts'], outfile: cli, bundle: true,
    platform: 'node', format: 'esm', target: 'node22', external: Object.keys(dependencies),
    banner: { js: '#!/usr/bin/env node' }, metafile: true,
  }),
  buildViewer({
    root: join(root, 'apps/viewer'), configFile: join(root, 'apps/viewer/vite.config.ts'), base: './',
    build: {
      outDir: join(output, 'viewer', 'dist'),
      emptyOutDir: false,
      license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    },
  }),
  writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n'),
  cp(join(root, 'apps/cli/verification'), join(output, 'verification'), { recursive: true, filter: path => !path.endsWith('__pycache__') }),
  cp(join(root, 'apps/cli/meshing'), join(output, 'meshing'), { recursive: true, filter: path => !path.endsWith('__pycache__') }),
  copyFile(join(root, 'apps/cli/blender/import_stack.py'), join(output, 'blender/import_stack.py')),
  copyFile(join(root, 'LICENSE'), join(output, 'LICENSE')),
  copyFile(join(root, 'apps/cli/README.md'), join(output, 'README.md')),
  copyFile(join(root, 'samples/future-tank/future-tank.stack3.json'), join(output, 'examples/future-tank.stack3.json')),
  copyFile(join(root, 'samples/props/traffic-cone-4view.png'), join(output, 'examples/traffic-cone-4view.png')),
]);
const bundledPackages = new Set();
for (const input of Object.keys(cliBuild.metafile.inputs)) {
  const packagePath = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
  if (packagePath) bundledPackages.add(packagePath);
}
const licenses = await Promise.all([...bundledPackages].sort().map(async packagePath => {
  const manifest = JSON.parse(await readFile(join(root, packagePath, 'package.json'), 'utf8'));
  const license = await readFile(join(root, packagePath, 'LICENSE'), 'utf8');
  return `## ${manifest.name} - ${manifest.version}\n\n${license.trim()}`;
}));
await Promise.all([
  chmod(cli, 0o755),
  writeFile(join(output, 'THIRD-PARTY-LICENSES.md'), `# CLI third-party licenses\n\n${licenses.join('\n\n')}\n`),
]);
