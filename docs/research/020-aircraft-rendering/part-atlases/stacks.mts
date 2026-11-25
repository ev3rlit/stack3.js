import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {crop,encodeStack,reconstructPrepared,type StackData,type ViewSet} from '@stack3/core';
const root=dirname(fileURLToPath(import.meta.url));
const specs=JSON.parse(readFileSync(join(root,'calibration.json'),'utf8'));
const out=process.argv[2];
if(!out) throw Error('Supply a scratch directory');
for(const name of Object.keys(specs)){
  const spec=specs[name];
  const input=PNG.sync.read(readFileSync(join(root,'atlases',name+'.png')));
  const views:ViewSet=Object.fromEntries(Object.entries(spec.views).map(([direction,box])=>{
    const [left,top,width,height]=box as number[];
    return [direction,crop(input,{left,top,width,height})];
  }));
  const built=reconstructPrepared(views,'stack',{size:spec.dim.map((n:number)=>n*6/583) as [number,number,number],
    resolution:spec.resolution,layers:spec.layers,pivot:'ground'}) as StackData;
  const bundle=encodeStack(built), dest=join(out,'raw',name);
  mkdirSync(dest,{recursive:true});
  writeFileSync(join(dest,'stack.png'),bundle.png);writeFileSync(join(dest,'stack.json'),JSON.stringify(bundle.manifest,null,2)+'\n');
  console.log(name,built.width,built.depth,built.layers);
}
