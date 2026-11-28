import { readInput } from '../../../../../apps/cli/src/atlas-input';
import { prepareViews } from '@stack3/core';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

for (const part of ['body','wing','crest','beak','leg']) {
  const views = prepareViews(await readInput(part+'/source.png','top,left,front,rear',238),238);
  const manifest: Record<string,string> = {};
  for (const [name,view] of Object.entries(views)) {
    const rotate = part === 'wing' && name === 'top';
    const { width, height, data } = view;
    const png = new PNG({ width: rotate ? height : width, height: rotate ? width : height });
    if (rotate) {
      for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
        const offset=(y*width+x)*4;
        png.data.set(data.subarray(offset,offset+4), ((width-1-x)*height+y)*4);
      }
    } else png.data = Buffer.from(data);
    manifest[name]=name+'.png';
    writeFileSync(part+'/'+manifest[name],PNG.sync.write(png));
  }
  writeFileSync(part+'/views.json',JSON.stringify({ views: manifest },null,2)+'\n');
}
