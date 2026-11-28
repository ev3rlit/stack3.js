import {readInput} from '../../../../apps/cli/src/atlas-input';
import {prepareViews} from '@stack3/core';
import {writeFileSync} from 'node:fs';
import {PNG} from 'pngjs';
for(const part of ['whole','head','torso','ear','snout','leg','tail']){
  const views=prepareViews(await readInput(part+'/atlas.png','top,left,front,rear',238),238);
  for(const [name,v] of Object.entries(views)){
    const p=new PNG({width:v.width,height:v.height});p.data=Buffer.from(v.data);
    writeFileSync(part+'/'+name+'.png',PNG.sync.write(p));
  }
}
