import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../apps/demo/index.html', import.meta.url);
const directory = new URL('../examples/', import.meta.url);
const output = new URL('demo-yard.html', directory);

await mkdir(directory, { recursive: true });
await copyFile(source, output);
console.log(fileURLToPath(output));
