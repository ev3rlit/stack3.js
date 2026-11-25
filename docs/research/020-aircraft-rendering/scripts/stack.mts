import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { encodeStack, readStackBundle, reconstructPrepared, type ViewSet, type StackData } from '@stack3/core';
import { extractSurface, extractVoxelSurface } from '../../../../packages/core/src/surface';
const root = process.env.STACK3_BENCH_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.argv[2];
if (!cache) throw new Error('Pass a scratch output directory.');
mkdirSync(cache, {recursive:true});
const meta = JSON.parse(readFileSync(resolve(root,'inputs/registration.json'),'utf8'));
const views: ViewSet = Object.fromEntries(Object.entries(meta.views).map(([name,file]) =>
  [name, PNG.sync.read(readFileSync(resolve(root,'inputs',String(file))))]));
const size = meta.size_pixels.map((p:number) => p / meta.size_pixels[1] * 6) as [number,number,number];
const stackDir = resolve(root, 'stack');
const bundle = encodeStack(reconstructPrepared(views, 'stack', {size, resolution:192, layers:72, pivot:'ground'}) as StackData);
writeFileSync(resolve(stackDir,'stack.png'),bundle.png);
writeFileSync(resolve(stackDir,'stack.json'),JSON.stringify(bundle.manifest,null,2)+'\n');
// All extractors read the persisted bundle, so none can bypass the image stack.
const s=readStackBundle(JSON.parse(readFileSync(resolve(stackDir,'stack.json'),'utf8')),PNG.sync.read(readFileSync(resolve(stackDir,'stack.png'))));
const {width:w, depth:d, layers:h, columns}=s;
const volume = new Uint8Array(w*d*h);
for(let k=0;k<h;k++) for(let j=0;j<d;j++) for(let i=0;i<w;i++){
  const pixel=(Math.floor(k/columns)*d+j)*s.texture.width + (k%columns)*w+i;
  volume[(k*d+j)*w+i]=Number(s.texture.data[4*pixel+3]>=128);
}
for(const [name,extract] of [['voxel',extractVoxelSurface],['marching-cubes',extractSurface]] as const){
  const mesh=extract(volume,w,d,h);
  writeFileSync(resolve(cache,name+'.vertices'),Buffer.from(Float32Array.from(mesh.positions).buffer));
  writeFileSync(resolve(cache,name+'.triangles'),Buffer.from(Uint32Array.from(mesh.indices).buffer));
}
console.log({w,d,h,size,occupied:volume.reduce((a,b)=>a+b,0)});
