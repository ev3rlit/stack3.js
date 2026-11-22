import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { playTime, type AssetData, type ProjectSummary, type Raster, type SceneNode, type SceneView, type Settings } from '@stack3/core';
import { createAssetObject, createRollingStackObject, createTrackBeltObject, disposeAssetObject, setPreviewLighting, setStackPreviewFilters } from '@stack3/three';
import { CpuPreview } from './cpu-preview';
import { findPreview, savePreview, type PreviewResult } from './preview-cache';
import type { Job, Reply } from './reconstruct.worker';
import { makePlaygroundScripts } from './playground-scripts';
import { rotateAroundHub } from './project-pose';

type Entry = { group: THREE.Group; content?: THREE.Object3D; asset?: AssetData; rolling?: ReturnType<typeof createRollingStackObject>;
  top?: Raster; belt?: ReturnType<typeof createTrackBeltObject>;
  centerY?: number; key?: string; renderedKey?: string; display?: string };
const radians = Math.PI / 180;

export function makeProjectStage(host: HTMLElement, updateCamera: (patch: Partial<SceneView>) => void,
  report: (message: string, ready: number) => void, playground: boolean,
  reportScript: (node: string, script: string, message: string) => void) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const scripts = playground ? makePlaygroundScripts(reportScript) : undefined;
  const childRotation = new THREE.Euler(0, 0, 0, 'YXZ');
  const childQuaternion = new THREE.Quaternion();
  let followed: string | null = null;
  const followPosition = new THREE.Vector3();
  const followDelta = new THREE.Vector3();
  const grid = new THREE.GridHelper(24, 48, 0x516578, 0x314151);
  scene.add(root, grid, new THREE.AmbientLight(0xffffff, .85));
  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(2, 3, 2);
  scene.add(light);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 10000);
  camera.position.set(3, 3, 4);
  const controls = new OrbitControls(camera, host);
  controls.enablePan = false;
  controls.minZoom = .1;
  controls.maxZoom = 10;
  controls.maxPolarAngle = Math.acos(.2);
  const cpu = new CpuPreview();
  host.append(cpu.canvas);
  let renderer: THREE.WebGLRenderer | undefined;
  let gpuUnavailable = false;
  let state: ProjectSummary | undefined;
  let transformPreview: { id: string; patch: Partial<Pick<SceneNode, 'position' | 'rotation'>> } | undefined;
  let playOffsets = new Map<string, NonNullable<ProjectSummary['play']['offsets']>[number]>();
  let span = 2, distance = 6, rendererDpr = 0;
  let fitting = false, cameraKey = '';
  const entries = new Map<string, Entry>();
  const failures = new Map<string, string>();
  const pngs = new Map<string, Promise<Blob>>();
  const outstanding = new Map<string, Promise<PreviewResult>>();
  const worker = new Worker(new URL('./reconstruct.worker.ts', import.meta.url), { type: 'module' });
  let queue: Promise<void> = Promise.resolve();
  let request = 0;

  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const ratio = width / height;
    camera.left = -span * Math.max(1, ratio); camera.right = -camera.left;
    camera.bottom = -span * Math.max(1, 1 / ratio); camera.top = -camera.bottom;
    camera.updateProjectionMatrix();
    if (!renderer) return;
    const density = Math.min(window.devicePixelRatio || 1, 2) * (state?.view.supersampling ? 2 : 1);
    if (rendererDpr !== density) { rendererDpr = density; renderer.setPixelRatio(density); }
    renderer.setSize(width, height, false);
  }

  function useRenderer() {
    const wantGpu = state?.view.backend === 'gpu' && !gpuUnavailable;
    if (wantGpu && !renderer) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setClearColor(0x121923);
        renderer.domElement.addEventListener('webglcontextlost', event => {
          event.preventDefault(); gpuUnavailable = true; useRenderer(); notify();
        });
        renderer.domElement.addEventListener('webglcontextrestored', () => {
          gpuUnavailable = false; useRenderer(); notify();
        });
        host.append(renderer.domElement);
      } catch { gpuUnavailable = true; }
    }
    const isGpu = wantGpu && !gpuUnavailable && !!renderer;
    cpu.canvas.hidden = isGpu;
    if (renderer) renderer.domElement.hidden = !isGpu;
    host.dataset.backend = isGpu ? 'gpu' : 'cpu';
    resize();
  }

  function cameraPose() {
    const view = state?.view;
    if (!view) return;
    const angle = Math.acos(Math.min(.99999, view.squash));
    const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, angle, view.yaw * radians));
    camera.position.copy(controls.target).add(offset);
    camera.zoom = view.scale;
    camera.updateProjectionMatrix();
    controls.update();
  }

  controls.addEventListener('end', () => {
    const offset = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    updateCamera({ yaw: offset.theta / radians, squash: Math.max(.2, Math.min(1, Math.cos(offset.phi))), scale: camera.zoom });
  });
  new ResizeObserver(resize).observe(host);

  function frame() {
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverseVisible(item => {
      if (item instanceof THREE.Mesh) box.expandByObject(item);
    });
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    span = Math.max(.05, sphere.radius) * 1.12;
    distance = Math.max(6, span * 3);
    controls.target.copy(sphere.center);
    resize();
    cameraPose();
  }

  function notify() {
    const visible = state?.nodes.filter(node => node.atlasId) ?? [];
    const ready = visible.filter(node => isReady(node.id)).length;
    const error = [...failures.values()][0];
    const progress = ready < visible.length ? `${ready}/${visible.length} assets ready` : `${ready} assets ready`;
    report(error || (gpuUnavailable && state?.view.backend === 'gpu' ? 'WebGL unavailable · CPU preview' : progress), ready);
  }

  function isReady(id: string) {
    const entry = entries.get(id);
    return !!entry?.content && entry.key === entry.renderedKey;
  }

  function png(atlas: ProjectSummary['atlases'][number]): Promise<Blob> {
    const key = atlas.fingerprint ?? atlas.id;
    let value = pngs.get(key);
    if (!value) {
      const url = host.dataset.endpoint + '/atlas/' + atlas.id + (atlas.fingerprint ? '?fingerprint=' + atlas.fingerprint : '');
      value = fetch(url).then(response => {
        if (!response.ok) throw new Error('Could not read the embedded atlas.');
        return response.blob();
      }).catch(error => { pngs.delete(key); throw error; });
      pngs.set(key, value);
    }
    return value;
  }

  function build(key: string, atlas: ProjectSummary['atlases'][number], settings: Settings,
    target: 'mesh' | 'stack') {
    const existing = outstanding.get(key);
    if (existing) return existing;
    const result = queue.then(async () => {
      const cached = await findPreview(key, true);
      if (cached) return cached.value;
      const source = { atlas: await png(atlas), layout: atlas.layout };
      const id = ++request;
      const result = await new Promise<PreviewResult>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<Reply>) => {
          if (data.id !== id) return;
          if ('error' in data) reject(new Error(data.error));
          else if (!data.preview) resolve(data);
        };
        worker.onerror = () => reject(new Error('Failed to run the reconstruction worker.'));
        worker.postMessage({ id, sourceKey: 'project:' + (atlas.fingerprint ?? atlas.id), source, target, settings,
          keepTop: target === 'stack' } satisfies Job);
      });
      void savePreview(key, result, true);
      return result;
    });
    outstanding.set(key, result);
    queue = result.then(() => {}, () => {});
    void result.then(() => outstanding.delete(key), () => outstanding.delete(key));
    return result;
  }

  function applyDisplay(entry: Entry, node: SceneNode) {
    if (!entry.content) return;
    const { spacing, pixelArt, smoothEdges, lighting, format } = node.settings;
    const key = JSON.stringify([spacing, pixelArt, smoothEdges, lighting, format]);
    if (entry.display === key) return;
    entry.display = key;
    entry.content.scale.y = format === 'stack' ? spacing : 1;
    setPreviewLighting(entry.content, lighting);
    if (format === 'stack') setStackPreviewFilters(entry.content, pixelArt, smoothEdges);
  }

  function replaceContent(entry: Entry, object: THREE.Object3D) {
    if (entry.content) {
      entry.group.remove(entry.content);
      disposeAssetObject(entry.content);
    }
    entry.content = object;
    entry.display = undefined;
    entry.group.add(object);
  }

  function sync(project: ProjectSummary) {
    const viewChanged = !state || project.view.backend !== state.view.backend || project.view.supersampling !== state.view.supersampling;
    fitting ||= !state || project.view.frame !== state.view.frame;
    state = project;
    scripts?.sync(project);
    transformPreview = undefined;
    playOffsets = new Map(project.play.offsets?.map(offset => [offset.id, offset]));
    const nodes = new Map(project.nodes.map(node => [node.id, node]));
    for (const [id, entry] of entries) {
      if (nodes.has(id)) continue;
      entry.group.removeFromParent();
      if (entry.content) disposeAssetObject(entry.content);
      failures.delete(id); entries.delete(id);
    }
    for (const node of project.nodes) {
      if (!entries.has(node.id)) entries.set(node.id, { group: new THREE.Group() });
    }
    for (const node of project.nodes) {
      const entry = entries.get(node.id)!;
      const parent = node.parentId ? entries.get(node.parentId)?.group ?? root : root;
      if (entry.group.parent !== parent) parent.add(entry.group);
      entry.group.name = node.name;
      entry.group.visible = node.visible;
      entry.group.scale.set(...node.scale);
      const atlas = project.atlases.find(item => item.id === node.atlasId);
      if (!atlas) continue;
      const { format, layers, resolution, threshold, height, pivot, profile } = node.settings;
      const settings = { layers, resolution, threshold, height, pivot, profile };
      const key = JSON.stringify(['project-v2', atlas.fingerprint ?? atlas.id, atlas.layout, format, settings]);
      applyDisplay(entry, node);
      if (entry.key === key) continue;
      entry.key = key;
      failures.delete(node.id);
      void build(key, atlas, settings, format === 'glb' ? 'mesh' : 'stack').then(({ result, top }) => {
        if (entries.get(node.id) !== entry || entry.key !== key) return;
        entry.asset = result;
        entry.top = top;
        entry.rolling = undefined;
        entry.belt = undefined;
        replaceContent(entry, createAssetObject(result));
        entry.centerY = result.size[2] * .5 - result.pivot[2];
        entry.renderedKey = key;
        const currentNode = state?.nodes.find(candidate => candidate.id === node.id);
        if (currentNode) applyDisplay(entry, currentNode);
        fitting ||= !root.userData.framed;
        notify();
      }).catch(error => {
        if (entries.get(node.id) !== entry || entry.key !== key) return;
        failures.set(node.id, node.name + ' · ' + (error as Error).message);
        notify();
      });
    }
    if (viewChanged) useRenderer();
    const pose = JSON.stringify([project.view.yaw, project.view.squash, project.view.scale]);
    if (pose !== cameraKey) { cameraKey = pose; cameraPose(); }
    grid.visible = project.view.grid;
    notify();
  }

  const clock = document.getElementById('playTime') as HTMLOutputElement;
  function previewTransform(id: string, patch: Partial<Pick<SceneNode, 'position' | 'rotation'>>) {
    const preview = { id, patch };
    transformPreview = preview;
    return () => { if (transformPreview === preview) transformPreview = undefined; };
  }

  let clockLabel = '';
  function animate() {
    requestAnimationFrame(animate);
    if (!state) return;
    const time = playTime(state.play);
    const scriptOffsets = scripts?.tick(time);
    const label = time.toFixed(1) + ' s';
    if (label !== clockLabel) { clock.value = label; clockLabel = label; }
    for (const node of state.nodes) {
      const entry = entries.get(node.id)!;
      const { group } = entry;
      const offset = playOffsets.get(node.id);
      const scripted = scriptOffsets?.get(node.id);
      const wheel = scripted?.stackWheel;
      const belt = scripted?.trackBelt;
      if (entry.asset?.target === 'stack') {
        if (belt !== undefined && entry.top) {
          if (!entry.belt) {
            entry.belt = createTrackBeltObject(entry.asset, entry.top);
            entry.rolling = undefined;
            replaceContent(entry, entry.belt.object);
            applyDisplay(entry, node);
          }
        } else if (wheel && !entry.rolling) {
          entry.rolling = createRollingStackObject(entry.asset);
          entry.belt = undefined;
          replaceContent(entry, entry.rolling.object);
          applyDisplay(entry, node);
        }
        if (entry.belt) {
          const travel = belt !== undefined && scripted?.trackTravel !== undefined ? belt * scripted.trackTravel : undefined;
          const parentScale = group.parent?.scale;
          entry.belt.setTravel(travel, entry.asset.size[1] * node.scale[2] * (parentScale?.z ?? 1),
            entry.asset.size[2] * node.settings.spacing * node.scale[1] * (parentScale?.y ?? 1));
        }
      }
      const preview = transformPreview?.id === node.id ? transformPreview.patch : undefined;
      const position = preview?.position ?? node.position;
      group.position.set(position[0] + time * node.velocity[0] + (offset?.translation[0] ?? 0) + (scripted?.translation?.[0] ?? 0),
        position[1] + time * node.velocity[1] + (offset?.translation[1] ?? 0) + (scripted?.translation?.[1] ?? 0),
        position[2] + time * node.velocity[2] + (offset?.translation[2] ?? 0) + (scripted?.translation?.[2] ?? 0));
      group.rotation.set(...(preview?.rotation ?? node.rotation).map((angle, i) =>
        (angle + time * node.angularVelocity[i] + (offset?.rotation[i] ?? 0) + (scripted?.rotation?.[i] ?? 0)) * radians) as [number, number, number]);
      if (scripted?.wheelRotation) {
        const [x, y, z] = scripted.wheelRotation;
        const roll = x * (wheel?.rollScale ?? 1);
        const reslice = !!(wheel && entry.rolling);
        entry.rolling?.setRoll(reslice ? roll : 0, node.settings.spacing);
        childQuaternion.setFromEuler(childRotation.set(reslice ? 0 : roll * radians, y * (wheel?.steeringScale ?? 1) * radians, z * radians));
        rotateAroundHub(group, childQuaternion, (entry.centerY ?? 0) * (entry.content?.scale.y ?? 1));
      } else entry.rolling?.setRoll(0, node.settings.spacing);
    }
    const follow = playground ? state.view.follow ?? null : null;
    const followedGroup = follow && entries.get(follow)?.group;
    if (followedGroup) {
      followedGroup.getWorldPosition(followDelta);
      if (follow === followed) {
        followDelta.sub(followPosition);
        controls.target.add(followDelta);
        camera.position.add(followDelta);
        followPosition.add(followDelta);
      } else followPosition.copy(followDelta);
    }
    followed = follow;
    if (fitting && state.nodes.every(node => !node.atlasId || isReady(node.id) || failures.has(node.id))) {
      frame(); fitting = false; root.userData.framed = true;
    }
    if (host.dataset.backend === 'gpu') renderer?.render(scene, camera);
    else cpu.render(root, camera, state.view.supersampling, state.view.grid, 0, false, state.view);
  }
  requestAnimationFrame(animate);
  return { sync, previewTransform, scripts };
}
