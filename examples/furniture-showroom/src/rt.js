import { RepeatWrapping } from 'three';
import * as R from '@threert/scene';
import { webEngine } from '../vendor/engine.ts';
import { sunPosition } from './gallery.mjs';

function attributeArray(attribute) {
  if (!attribute.isInterleavedBufferAttribute) return Float32Array.from(attribute.array);
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++)
    for (let k = 0; k < attribute.itemSize; k++)
      values[i * attribute.itemSize + k] = attribute.getComponent(i, k);
  return values;
}

export async function startRT(canvas, world, camera) {
  if (!navigator.gpu) throw new Error('ThreeRT는 WebGPU가 지원되는 브라우저에서 열 수 있습니다.');
  const moduleURL = new URL('threert/threert_web.js', document.baseURI).href;
  const wasm = await import(/* @vite-ignore */ moduleURL);
  await wasm.default();
  const scene = new R.Scene(),
    rtCamera = new R.PerspectiveCamera(camera.fov, camera.aspect, 0.03, 180);
  rtCamera.setAutoExposure(1.35, 4, 12);
  const sun = new R.DirectionalLight(0xfff5e3, 3800);
  sun.position.set(...sunPosition);
  sun.angularDiameter = 3;
  scene.add(sun, sun.target, rtCamera);
  scene.environment = new R.SkyAtmosphere({ sun, skyLightIntensity: 1 });
  const materials = new Map(),
    geometries = new Map();
  function material(source) {
    if (materials.has(source)) return materials.get(source);
    const result = new R.MeshStandardMaterial({
      color: source.color.getHex(),
      roughness: source.roughness,
      metalness: source.metalness,
    });
    if (source.map) {
      const image = source.map.image;
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const context = c.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, c.width, c.height);
      const tex = new R.Texture('generated/' + source.map.uuid + '.png', 'srgb');
      tex.wrap = source.map.wrapS === RepeatWrapping ? 'repeat' : 'clamp';
      tex.data = R.encodePNG(c.width, c.height, pixels.data);
      result.map = tex;
    }
    materials.set(source, result);
    return result;
  }
  function geometry(source) {
    if (geometries.has(source)) return geometries.get(source);
    const geom = new R.BufferGeometry();
    geom.positions = attributeArray(source.attributes.position);
    geom.normals = attributeArray(source.attributes.normal);
    if (source.attributes.uv) {
      const uvs = attributeArray(source.attributes.uv);
      // GLB image rows start at the top. ThreeRT's authored geometry uses bottom-origin UVs.
      for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
      geom.uvs = uvs;
    }
    geom.setIndex(
      source.index?.array ?? Uint32Array.from({ length: source.attributes.position.count }, (_, i) => i),
    );
    geometries.set(source, geom);
    return geom;
  }
  world.updateMatrixWorld(true);
  world.traverse((o) => {
    if (!o.isMesh) return;
    const m = new R.Mesh(geometry(o.geometry), material(o.material));
    const p = o.position.clone(),
      q = o.quaternion.clone(),
      s = o.scale.clone();
    o.matrixWorld.decompose(p, q, s);
    m.name = o.name;
    m.position.set(p.x, p.y, p.z);
    m.quaternion.set(q.x, q.y, q.z, q.w);
    m.scale.set(s.x, s.y, s.z);
    scene.add(m);
  });
  const binding = new R.SceneBinding(webEngine(wasm), scene, rtCamera, {
    name: 'Furniture showroom',
    preset: 'cinematic',
    overrides: { post: { vignette: 0 } },
  });
  let pose = '',
    width = 0,
    height = 0,
    remaining = 0,
    busy = false;
  function syncCamera() {
    rtCamera.position.set(camera.position.x, camera.position.y, camera.position.z);
    rtCamera.quaternion.set(
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    );
    rtCamera.aspect = camera.aspect;
    rtCamera.fov = camera.fov;
    binding.sync();
  }
  async function resize() {
    const scale = Math.min(1, 900 / canvas.clientWidth, 800 / canvas.clientHeight);
    width = Math.max(1, Math.round(canvas.clientWidth * scale));
    height = Math.max(1, Math.round(canvas.clientHeight * scale));
    canvas.width = width;
    canvas.height = height;
    syncCamera();
    await wasm.start(canvas, width, height, '{"frame":false,"handlers":[]}', 0.75, 30, 65536);
    remaining = 64;
  }
  await resize();
  return {
    async draw(dt) {
      if (busy) return false;
      busy = true;
      try {
        const ratio = canvas.clientWidth / canvas.clientHeight;
        const scale = Math.min(1, 900 / canvas.clientWidth, 800 / canvas.clientHeight);
        if (
          Math.abs(width - Math.round(canvas.clientWidth * scale)) > 1 ||
          Math.abs(height - Math.round(canvas.clientHeight * scale)) > 1
        )
          await resize();
        const key = [...camera.position.toArray(), ...camera.quaternion.toArray(), ratio].join(',');
        if (key !== pose) {
          syncCamera();
          pose = key;
          remaining = 64;
        }
        if (remaining > 0 && wasm.frameReady()) {
          wasm.frameBegin(dt);
          const result = JSON.parse(wasm.frameEnd(dt));
          if (result.guard_trips) throw new Error('ThreeRT 광선 추적 실행이 중단됐습니다.');
          remaining--;
          return true;
        }
        return false;
      } finally {
        busy = false;
      }
    },
  };
}
