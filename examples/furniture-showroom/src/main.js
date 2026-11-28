import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { catalog } from './furniture.mjs';
import { addSection } from './sections.js';
import { makeStage, sunPosition } from './gallery.mjs';

const url = new URL(location.href),
  query = url.searchParams;
const asset = catalog.find((item) => item.id === query.get('asset'));
const renderer = query.get('renderer') === 'rt' ? 'rt' : 'three';
const isCabinet = asset?.id === 'cabinet';
const requestedSource = query.get('source');
const source = ['stack3', 'dexel'].includes(requestedSource) ? 'stack3' : 'reference';
const scale = ['2', '4'].includes(query.get('scale')) ? query.get('scale') : '1';
const dexel = scale === '1' ? 'dexel' : 'dexel-' + scale + 'x';
function modelKey(id) {
  if (source === 'reference') return 'reference';
  return id === 'cabinet' ? dexel : 'measured';
}
function modelFile(id) {
  const key = modelKey(id);
  return key.startsWith('dexel') ? key + '/dexel.glb' : key + '.glb';
}
document.querySelector('#dexel-scale').hidden = !isCabinet;
const canvas = document.querySelector('canvas'),
  status = document.querySelector('#status');
const path = (id, file) => './models/' + id + '/' + file;
const camera = new T.PerspectiveCamera(34, 1, 0.03, 180);
const controls = new OrbitControls(camera, canvas);
controls.maxPolarAngle = Math.PI * 0.489;
controls.enablePan = false;
const round = (n) => Number(n.toFixed(6));
function navigate(update, keepPose) {
  if (keepPose && document.querySelector('details'))
    url.searchParams.set('section', document.querySelector('details').open ? 'open' : 'closed');
  if (!keepPose) {
    url.searchParams.delete('section');
    if (requestedSource === 'dexel') url.searchParams.set('source', 'stack3');
  }
  if (keepPose && framePoints.length)
    url.searchParams.set(
      'pose',
      [...camera.position.toArray(), ...controls.target.toArray()].map(round).join(','),
    );
  else if (!keepPose) url.searchParams.delete('pose');
  for (const [key, value] of Object.entries(update))
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  location.assign(url);
}
for (const [key, current] of Object.entries({ renderer, source })) {
  document.querySelectorAll('[data-' + key + ']').forEach((button) => {
    const value = button.dataset[key];
    button.setAttribute('aria-pressed', String(value === current));
    button.onclick = () => {
      if (value !== current) navigate({ [key]: value }, true);
    };
  });
}
for (const button of document.querySelectorAll('[data-scale]')) {
  button.setAttribute('aria-pressed', String(button.dataset.scale === scale));
  button.onclick = () => {
    if (source !== 'stack3' || button.dataset.scale !== scale)
      navigate({ source: 'stack3', scale: button.dataset.scale }, true);
  };
}
const menu = document.querySelector('#catalog');
for (const item of [null, ...catalog]) {
  const b = document.createElement('button');
  b.dataset.asset = item?.id ?? 'room';
  b.setAttribute('aria-current', String((item?.id ?? 'room') === (asset?.id ?? 'room')));
  if (item) {
    const code = document.createElement('small');
    code.textContent = item.code;
    b.append(code);
  } else b.className = 'room';
  const label = document.createElement('strong');
  label.textContent = item?.label ?? '쇼룸 전체';
  b.append(label);
  if (item) {
    const thumb = new Image();
    thumb.src = path(item.id, 'front.png');
    thumb.alt = '';
    b.append(thumb);
  }
  b.onclick = () => {
    if (item?.id !== asset?.id) navigate({ asset: item?.id }, false);
  };
  menu.append(b);
}
const world = new T.Scene(),
  items = asset ? [asset] : catalog;
world.background = new T.Color(0xe8e1d3);
world.add(makeStage(!asset));
const hemi = new T.HemisphereLight(0xfffaf0, 0xc3b397, 1.9);
const sun = new T.DirectionalLight(0xfff4e0, 2.5);
sun.position.set(...sunPosition);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 26 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.006;
sun.shadow.bias = -0.00015;
world.add(hemi, sun);
function resize() {
  camera.aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
  camera.updateProjectionMatrix();
}
resize();
const framePoints = [];
let bounds = new T.Box3(new T.Vector3(-3.26, -0.16, -2.375), new T.Vector3(3.26, 2.35, 2.375));
function home() {
  bounds.getCenter(controls.target);
  if (!asset) controls.target.y = 0.73;
  const forward = new T.Vector3(
    asset?.id === 'cabinet' ? 0.36 : 0.55,
    asset?.id === 'lamp' ? 0.28 : 0.52,
    1,
  ).normalize();
  const right = new T.Vector3().crossVectors(camera.up, forward).normalize();
  const up = new T.Vector3().crossVectors(forward, right);
  const tan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
  let distance = 0;
  for (const point of framePoints) {
    const corner = point.clone().sub(controls.target);
    const projected = Math.max(Math.abs(corner.dot(up)), Math.abs(corner.dot(right)) / camera.aspect);
    distance = Math.max(distance, corner.dot(forward) + projected / tan);
  }
  distance *= asset ? 1.22 : 1.025;
  camera.position.copy(controls.target).addScaledVector(forward, distance);
  controls.minDistance = 0.18;
  controls.maxDistance = Math.max(14, distance * 2);
  controls.update();
}
document.querySelector('#reset').onclick = () => {
  if (framePoints.length) home();
};
canvas.addEventListener('keydown', (event) => {
  const step = { ArrowLeft: [-0.13, 0], ArrowRight: [0.13, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[
    event.key
  ];
  if (!step) return;
  event.preventDefault();
  const s = new T.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  s.theta += step[0];
  s.phi = T.MathUtils.clamp(s.phi + step[1], 0.06, controls.maxPolarAngle);
  camera.position.setFromSpherical(s).add(controls.target);
  controls.update();
});
const picks = [],
  ray = new T.Raycaster();
let down;
canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (asset || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(
    new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - (2 * (e.clientY - r.top)) / r.height),
    camera,
  );
  const hit = ray.intersectObjects(picks, false)[0];
  if (hit) navigate({ asset: hit.object.userData.pick }, false);
});
async function main() {
  const response = await fetch('./models/catalog.json');
  if (!response.ok) throw new Error('측정 파일을 열 수 없습니다.');
  const stats = await response.json(),
    loader = new GLTFLoader();
  await Promise.all(
    items.map(async (item) => {
      const { scene } = await loader.loadAsync(path(item.id, modelFile(item.id)));
      if (!asset) {
        scene.position.set(item.x, 0, item.z);
        scene.rotation.y = item.angle;
      }
      scene.traverse((o) => {
        if (o.isMesh) {
          o.userData.pick = item.id;
          picks.push(o);
        }
      });
      world.add(scene);
    }),
  );
  world.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  if (asset) {
    const [w, h, d] = stats[asset.id].size;
    bounds = new T.Box3(new T.Vector3(-w / 2, 0, -d / 2), new T.Vector3(w / 2, h, d / 2));
  }
  world.updateMatrixWorld(true);
  world.traverse((mesh) => {
    if (asset || !mesh.isMesh || mesh.name === 'Ground' || mesh.name === 'Studio floor') return;
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z])
          framePoints.push(new T.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
  });
  if (asset) {
    const { min, max } = bounds;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) framePoints.push(new T.Vector3(x, y, z));
  }
  home();
  const saved = query.get('pose')?.split(',').map(Number);
  if (saved?.length === 6 && saved.every(Number.isFinite)) {
    camera.position.fromArray(saved);
    controls.target.fromArray(saved, 3);
    controls.update();
  }
  document.querySelector('#feature').textContent = asset
    ? asset.code + ' · ' + asset.feature
    : '가구 9종 · 드래그로 회전하고 가구를 선택해 살펴보세요.';
  const tris = items.reduce((sum, i) => sum + stats[i.id][modelKey(i.id)], 0);
  const dimensions = asset
    ? '기준 ' + stats[asset.id].size.map((x) => Math.round(x * 1000)).join(' × ') + ' mm · '
    : '';
  document.querySelector('#measure').textContent = dimensions + tris.toLocaleString('ko-KR') + ' triangles';
  if (asset) {
    const link = document.createElement('a');
    link.href = path(asset.id, modelFile(asset.id));
    link.textContent = '현재 GLB';
    link.target = '_blank';
    link.rel = 'noopener';
    document.querySelector('#resources').append(link);
    await addSection(asset.id, stats[asset.id].size, query.get('section'), dexel, scale);
  }
  let draw;
  if (renderer === 'rt') {
    status.textContent = 'ThreeRT 광선 추적 준비 중…';
    draw = (await (await import('./rt.js')).startRT(canvas, world, camera)).draw;
  } else {
    const gl = new T.WebGLRenderer({ canvas, antialias: true });
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = T.PCFShadowMap;
    gl.toneMapping = T.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.03;
    gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    draw = () => {
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (
        canvas.width !== Math.floor(w * gl.getPixelRatio()) ||
        canvas.height !== Math.floor(h * gl.getPixelRatio())
      )
        gl.setSize(w, h, false);
      gl.render(world, camera);
      return true;
    };
  }
  let last = performance.now();
  const frame = async (now) => {
    try {
      resize();
      controls.update();
      if (await draw(Math.min(0.1, (now - last) / 1000))) {
        status.hidden = true;
        canvas.dataset.ready = renderer;
      }
      last = now;
      requestAnimationFrame(frame);
    } catch (error) {
      failure(error);
    }
  };
  requestAnimationFrame(frame);
}
function failure(error) {
  status.hidden = false;
  status.textContent = error.message;
  canvas.dataset.ready = 'error';
  console.error(error);
}
main().catch(failure);
