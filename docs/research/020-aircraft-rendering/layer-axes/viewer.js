import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { readStackBundle } from '@stack3/core';
import { createAssetObject } from '@stack3/three';
import { decodePng } from '../../../../apps/viewer/src/png';

const setup = await (await fetch('./experiment.json')).json();
const cal = await (await fetch('../inputs/camera.json')).json();
const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setClearColor(0,0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
const controls = new OrbitControls(camera,renderer.domElement);
controls.enablePan = false;
const sets = new Map();
const models = new Map();
const basis = {
  x:[[0,0,-1],[1,0,0],[0,-1,0]],
  y:[[0,1,0],[0,0,-1],[-1,0,0]],
  z:[[1,0,0],[0,1,0],[0,0,1]],
};
const vec = p => new THREE.Vector3(...p);
async function loadSet(key) {
  const base='./slices/'+key+'/';
  const manifest=await (await fetch(base+'stack.json')).json();
  const png=await decodePng(await (await fetch(base+'stack.png')).blob());
  const stack=readStackBundle(manifest,png);
  const group=createAssetObject(stack);
  const {axis,indices,native_depth}=setup.slices[key];
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...basis[axis].map(vec)));
  group.position.y=setup.size[2]/2;
  group.children.forEach((plane,i) => {
    plane.position.y=((indices[i]+.5)/native_depth-.5)*stack.size[2];
  });
  // An off-center dummy cube would not catch a sign reversal on symmetric wings.
  // Check first and last native-plane centers against the original physical axes.
  group.updateMatrixWorld(true);
  for (const i of [0,indices.length-1]) {
    const center=group.children[i].getWorldPosition(new THREE.Vector3());
    const expected=((indices[i]+.5)/native_depth-.5)*stack.size[2];
    const actual=axis==='x'?center.x:axis==='y'?-center.z:center.y-setup.size[2]/2;
    if(Math.abs(expected-actual)>1e-6) throw Error('Slice placement '+key);
  }
  sets.set(key,group);
}
for (const key of Object.keys(setup.slices)) await loadSet(key);
const names={z72:'수평 72',x72:'수직 종단 72',y72:'수직 횡단 72',xy72:'두 수직 36+36',
  zx72:'수평+종단 36+36',zy72:'수평+횡단 36+36',xyz72:'세 방향 24+24+24',xy144:'두 수직 72+72',xyz216:'세 방향 72+72+72'};
const method=document.querySelector('#method'),stage=document.querySelector('#stage'),view=document.querySelector('#view');
for (const [value,name] of Object.entries(names)) method.add(new Option(name,value));

let revision=0;
async function display(name,mode) {
  const current=++revision;
  if(mode==='stack') {
    scene.clear();
    for(const key of (setup.cases[name] ?? setup.matched_texels[name])) scene.add(sets.get(key));
  } else {
    const key=mode==='voxel'?'voxel':name;
    if(!models.has(key)) {
      const model=(await new GLTFLoader().loadAsync('./models/'+key+'.glb')).scene;
      model.traverse(obj=>{
        if(obj.isMesh) obj.material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
      });
      models.set(key,model);
    }
    if(current!==revision) return false;
    scene.clear();
    scene.add(models.get(key));
  }
  return true;
}
function setCamera(id) {
  let width=624,height=624,span=7.8;
  let target=new THREE.Vector3(0,.79,0);
  camera.zoom=1;
  if(id==='photo') {
    [width,height]=cal.resolution;
    const [,,,scale,cx,cy]=cal.parameters;
    span=width/scale;
    const [u,v,b]=cal.basis.map(([x,y,z])=>new THREE.Vector3(x,z,-y));
    target=u.clone().multiplyScalar((width/2-cx)/scale).addScaledVector(v,(cy-height/2)/scale);
    camera.position.copy(target).addScaledVector(b,12);
    camera.up.copy(v);
  } else {
    let direction;
    if(id==='top') direction=vec([0,1,0]);
    else if(id==='front') direction=vec([0,0,-1]);
    else if(id==='side') direction=vec([-1,0,0]);
    else {
      const [az,el]=id.split('_').map(d=>Number(d)*Math.PI/180);
      direction=vec([-Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el)]);
    }
    camera.position.copy(target).addScaledVector(direction,12);
    camera.up.copy(id==='top'?vec([0,0,1]):vec([0,1,0]));
  }
  controls.target.copy(target);
  camera.lookAt(target);
  camera.left=-span/2;camera.right=span/2;camera.top=span/2*height/width;camera.bottom=-camera.top;
  camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);
}
async function refresh() {
  if(!await display(method.value,stage.value)) return;
  setCamera(view.value);
  renderer.render(scene,camera);
}
controls.addEventListener('change',()=>renderer.render(scene,camera));
for (const input of [method,stage,view]) input.addEventListener('change',refresh);
await refresh();
window.axisCapture = async (name,mode,id) => {
  await display(name,mode);
  setCamera(id);
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
};
