import { readInput } from '../../../../../apps/cli/src/atlas-input';
import { prepareViews } from '@stack3/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const views = prepareViews(await readInput('../chick-4view.png','top,left,front,rear',238),238);
mkdirSync('views',{recursive:true});
for (const [name, view] of Object.entries(views)) {
  const png = new PNG({width:view.width,height:view.height});
  png.data = Buffer.from(view.data);
  writeFileSync('views/'+name+'.png', PNG.sync.write(png));
}
