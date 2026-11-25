/** Editable native project from the six image sources. The editor accepts positive scale,
 * so reflected instances use direct 2D mirrors of their component views. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {newProject,applyProjectActions,parseLayout,splitAtlas,prepareViews} from '@stack3/core';
const root=dirname(fileURLToPath(import.meta.url));
const specs=JSON.parse(readFileSync(join(root,'calibration.json'),'utf8'));
const mounts=JSON.parse(readFileSync(join(root,'mounts.json'),'utf8'));
const layout='top,left,front,rear';
const actions:any[]=[{action:'node.add',id:'Aircraft',name:'Aircraft'}];
const added=new Set<string>();
for(const [node,item] of Object.entries(mounts) as [string,any][]){
  const key=item.source, s=specs[key], id=key+(item.mirror?'-mirror':'');
  if(!added.has(id)){
    let png=readFileSync(join(root,'atlases',key+'.png'));
    if(item.mirror){
      const input=PNG.sync.read(png),data=Buffer.from(input.data);
      for(const dir of ['top','front','rear']){
        const [left,top,w,h]=s.views[dir];
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const dst=4*((top+y)*input.width+left+x);
          const src=4*((top+y)*input.width+left+w-1-x);
          input.data.set(data.subarray(src,src+4),dst);
        }
      }
      png=PNG.sync.write(input);
    }
    const panels=prepareViews(splitAtlas(PNG.sync.read(png),parseLayout(layout)));
    if(Object.keys(panels).length!==4) throw Error('Expected four separate components in atlas '+id);
    actions.push({action:'atlas.embed',id,name:id+'.png',layout,png:png.toString('base64')});
    added.add(id);
  }
  actions.push({action:'node.add',id:node,name:node,parentId:'Aircraft',atlasId:id,position:item.position_gltf,
    settings:{format:'stack',layers:s.layers,resolution:s.resolution,height:s.dim[2]*6/583,pivot:'ground',profile:'silhouette'}});
  if(item.pitch_degrees) actions.push({action:'node.set',id:node,patch:{rotation:[item.pitch_degrees,0,0]}});
}
const project=applyProjectActions(newProject('Aircraft / separate part atlases'),actions);
writeFileSync(join(root,'aircraft.stack3.json'),JSON.stringify(project)+'\n');
console.log('Native atlas entries',project.atlases.length,'part instances',project.nodes.filter(n=>n.atlasId).length);
