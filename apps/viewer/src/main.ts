import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DIRECTIONS, encodeGlb, encodeStackZip, parseLayout, readStackBundle, respaceStack, type AssetData, type Direction, type Settings } from '@stack3/core';
import { createAssetObject, disposeAssetObject, setPreviewLighting, setStackPreviewFilters } from '@stack3/three';
import { bakeStack, createAssemblyObject, instantiateParts, type Mount, type PartLayout, type PlacedAsset } from './assembly';
import { CpuPreview } from './cpu-preview';
import { decodePng } from './png';
import { clearPreviews, findPreview, savePreview, sourceHash, type PreviewResult } from './preview-cache';
import { multipartPresets, qualities, sources } from './presets';
import type { AtlasSource, Job, Reply, Source } from './reconstruct.worker';
import './style.css';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing viewer control ' + id);
  return element as T;
}

const viewport = byId('viewport');
const status = byId<HTMLOutputElement>('status');
const previewLabel = byId('previewLabel');
const exportButton = byId<HTMLButtonElement>('export');
const pixelArtButton = byId<HTMLButtonElement>('pixelArt');
const smoothEdgesButton = byId<HTMLButtonElement>('smoothEdges');
const cpu = new CpuPreview();
const cpuButton = byId<HTMLButtonElement>('cpuPreview');
const gpuButton = byId<HTMLButtonElement>('gpuPreview');
const lightingButton = byId('materialLighting');
const samplingButton = byId('supersampling');
const pressed = (element: HTMLElement) => element.getAttribute('aria-pressed') === 'true';
let renderer: THREE.WebGLRenderer | undefined;
let backend: 'cpu' | 'gpu' = 'gpu';
viewport.append(cpu.canvas);
const scene = new THREE.Scene();
const grid = new THREE.GridHelper(16, 32, 0x44566a, 0x273646);
scene.add(grid);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(2, 3, 2);
scene.add(new THREE.AmbientLight(0xffffff, .85), keyLight);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 300);
camera.position.set(2.7, 1.8, 2.5);
const controls = new OrbitControls(camera, viewport);
controls.target.y = .4;
controls.enableDamping = true;
controls.minZoom = .15;
controls.maxZoom = 12;
let frameHalfSpan = 1.1;

function resizePreview() {
  const { clientWidth: width, clientHeight: height } = viewport;
  if (!width || !height) return;
  renderer?.setPixelRatio(Math.min(devicePixelRatio, 2) * (pressed(samplingButton) ? 2 : 1));
  renderer?.setSize(width, height, false);
  const aspect = width / height;
  camera.left = -frameHalfSpan * Math.max(1, aspect);
  camera.right = -camera.left;
  camera.top = frameHalfSpan * Math.max(1, 1 / aspect);
  camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
}

function setBackend(next: 'cpu' | 'gpu') {
  if (next === 'gpu' && !renderer) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setClearColor(0x121923);
      renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        gpuButton.disabled = true;
        setBackend('cpu');
      });
      renderer.domElement.addEventListener('webglcontextrestored', () => { gpuButton.disabled = false; });
      viewport.append(renderer.domElement);
    } catch {
      gpuButton.disabled = true;
      byId('cacheNotice').textContent = 'WebGL unavailable. Using CPU.';
      next = 'cpu';
    }
  }
  backend = next;
  cpu.canvas.hidden = backend !== 'cpu';
  if (renderer) renderer.domElement.hidden = backend !== 'gpu';
  cpuButton.setAttribute('aria-pressed', String(backend === 'cpu'));
  gpuButton.setAttribute('aria-pressed', String(backend === 'gpu'));
  frames = 0;
  renderTotal = 0;
  frameStart = performance.now();
  resizePreview();
}

cpuButton.addEventListener('click', () => setBackend('cpu'));
gpuButton.addEventListener('click', () => setBackend('gpu'));
new ResizeObserver(resizePreview).observe(viewport);

let frames = 0, frameStart = performance.now(), renderTotal = 0, lastFrame = frameStart;
const performanceOutput = byId<HTMLOutputElement>('performance');
function animate(now: number) {
  requestAnimationFrame(animate);
  controls.update(Math.min(.1, (now - lastFrame) / 1000));
  lastFrame = now;
  const start = performance.now();
  if (backend === 'gpu') renderer?.render(scene, camera);
  else cpu.render(object, camera, pressed(samplingButton), grid.visible, grid.position.y, pressed(lightingButton));
  renderTotal += performance.now() - start;
  frames++;
  if (now - frameStart >= 500) {
    const elapsed = now - frameStart;
    performanceOutput.value = `${Math.round(frames * 1000 / elapsed)} FPS · ${(elapsed / frames).toFixed(1)} ms/frame · ${(renderTotal / frames).toFixed(1)} ms render CPU`;
    frames = 0;
    renderTotal = 0;
    frameStart = now;
  }
}

let object: THREE.Object3D | null = null;
let built: AssetData | null = null;
type InputPart = PartLayout & AtlasSource;
let inputParts: InputPart[] = [];
let assembled: PlacedAsset[] = [];
let assemblyResult: AssetData[] | undefined;
let atlas: Blob | null = null;
let atlasPreview: string | null = null;
const files: Partial<Record<Direction, File>> = {};
let mode: 'atlas' | 'files' = 'atlas';
let target: 'mesh' | 'stack' = 'stack';
let job: Worker | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;
let frameNext = true;
let inputGeneration = 0;
const reconstructionControls = ['targetMesh', 'targetStack', 'meshMethod', 'textureProjection', 'contourHub', 'qualityPreset', 'layers', 'resolution', 'threshold', 'profile', 'height', 'pivot', 'resetReconstruction']
  .map(id => byId<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(id));
const diskCache = byId('persistentCache');
const spacingSlider = byId<HTMLInputElement>('spacing');
const squashSlider = byId<HTMLInputElement>('squash');
const scaleSlider = byId<HTMLInputElement>('previewScale');
let frameDistance = 3;


function frameObject() {
  if (!object) return;
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const dimensions = box.getSize(new THREE.Vector3());
  const span = Math.max(dimensions.x, dimensions.y, dimensions.z, .01);
  const distance = span * 2.65;
  frameHalfSpan = span * .86;
  frameDistance = distance;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(1.35, .95, 1).normalize(), distance);
  camera.near = Math.max(.0001, span / 200);
  camera.far = Math.max(300, distance * 50);
  resizePreview();
  updateGrid();
  applyCameraSliders();
}

function updateGrid() {
  if (!object) return;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  grid.scale.setScalar(Math.max(size.x, size.y, size.z, .01));
  grid.position.y = box.min.y - grid.scale.x * .002;
}

function applyCameraSliders() {
  const offset = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  offset.phi = Math.acos(Math.min(.9999, squashSlider.valueAsNumber));
  offset.radius = frameDistance;
  camera.zoom = scaleSlider.valueAsNumber;
  camera.updateProjectionMatrix();
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(offset));
  controls.update();
}

function showObject(next: THREE.Object3D, frame: boolean) {
  if (object) {
    scene.remove(object);
    disposeAssetObject(object);
  }
  object = next;
  scene.add(next);
  if (frame) frameObject();
  else updateGrid();
  viewport.dataset.ready = 'true';
}

function updateStackFilters() {
  const showFilters = built?.target === 'stack' && object !== null;
  pixelArtButton.disabled = !showFilters;
  smoothEdgesButton.disabled = !showFilters;
  if (showFilters) {
    setStackPreviewFilters(object!, pixelArtButton.getAttribute('aria-pressed') === 'true',
      smoothEdgesButton.getAttribute('aria-pressed') === 'true');
  }
}

function updateSpacing() {
  spacingSlider.disabled = built?.target !== 'stack';
  if (built?.target === 'stack' && object) {
    object.scale.y = spacingSlider.valueAsNumber;
    updateGrid();
  }
}

for (const button of [pixelArtButton, smoothEdgesButton]) {
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    updateStackFilters();
  });
}
byId('showGrid').addEventListener('click', event => {
  grid.visible = !grid.visible;
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(grid.visible));
});
for (const button of [lightingButton, samplingButton, diskCache]) {
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(!pressed(button)));
    if (button === lightingButton && built && object) setPreviewLighting(object, pressed(button));
    if (button === samplingButton) resizePreview();
  });
}

function bindPresentation(id: string, display: (value: number) => string, apply: () => void) {
  const input = byId<HTMLInputElement>(id);
  const output = byId<HTMLOutputElement>(id + 'Value');
  input.addEventListener('input', () => {
    output.value = display(input.valueAsNumber);
    apply();
  });
}
bindPresentation('spacing', value => value.toFixed(2) + '×', updateSpacing);
bindPresentation('squash', value => value.toFixed(2), applyCameraSliders);
bindPresentation('previewScale', value => value.toFixed(2) + '×', applyCameraSliders);
bindPresentation('rotationSpeed', value => value + '°/s', () => {
  const speed = byId<HTMLInputElement>('rotationSpeed').valueAsNumber;
  controls.autoRotate = speed > 0;
  controls.autoRotateSpeed = speed / 6;
});

function cancelJob() {
  clearTimeout(pending);
}

function showList(id: string, items: string[]) {
  const host = byId(id);
  host.replaceChildren(...items.map(item => {
    const row = document.createElement('li');
    row.textContent = item;
    return row;
  }));
}

function presentAsset(asset: AssetData, source: string, preview = false, parts?: AssetData[]) {
  built = asset;
  assemblyResult = parts;
  assembled = parts ? instantiateParts(parts, inputParts) : [];
  const next = assembled.length ? createAssemblyObject(assembled) : createAssetObject(built);
  if (built.target === 'stack') next.scale.y = spacingSlider.valueAsNumber;
  if (pressed(lightingButton)) setPreviewLighting(next, true);
  showObject(next, frameNext);
  frameNext = false;
  updateSpacing();
  updateStackFilters();
  previewLabel.textContent = built.target === 'mesh' ? 'Mesh preview' : 'Sprite stack preview';
  exportButton.disabled = preview;
  const dimensions = new THREE.Box3().setFromObject(next).getSize(new THREE.Vector3());
  const size = (assembled.length ? [dimensions.x, dimensions.z, dimensions.y] : built.size)
    .map(value => value.toFixed(2)).join(' × ');
  const count = built.target === 'mesh' ? `${(built.indices.length / 3).toLocaleString()} triangles`
    : `${built.layers} slices`;
  status.value = `${size} units · ${assembled.length ? assembled.length + ' parts · ' : ''}${count} · ${source}`;
  viewport.dataset.partCount = String(assembled.length || 1);
}

function present(data: PreviewResult, origin: string, preview = false) {
  presentAsset(data.result, preview ? origin + ' · Building full resolution…' : origin, preview, data.parts);
  showList('mappedViews', data.inspection.views.map(v => `${v.direction} ${v.width}×${v.height}`));
  showList('warnings', data.inspection.warnings);
}

function queueReconstruction(delay = 125) {
  cancelJob();
  const id = ++inputGeneration;
  exportButton.disabled = true;
  let source: Source;
  if (mode === 'atlas' && inputParts.length) {
    source = { parts: inputParts.map(({ atlas, layout, size }) => ({ atlas, layout, size })) };
  } else if (mode === 'atlas') {
    if (!atlas) { status.value = 'Load a PNG atlas.'; return; }
    const layout = byId<HTMLInputElement>('layout').value;
    try { parseLayout(layout); }
    catch (error) { status.value = (error as Error).message; return; }
    source = { atlas, layout };
  } else {
    const count = Number(byId<HTMLSelectElement>('viewCount').value);
    const names = DIRECTIONS.slice(0, count);
    const missing = names.filter(name => !files[name]);
    if (missing.length) { status.value = 'Add views: ' + missing.join(', '); return; }
    source = { files: Object.fromEntries(names.map(name => [name, files[name]!])) };
  }
  for (const control of reconstructionControls) control.disabled = false;
  for (const control of ['height', 'pivot', 'layout', 'profile']) byId<HTMLInputElement>(control).disabled = 'parts' in source;
  const meshMethod = byId<HTMLSelectElement>('meshMethod').value as Settings['meshMethod'];
  const contour = target === 'mesh' && meshMethod === 'contour';
  const contourHub = contour && byId<HTMLInputElement>('contourHub').checked;
  byId('meshOptions').hidden = target !== 'mesh';
  byId('resolutionName').textContent = contourHub ? 'Hub segments' : 'Texture resolution';
  const resolution = byId<HTMLInputElement>('resolution').valueAsNumber;
  byId<HTMLOutputElement>('resolutionValue').value = contourHub ? String(resolution) : resolutionLabel(resolution);
  byId('hubOption').hidden = !contour;
  if (contour) {
    for (const id of ['qualityPreset', 'layers', 'profile']) byId<HTMLInputElement>(id).disabled = true;
    byId<HTMLInputElement>('resolution').disabled = !contourHub;
  }
  const value = (id: string) => byId<HTMLInputElement>(id).valueAsNumber;
  const settings: Settings = {
    textureProjection: target === 'mesh' ? byId<HTMLSelectElement>('textureProjection').value as Settings['textureProjection'] : undefined,
    meshMethod: contour ? meshMethod : undefined, contourHub: contourHub || undefined,
    layers: value('layers'), resolution: value('resolution'), threshold: value('threshold'),
    height: value('height'), pivot: byId<HTMLSelectElement>('pivot').value as Settings['pivot'],
    profile: 'parts' in source ? 'silhouette' : byId<HTMLSelectElement>('profile').value as Settings['profile'],
  };
  status.value = 'Reconstructing…';
  const format = target;
  pending = setTimeout(async () => {
    try {
      await startReconstruction(id, source, format, settings);
    } catch (error) {
      if (id === inputGeneration) status.value = (error as Error).message;
    }
  }, delay);
}

async function startReconstruction(id: number, source: Source, format: Job['target'], settings: Settings) {
  const sourceKey = await sourceHash(source);
  if (id !== inputGeneration) return;
  const persistent = pressed(diskCache);
  const key = JSON.stringify([sourceKey, format, settings]);
  const cached = await findPreview(key, persistent);
  if (id !== inputGeneration) return;
  if (cached) { present(cached.value, cached.origin); return; }
  let preview = settings.meshMethod !== 'contour' && (settings.layers! > 45 || settings.resolution! > 96)
    ? { ...settings, layers: Math.min(45, settings.layers!), resolution: Math.min(96, settings.resolution!) }
    : undefined;
  const previewKey = JSON.stringify([sourceKey, format, preview]);
  if (preview) {
    const quick = await findPreview(previewKey, persistent);
    if (id !== inputGeneration) return;
    if (quick) { present(quick.value, quick.origin, true); preview = undefined; }
  }
  const worker = job ??= new Worker(new URL('./reconstruct.worker.ts', import.meta.url), { type: 'module' });
  const epoch = cacheEpoch;
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (job !== worker || data.id !== id || id !== inputGeneration) return;
    if ('error' in data) { status.value = data.error; return; }
    if (epoch === cacheEpoch) void savePreview(data.preview ? previewKey : key, data, pressed(diskCache));
    present(data, 'Built from source · ' + Math.round(data.elapsed) + ' ms', data.preview);
  };
  worker.onerror = () => {
    if (job !== worker) return;
    worker.terminate();
    job = null;
    if (id === inputGeneration) status.value = 'Could not start the reconstruction worker.';
  };
  worker.postMessage({ id, sourceKey, source, target: format, settings, preview } satisfies Job);
}

let cacheEpoch = 0;
byId('clearCache').addEventListener('click', async () => {
  cacheEpoch++;
  const notice = byId('cacheNotice');
  try { await clearPreviews(); notice.textContent = 'Cache cleared.'; }
  catch { notice.textContent = 'Could not clear the disk cache.'; }
});

function changeMode(next: 'atlas' | 'files', rebuild = true) {
  mode = next;
  byId('atlasFields').hidden = next !== 'atlas';
  byId('separateFields').hidden = next !== 'files';
  byId('modeAtlas').setAttribute('aria-pressed', String(next === 'atlas'));
  byId('modeFiles').setAttribute('aria-pressed', String(next === 'files'));
  if (rebuild) queueReconstruction(0);
}

function chooseAtlas(file: Blob, layout?: string, parts: InputPart[] = []) {
  atlas = file;
  inputParts = parts;
  renderPartMounts();
  frameNext = true;
  const image = byId<HTMLImageElement>('sourceImage');
  if (atlasPreview) URL.revokeObjectURL(atlasPreview);
  atlasPreview = URL.createObjectURL(file);
  image.src = atlasPreview;
  image.hidden = false;
  if (layout) byId<HTMLInputElement>('layout').value = layout;
  changeMode('atlas');
}

function renderPartMounts() {
  const display = byId('assemblyEditor');
  display.hidden = !inputParts.length;
  const total = inputParts.reduce((count, part) => count + part.mounts.length, 0);
  byId('assemblySummary').textContent = `${inputParts.length} atlases · ${total} parts`;
  byId('partMounts').replaceChildren(...inputParts.flatMap((part, partIndex) =>
    part.mounts.map(mount => mountEditor(mount, partIndex))));
}

function mountEditor(mount: Mount, partIndex: number) {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = mount.name;
  const transforms = document.createElement('div');
  for (const [axis, title] of ['X', 'Depth', 'Height', 'Scale'].entries()) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '.05';
    input.min = axis === 3 ? '.05' : '-20';
    input.max = axis === 3 ? '20' : '20';
    input.value = (axis === 3 ? mount.scale ?? 1 : mount.position[axis]).toFixed(3);
    label.append(title, input);
    input.addEventListener('change', () => {
      if (!Number.isFinite(input.valueAsNumber) || input.validity.rangeUnderflow || input.validity.rangeOverflow) return;
      if (axis === 3) mount.scale = input.valueAsNumber;
      else mount.position[axis] = input.valueAsNumber;
      if (built && assemblyResult && assemblyResult.length === inputParts.length) {
        const canExport = !exportButton.disabled;
        presentAsset(built, 'Assembly placement updated', !canExport, assemblyResult);
      }
    });
    transforms.append(label);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove part';
  remove.disabled = inputParts.reduce((count, part) => count + part.mounts.length, 0) === 1;
  remove.addEventListener('click', () => {
    const part = inputParts[partIndex];
    part.mounts = part.mounts.filter(candidate => candidate !== mount);
    if (!part.mounts.length) inputParts.splice(partIndex, 1);
    byId<HTMLSelectElement>('samplePreset').value = '';
    renderPartMounts();
    queueReconstruction(0);
  });
  field.append(legend, transforms, remove);
  return field;
}

const assemblyFiles = byId<HTMLInputElement>('partFiles');
byId('addParts').addEventListener('click', () => assemblyFiles.click());
assemblyFiles.addEventListener('change', () => {
  const incoming = Array.from(assemblyFiles.files ?? []);
  assemblyFiles.value = '';
  if (!incoming.length) return;
  if (incoming.some(file => !/\.png$/i.test(file.name))) { status.value = 'Choose four-view PNGs.'; return; }
  const existing: InputPart[] = inputParts.length ? inputParts : !atlas ? [] : [{
    atlas, layout: byId<HTMLInputElement>('layout').value, name: 'Base', mounts: [{ name: 'Base', position: [0, 0, 0] }],
  }];
  if (existing.length + incoming.length > 12) { status.value = 'An assembly supports up to 12 atlases.'; return; }
  const parts = [...existing, ...incoming.map((file, index): InputPart => ({
    atlas: file, name: file.name, layout: 'top,left,front,rear',
    mounts: [{ name: file.name, position: [(.7 * (existing.length + index)), 0, 0], scale: existing.length + index ? .6 : 1 }],
  }))];
  byId<HTMLSelectElement>('samplePreset').value = '';
  chooseAtlas(parts[0].atlas, parts[0].layout, parts);
});

for (const [index, direction] of DIRECTIONS.entries()) {
  const row = document.createElement('div');
  const label = document.createElement('label');
  label.htmlFor = 'view-' + direction;
  label.textContent = direction;
  const input = document.createElement('input');
  input.id = label.htmlFor;
  input.type = 'file';
  input.accept = 'image/png,.png';
  input.addEventListener('change', () => {
    if (input.files?.[0]) files[direction] = input.files[0];
    frameNext = true;
    queueReconstruction(0);
  });
  row.append(label, input);
  row.dataset.direction = direction;
  row.hidden = index >= 4;
  byId('viewFiles').append(row);
}
byId<HTMLSelectElement>('viewCount').addEventListener('change', event => {
  const select = event.currentTarget as HTMLSelectElement;
  for (const [index, row] of Array.from(byId('viewFiles').children).entries()) {
    (row as HTMLElement).hidden = index >= Number(select.value);
  }
  queueReconstruction(0);
});
byId('modeAtlas').addEventListener('click', () => changeMode('atlas'));
byId('modeFiles').addEventListener('click', () => changeMode('files'));
byId<HTMLInputElement>('atlas').addEventListener('change', event => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (file) {
    byId<HTMLSelectElement>('samplePreset').value = '';
      byId<HTMLSelectElement>('profile').value = 'silhouette';
    chooseAtlas(file);
  }
});
byId<HTMLSelectElement>('samplePreset').addEventListener('change', async event => {
  const generation = ++inputGeneration;
  const choice = (event.currentTarget as HTMLSelectElement).value as keyof typeof sources;
  if (!choice) return;
  cancelJob();
  exportButton.disabled = true;
  status.value = 'Loading sample…';
  try {
    const layout = 'top,left,front,rear';
    const fetchAtlas = async (url: URL) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load the sample atlas.');
      return response.blob();
    };
    const preset = multipartPresets[choice];
    if (preset) {
      const parts = await Promise.all(preset.map(async part => ({
        ...part, mounts: structuredClone(part.mounts), atlas: await fetchAtlas(part.url), layout,
      })));
      if (generation === inputGeneration) {
        byId<HTMLSelectElement>('profile').value = 'silhouette';
        chooseAtlas(parts[0].atlas, layout, parts);
      }
    } else {
      const blob = await fetchAtlas(sources[choice]);
      if (generation === inputGeneration) {
        byId<HTMLSelectElement>('profile').value = choice === 'cone' ? 'round-base' : 'silhouette';
        chooseAtlas(blob, layout);
      }
    }
  } catch (error) {
    if (generation === inputGeneration) status.value = (error as Error).message;
  }
});
byId('resetCamera').addEventListener('click', frameObject);
for (const [id, next] of [['targetMesh', 'mesh'], ['targetStack', 'stack']] as const) {
  byId(id).addEventListener('click', () => {
    if (target === next) return;
    target = next;
    byId('targetMesh').setAttribute('aria-pressed', String(next === 'mesh'));
    byId('targetStack').setAttribute('aria-pressed', String(next === 'stack'));
    exportButton.textContent = next === 'mesh' ? 'Export GLB' : 'Export stack';
    queueReconstruction(0);
  });
}
for (const [id, output] of [['layers', 'layerValue'], ['resolution', 'resolutionValue'], ['threshold', 'thresholdValue']] as const) {
  const input = byId<HTMLInputElement>(id);
  input.addEventListener('input', () => {
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
    byId<HTMLOutputElement>(output).value = id === 'resolution' ? resolutionLabel(input.valueAsNumber) : input.value;
    if (id !== 'threshold') byId<HTMLSelectElement>('qualityPreset').value = '';
    queueReconstruction();
  });
}
for (const id of ['height', 'pivot', 'layout', 'profile', 'meshMethod', 'textureProjection', 'contourHub']) byId(id).addEventListener('change', () => queueReconstruction(0));

function resolutionLabel(resolution: number) {
  return `${resolution} px · ${(resolution / qualities.balanced.resolution).toFixed(2)}×`;
}

function applyQuality(preset: keyof typeof qualities) {
  const { layers, resolution } = qualities[preset];
  byId<HTMLInputElement>('layers').value = byId<HTMLOutputElement>('layerValue').value = String(layers);
  byId<HTMLInputElement>('resolution').value = String(resolution);
  byId<HTMLOutputElement>('resolutionValue').value = resolutionLabel(resolution);
}
byId<HTMLSelectElement>('qualityPreset').addEventListener('change', event => {
  const preset = (event.currentTarget as HTMLSelectElement).value as keyof typeof qualities;
  if (!preset) return;
  applyQuality(preset);
  queueReconstruction(0);
});
byId('resetReconstruction').addEventListener('click', () => {
  byId<HTMLSelectElement>('meshMethod').value = 'marching-cubes';
  byId<HTMLSelectElement>('textureProjection').value = 'auto';
  byId<HTMLInputElement>('contourHub').checked = false;
  byId<HTMLSelectElement>('qualityPreset').value = 'standard';
  byId<HTMLSelectElement>('profile').value = byId<HTMLSelectElement>('samplePreset').value === 'cone' ? 'round-base' : 'silhouette';
  applyQuality('standard');
  for (const [id, value] of [['height', '1'], ['pivot', 'ground'], ['threshold', '238'],
    ['thresholdValue', '238'], ['spacing', '1'], ['squash', '.75'], ['previewScale', '1'], ['rotationSpeed', '0']]) {
    byId<HTMLInputElement>(id).value = value;
  }
  for (const [id, value] of [['spacingValue', '1.00×'], ['squashValue', '0.75'],
    ['previewScaleValue', '1.00×'], ['rotationSpeedValue', '0°/s']]) {
    byId<HTMLOutputElement>(id).value = value;
  }
  controls.autoRotate = false;
  updateSpacing();
  frameObject();
  queueReconstruction(0);
});

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportButton.addEventListener('click', async () => {
  if (!built) return;
  try {
    if (built.target === 'stack') {
      const stack = assembled.length ? bakeStack(assembled) : built;
      download(encodeStackZip(respaceStack(stack, spacingSlider.valueAsNumber)), 'stack3-stack.zip', 'application/zip');
    } else if (assembled.length) {
      const group = createAssemblyObject(assembled);
      try {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const bytes = await new GLTFExporter().parseAsync(group, { binary: true });
        if (!(bytes instanceof ArrayBuffer)) throw new Error('Could not export assembly as GLB.');
        download(new Uint8Array(bytes), 'stack3-assembly.glb', 'model/gltf-binary');
      } finally { disposeAssetObject(group); }
    } else {
      download(encodeGlb(built), 'stack3.glb', 'model/gltf-binary');
    }
  } catch (error) {
    status.value = (error as Error).message;
  }
});

byId('openGlb').addEventListener('click', () => byId<HTMLInputElement>('glb').click());
byId<HTMLInputElement>('glb').addEventListener('change', async event => {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
  input.value = '';
  if (!file) return;
  cancelJob();
  const generation = ++inputGeneration;
  built = null;
  assembled = [];
  assemblyResult = undefined;
  updateSpacing();
  updateStackFilters();
  exportButton.disabled = true;
  try {
    const bytes = await file.arrayBuffer();
    const header = new DataView(bytes);
    if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 ||
        header.getUint32(12, true) > bytes.byteLength - 20) throw new Error('Expected a GLB file.');
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, header.getUint32(12, true))));
    if ([...(json.images ?? []), ...(json.buffers ?? [])].some(entry => entry.uri && !entry.uri.startsWith('data:'))) {
      throw new Error('Open a GLB with embedded textures and buffers.');
    }
    const result = await new GLTFLoader().parseAsync(bytes, '');
    if (generation !== inputGeneration) { disposeAssetObject(result.scene); return; }
    showObject(result.scene, true);
    previewLabel.textContent = 'GLB preview';
    status.value = file.name + ' · Opened';
    showList('warnings', []);
  } catch (error) {
    if (generation === inputGeneration) status.value = (error as Error).message;
  }
});

async function openCliStack(token: string) {
  const generation = ++inputGeneration;
  status.value = 'Opening stack…';
  try {
    const root = new URL(`__stack3/${token}/`, location.href);
    const [manifest, png] = await Promise.all([
      fetch(new URL('stack.json', root)),
      fetch(new URL('stack.png', root)),
    ]);
    if (!manifest.ok || !png.ok) throw new Error('Could not open this CLI stack bundle.');
    const metadata = await manifest.json();
    const texture = await decodePng(await png.blob(), false, metadata);
    if (generation !== inputGeneration) return;
    presentAsset(readStackBundle(metadata, texture), 'Opened stack bundle');
    for (const control of reconstructionControls) control.disabled = true;
  } catch (error) {
    if (generation === inputGeneration) status.value = (error as Error).message;
  }
}

const query = new URLSearchParams(location.search);
const cliStack = query.get('stack');
setBackend('gpu');
requestAnimationFrame(animate);
if (cliStack && /^[a-f0-9-]{36}$/.test(cliStack)) {
  void openCliStack(cliStack);
} else {
  const preset = query.get('preset');
  if (preset && Object.hasOwn(sources, preset)) {
    const selector = byId<HTMLSelectElement>('samplePreset');
    selector.value = preset;
    selector.dispatchEvent(new Event('change'));
  }
}
