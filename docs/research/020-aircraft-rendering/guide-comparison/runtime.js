import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetObject, setPreviewLighting } from '@stack3/three';
import { readStackBundle } from '@stack3/core';
import { CpuPreview } from '../../../../apps/viewer/src/cpu-preview';
import { decodePng } from '../../../../apps/viewer/src/png';

const cal=await (await fetch('../inputs/camera.json')).json();
const layout=await (await fetch('../layer-axes/experiment.json')).json();
const gl=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
const cpu=new CpuPreview();
document.body.append(cpu.canvas);
const ctx=cpu.canvas.getContext('2d');
const put=ctx.putImageData.bind(ctx);
const transparent=document.createElement('canvas');
ctx.putImageData=(data,x,y)=>{
  transparent.width=data.width;
  transparent.height=data.height;
  transparent.getContext('2d').putImageData(data,x,y);
  return put(data,x,y);
};
const scene=new THREE.Scene();
const light=new THREE.DirectionalLight(0xffffff,1.5);
light.position.set(2,3,2);
scene.add(light,new THREE.AmbientLight(0xffffff,.85));
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
function pointCamera(view) {
  let width,height,span;
  if(view==='photo'){
    [width,height]=cal.resolution;
    const [,,,scale,cx,cy]=cal.parameters;
    span=width/scale;
    const [u,v,b]=cal.basis.map(([x,y,z])=>new THREE.Vector3(x,z,-y));
    camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u,v,b));
    camera.position.copy(b).multiplyScalar(12).addScaledVector(u,(width/2-cx)/scale).addScaledVector(v,(cy-height/2)/scale);
  } else {
    width=height=624;span=7.8;
    camera.up.set(0,0,1);
    camera.position.set(0,12.79,0);
    camera.lookAt(0,.79,0);
  }
  camera.left=-span/2;camera.right=span/2;
  camera.top=span/2*height/width;camera.bottom=-camera.top;
  camera.updateProjectionMatrix();
  gl.setSize(width,height);
  Object.assign(cpu.canvas.style,{width:width+'px',height:height+'px'});
}
const subjects=new Map();
for(const key of ['off','on']){
  const model=(await new GLTFLoader().loadAsync('./models/guide-'+key+'.glb')).scene;
  model.traverse(obj=>{if(obj.isMesh)obj.material=new THREE.MeshBasicMaterial({map:obj.material.map,side:THREE.FrontSide});});
  subjects.set(key,model);
}
// Capture the same three groups as the layer-direction study using the stock viewer backends.
const axes={x:[[0,0,-1],[1,0,0],[0,-1,0]],y:[[0,1,0],[0,0,-1],[-1,0,0]],z:[[1,0,0],[0,1,0],[0,0,1]]};
for(const key of ['z72','xy72','xyz72']){
  const group=new THREE.Group();
  for(const id of layout.cases[key]){
    const dir='../layer-axes/slices/'+id+'/';
    const m=await (await fetch(dir+'stack.json')).json();
    const image=await decodePng(await (await fetch(dir+'stack.png')).blob());
    const stack=createAssetObject(readStackBundle(m,image));
    const {axis,indices,native_depth}=layout.slices[id];
    stack.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...axes[axis].map(p=>new THREE.Vector3(...p))));
    stack.position.y=layout.size[2]/2;
    stack.children.forEach((plane,i)=>{plane.position.y=((indices[i]+.5)/native_depth-.5)*m.size[2];});
    group.add(stack);
  }
  subjects.set(key,group);
}
window.capturePair=(key,view,lit)=>{
  const model=subjects.get(key);
  setPreviewLighting(model,lit);
  scene.add(model);
  pointCamera(view);
  gl.render(scene,camera);
  cpu.render(model,camera,true,false,0,lit,{subpixelAA:true,detailNormals:true,specularAA:true});
  scene.remove(model);
  return {cpu:transparent.toDataURL(),webgl:gl.domElement.toDataURL()};
};
