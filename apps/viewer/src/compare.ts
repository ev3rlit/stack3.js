import { createAssetObject } from '@stack3/three';
import type { AtlasCalibration, ComparisonMesh, ProjectSummary, Raster, SceneNode, StackData } from '@stack3/core';
import { AmbientLight, Box3, Color, DataTexture, Group, Matrix4, ObjectSpaceNormalMap, Vector3, DirectionalLight, MathUtils, Mesh, MeshStandardMaterial,
  LinearFilter, NearestFilter, OrthographicCamera, Scene, WebGLRenderer, type MeshBasicMaterial } from 'three';
import { createAssemblyObject, instantiateParts } from './assembly';
import { multipartPresets } from './presets';
import type { ComparisonData, ComparisonJob, ComparisonLayout, ComparisonReply, PartComparison } from './compare.worker';
import './style.css';
import './compare.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element<HTMLOutputElement>('comparison-status');
const upload = element<HTMLInputElement>('atlas');
const part = element<HTMLSelectElement>('part');
const yaw = element<HTMLInputElement>('yaw');
const pitch = element<HTMLInputElement>('pitch');
const zoom = element<HTMLInputElement>('zoom');
const layers = element<HTMLInputElement>('layers');
const spacing = element<HTMLInputElement>('spacing');
const explode = element<HTMLInputElement>('explode');
const clay = element<HTMLButtonElement>('clay');
const gridView = document.querySelector<HTMLElement>('.compare-results')!;
const query = new URLSearchParams(location.search);
const token = query.get('session');
const endpoint = token && /^[a-f0-9-]{36}$/.test(token) ? './__stack3_project/' + token : undefined;
let project: ProjectSummary | undefined;
let generation = 0;
let worker: Worker | undefined;
let layerTimer: number | undefined;
let source: { job: ComparisonJob; name: string } | undefined;
let previews: ReturnType<typeof makeThumbnail>[] = [];
let renderer: ReturnType<typeof makeRenderer> | undefined;
let span = 1;
const target = new Vector3();
let partOffsets: Vector3[] = [];
let frame = 0;
const defaultLayout = 'top,left,front,rear';
const defaultSettings = { layers: 80, resolution: 144 };
const tankParts = multipartPresets.tank!;
const mapsSample = 'Future Tank · hull material passes';
const mapsAssets = {
  source: new URL('../../../samples/future-tank/hull-4view.png', import.meta.url),
  clay: new URL('../../../samples/future-tank/hull-clay-4view.png', import.meta.url),
  depth: new URL('../../../samples/future-tank/hull-depth-4view.png', import.meta.url),
  baseColor: new URL('../../../samples/future-tank/hull-base-color-4view.png', import.meta.url),
  normal: new URL('../../../samples/future-tank/hull-normal-4view.png', import.meta.url),
  calibration: new URL('../../../samples/future-tank/hull-depth-4view.json', import.meta.url),
};
const samples = [
  'Armored tank · full (assembled)',
  ...tankParts.map(spec => 'Armored tank · ' + spec.name.toLowerCase()),
  mapsSample,
];
type StagePart = ComparisonLayout & { asset: ComparisonMesh | StackData; grid: number[]; normalMap?: Raster };
type PreviewStage = { title: string; detail: string; parts: StagePart[]; geometryOnly?: boolean; nearest?: boolean; lit?: boolean };
const stageLabels = ['Voxel surface', 'Marching Cubes', 'Finer grid', 'RGB · nearest',
  'RGB · linear', 'RGB + ID', 'RGB + ID + depth'];

function showStatus(message: string, error = false) {
  status.value = message;
  status.dataset.error = String(error);
}

function makeRenderer() {
  const gpu = new WebGLRenderer({ antialias: true });
  const density = Math.min(devicePixelRatio, 2);
  const camera = new OrthographicCamera(-1, 1, 1, -1, .01, 50);
  const scene = new Scene();
  scene.background = new Color('#121923');
  const gray = new MeshStandardMaterial({ color: '#b4bac3', roughness: .85 });
  const light = new DirectionalLight('#fff2e5', 2.6);
  light.position.set(3, 6, -4);
  scene.add(light, new AmbientLight('#b6c9e4', 1.5));
  let renderWidth = 0, renderHeight = 0;
  return {
    gray,
    draw(object: Group, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
      const width = Math.round(canvas.clientWidth * density), height = Math.round(canvas.clientHeight * density);
      if (!width || !height) return;
      const aspect = width / height;
      const halfHeight = span / Math.min(1, aspect) / Number(zoom.value);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      const azimuth = MathUtils.degToRad(Number(yaw.value)), elevation = MathUtils.degToRad(Number(pitch.value));
      const distance = Math.max(8, span * 4);
      camera.far = distance + span * 3;
      camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance,
        -Math.cos(azimuth) * Math.cos(elevation) * distance).add(target);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      if (width !== renderWidth || height !== renderHeight) {
        gpu.setSize(width, height, false);
        renderWidth = width;
        renderHeight = height;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      scene.add(object);
      gpu.render(scene, camera);
      context.drawImage(gpu.domElement, 0, 0);
      scene.remove(object);
    },
  };
}

function mappedMaterial(base: MeshBasicMaterial, normal?: Raster) {
  const material = new MeshStandardMaterial({ map: base.map, roughness: .82 });
  base.dispose();
  if (!normal) return material;
  const map = new DataTexture(normal.data, normal.width, normal.height);
  map.minFilter = map.magFilter = LinearFilter;
  map.needsUpdate = true;
  material.normalMap = map;
  material.normalMapType = ObjectSpaceNormalMap;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      vec3 geometricNormal = normal;
      #include <normal_fragment_maps>
      float coverage = texture2D(normalMap, vNormalMapUv).a;
      normal = normalize(mix(geometricNormal, normal, coverage));
    `);
  };
  return material;
}

function makeThumbnail(stage: PreviewStage, surface: HTMLCanvasElement, renderer: ReturnType<typeof makeRenderer>) {
  const context = surface.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create a thumbnail surface.');
  const placed = instantiateParts(stage.parts.map(part => part.asset), stage.parts);
  const mounts = stage.parts.flatMap(part => part.mounts);
  const detailMaps = stage.parts.flatMap(part => part.mounts.map(() => part.normalMap));
  const assembly = createAssemblyObject(placed);
  const filter = stage.nearest ? NearestFilter : LinearFilter;
  const meshes: { mesh: Mesh; textured: MeshBasicMaterial | MeshStandardMaterial; accent?: Mesh }[] = [];
  const stacks: { object: Group; asset: StackData }[] = [];
  for (const [index, { asset }] of placed.entries()) {
    const object = assembly.children[index];
    const matrix = mounts[index].matrix;
    if (matrix) {
      object.matrix.fromArray(matrix);
      object.matrixAutoUpdate = false;
      object.matrixWorldNeedsUpdate = true;
    }
    if (asset.target === 'stack') {
      stacks.push({ object: object as Group, asset });
      continue;
    }
    const mesh = object as Mesh;
    const base = mesh.material as MeshBasicMaterial;
    const textured = stage.lit ? mappedMaterial(base, detailMaps[index]) : base;
    if (textured.map) {
      textured.map.minFilter = textured.map.magFilter = filter;
      textured.map.needsUpdate = true;
    }
    const decal = !stage.geometryOnly && (asset as ComparisonMesh).frontAccents;
    const accent = decal ? createAssetObject(decal) as Mesh : undefined;
    if (accent) {
      (accent.material as MeshBasicMaterial).alphaTest = .4;
      mesh.add(accent);
    }
    meshes.push({ mesh, textured, accent });
  }
  const poses = assembly.children.map(object => {
    if (object.matrixAutoUpdate) object.updateMatrix();
    object.matrixAutoUpdate = false;
    return object.matrix.clone();
  });
  let appliedSpacing = 1;
  let appliedExplosion = 0;
  return {
    surface,
    isStack: stacks.length > 0,
    draw() {
      const separation = explode.valueAsNumber / 100;
      if (separation !== appliedExplosion) {
        for (const [index, object] of assembly.children.entries()) {
          const offset = partOffsets[index];
          object.matrix.copy(poses[index]);
          object.matrix.elements[12] += offset.x * separation;
          object.matrix.elements[13] += offset.y * separation;
          object.matrix.elements[14] += offset.z * separation;
          object.matrixWorldNeedsUpdate = true;
        }
        appliedExplosion = separation;
      }
      const multiplier = spacing.valueAsNumber;
      if (stacks.length && multiplier !== appliedSpacing) {
        for (const { object, asset } of stacks) {
          for (const [layer, slice] of object.children.entries()) {
            slice.position.y = ((layer + .5) * asset.spacing - asset.pivot[2]) * multiplier;
          }
        }
        appliedSpacing = multiplier;
      }
      const geometryOnly = stage.geometryOnly || clay.getAttribute('aria-pressed') === 'true';
      for (const { mesh, textured, accent } of meshes) {
        mesh.material = geometryOnly ? renderer.gray : textured;
        if (accent) accent.visible = !geometryOnly;
      }
      renderer.draw(assembly, surface, context);
    },
    dispose() {
      for (const { object } of stacks) {
        // Slices within one stack share a plane geometry and have distinct materials.
        const slices = object.children as Mesh[];
        slices[0]?.geometry.dispose();
        for (const slice of slices) {
          const material = slice.material as MeshBasicMaterial;
          material.map?.dispose();
          material.dispose();
        }
      }
      for (const { mesh, textured, accent } of meshes) {
        mesh.geometry.dispose();
        textured.map?.dispose();
        if (textured instanceof MeshStandardMaterial) textured.normalMap?.dispose();
        textured.dispose();
        if (!accent) continue;
        accent.geometry.dispose();
        const material = accent.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}

function describeStages(parts: PartComparison[]) {
  const partStages = (stage: 'voxel' | 'marching' | 'stack' | 0 | 1 | 2): StagePart[] => parts.map(part => ({
    name: part.name, mounts: part.mounts,
    asset: typeof stage === 'number' ? part.meshes[stage] : part[stage],
    grid: stage === 'voxel' || stage === 'marching' ? part.coarseGrid : part.fullGrid,
  }));
  const rgb = partStages(0);
  const sameGrid = parts.every(part => part.fullGrid.every((value, index) => value === part.coarseGrid[index]));
  const variants: PreviewStage[] = [
    { title: 'RGB only', detail: 'Visual hull and RGB projection', parts: rgb },
    { title: 'RGB + ID', detail: 'Keeps accent colors on visible source-facing surfaces', parts: partStages(1) },
    { title: 'RGB + ID + depth', detail: 'Rebuilds the surface with smoother depth transitions', parts: partStages(2) },
  ];
  const stages: PreviewStage[] = [
    { title: 'Sprite Stack', detail: 'Spacing changes the distance between these horizontal slices.', parts: partStages('stack') },
    { title: stageLabels[0], detail: 'Exposed faces of the occupied cells.', parts: partStages('voxel'), geometryOnly: true },
    { title: stageLabels[1], detail: 'Interpolated surface from the same occupied cells.', parts: partStages('marching'), geometryOnly: true },
    { title: stageLabels[2], detail: sameGrid ? 'Only one occupied grid was available at these settings.' : 'Marching Cubes rebuilt with the full sampling grid.', parts: rgb, geometryOnly: true },
    { title: stageLabels[3], detail: 'Projects the atlas onto that mesh, using the closest texel.', parts: rgb, nearest: true },
    { title: stageLabels[4], detail: 'Blends nearby texels on the same textured mesh.', parts: rgb },
    variants[1], variants[2],
  ];
  if (parts.some(part => part.mapped)) {
    const depth = parts.map(part => ({
      name: part.name, mounts: part.mounts, asset: part.mapped?.mesh ?? part.meshes[0],
      grid: part.mapped?.grid ?? part.fullGrid,
    }));
    const normal = depth.map((part, index) => ({ ...part, normalMap: parts[index].mapped?.normalMap }));
    const silhouette = depth.map((part, index) => ({ ...part, asset: parts[index].mapped?.silhouetteMesh ?? part.asset }));
    stages.unshift(
      { title: 'Clay Silhouette Only', detail: 'Uses the same calibrated Clay views, grid, and lighting.', parts: silhouette, geometryOnly: true },
      { title: 'Clay + Depth Map', detail: 'Uses the 16-bit depth pass to carve the registered Clay silhouettes.', parts: depth, geometryOnly: true },
      { title: 'Depth + Base Color', detail: 'Projects the generated color pass onto the depth-carved mesh.', parts: depth, lit: true },
      { title: 'Depth + Base Color + Normal', detail: 'Uses the view-space normal pass for per-pixel lighting on the same mesh.', parts: normal, lit: true },
    );
  }
  return stages;
}

function addThumbnail(stage: PreviewStage, container: HTMLElement) {
  const figure = document.createElement('figure');
  const surface = document.createElement('canvas');
  surface.className = 'model';
  surface.setAttribute('role', 'img');
  surface.setAttribute('aria-label', stage.title);
  figure.append(surface);
  const caption = document.createElement('figcaption');
  const stats = document.createElement('small');
  const grids = stage.parts.map(({ name, grid }) => (name ? name + ' ' : '') + grid.join(' × ')).join(' · ');
  const counts = stage.parts.reduce((sum, { asset, mounts }) =>
    sum + (asset.target === 'stack' ? asset.layers : asset.indices.length / 3) * mounts.length, 0);
  const unit = stage.parts[0].asset.target === 'stack' ? ' slices' : ' triangles';
  stats.textContent = grids + ' cells · ' + counts.toLocaleString() + unit;
  caption.append(stats);
  figure.append(caption);
  container.append(figure);
  previews.push(makeThumbnail(stage, surface, renderer!));
  resize.observe(surface);
}

type Fit = NonNullable<PartComparison['mapped']>['fit'];

function depthFitCard(fit: Fit) {
  const card = document.createElement('section');
  card.className = 'depth-fit';
  const title = document.createElement('h2');
  title.textContent = 'Depth Fit';
  card.append(title);
  const units = (value: number | null) => value === null ? '—' : value.toFixed(3);
  const summary = document.createElement('strong');
  summary.textContent = units(fit.baselineMae) + ' → ' + units(fit.carvedMae) + ' units';
  card.append(summary);
  const explanation = document.createElement('p');
  const delta = fit.baselineMae && fit.carvedMae !== null ? 100 * (fit.carvedMae / fit.baselineMae - 1) : null;
  explanation.textContent = 'Mean absolute distance error against the supplied depth map' +
    (delta === null ? '.' : ' · ' + (delta > 0 ? '+' : '−') + Math.abs(delta).toFixed(1) + '%');
  card.append(explanation);
  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Mean absolute depth error by camera');
  const header = table.createTHead().insertRow();
  for (const label of ['View', 'Clay only', '+ Depth']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    header.append(cell);
  }
  const tbody = table.createTBody();
  for (const view of fit.byView) {
    const row = tbody.insertRow();
    for (const label of [view.view.toUpperCase(), units(view.baselineMae), units(view.carvedMae)]) {
      row.insertCell().textContent = label;
    }
  }
  card.append(table);
  const coverage = document.createElement('p');
  coverage.textContent = fit.sharedPixels.toLocaleString() + ' shared visible pixels · ' +
    (100 * fit.sharedPixels / Math.max(1, fit.referencePixels)).toFixed(1) + '% of reference';
  card.append(coverage);
  return card;
}

function renderGallery(result: ComparisonData) {
  for (const preview of previews) {
    resize.unobserve(preview.surface);
    preview.dispose();
  }
  previews = [];
  const stages = describeStages(result.parts);
  const fit = result.parts.find(part => part.mapped)?.mapped?.fit;
  const cards = document.createDocumentFragment();
  for (const stage of stages) {
    const card = document.createElement('section');
    const title = document.createElement('h2');
    const detail = document.createElement('p');
    title.textContent = stage.title;
    detail.textContent = stage.detail;
    card.append(title);
    addThumbnail(stage, card);
    card.append(detail);
    cards.append(card);
    if (fit && stage.title === 'Clay + Depth Map') cards.append(depthFitCard(fit));
  }
  gridView.replaceChildren(cards);
  redraw();
}

function redraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    element('yaw-value').textContent = yaw.value + '°';
    element('pitch-value').textContent = pitch.value + '°';
    element('zoom-value').textContent = zoom.value + '×';
    element('explode-value').textContent = explode.value + '%';
    previews.forEach(preview => preview.draw());
  });
}

function cancelBuild() {
  window.clearTimeout(layerTimer);
  worker?.terminate();
  worker = undefined;
  return ++generation;
}

function build(job: ComparisonJob, name: string, request: number) {
  const active = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' });
  worker = active;
  active.onerror = () => {
    active.terminate();
    if (request === generation) {
      worker = undefined;
      showStatus('The comparison worker could not start.', true);
    }
  };
  active.onmessage = ({ data }: MessageEvent<ComparisonReply>) => {
    active.terminate();
    if (request !== generation) return;
    worker = undefined;
    if ('error' in data) {
      showStatus(data.error, true);
      return;
    }
    try {
      showComparison(data, name);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : String(error), true);
    }
  };
  active.postMessage(job);
}

function start(load: () => Promise<ComparisonJob>, name: string) {
  const request = cancelBuild();
  source = undefined;
  layers.disabled = true;
  spacing.disabled = true;
  explode.disabled = true;
  showStatus('Building comparison from ' + name + '…');
  element('comparison-warnings').replaceChildren();
  void load().then(job => {
    if (request !== generation) return;
    source = { job, name };
    const settings = 'parts' in job ? job.parts.map(part => part.settings) : [job.settings];
    const initial = settings[0].layers ?? defaultSettings.layers;
    layers.value = String(initial);
    element('layers-value').textContent = settings.every(item => (item.layers ?? defaultSettings.layers) === initial)
      ? String(initial) : 'Per part';
    layers.disabled = false;
    build(job, name, request);
  }).catch(error => { if (request === generation) showStatus(String(error), true); });
}

function mountedBounds(parts: PartComparison[]) {
  return parts.flatMap(part => {
    const { size: [width, depth, height], pivot } = part.meshes[0];
    const local = new Box3(new Vector3(-width / 2, -pivot[2], -depth / 2),
      new Vector3(width / 2, height - pivot[2], depth / 2));
    return part.mounts.map(({ position: [x, y, z], scale = 1, matrix }) => {
      const transform = matrix ? new Matrix4().fromArray(matrix)
        : new Matrix4().makeScale(scale, scale, scale).setPosition(x, z, -y);
      return local.clone().applyMatrix4(transform);
    });
  });
}

function explosionOffsets(mounts: Box3[], span: Vector3) {
  const sizes = mounts.map(box => box.getSize(new Vector3()));
  // Keep the largest footprint anchored, usually the chassis.
  const base = sizes.reduce((best, size, index) => size.x * size.z > sizes[best].x * sizes[best].z ? index : best, 0);
  const center = mounts[base].getCenter(new Vector3());
  const baseSize = sizes[base];
  const gap = Math.max(span.x, span.y, span.z) * .12;
  return mounts.map((mount, index) => {
    if (index === base) return new Vector3();
    const direction = mount.getCenter(new Vector3()).sub(center);
    const raised = direction.y > baseSize.y * .18;
    direction.y = 0;
    const radial = Math.hypot(direction.x / baseSize.x, direction.z / baseSize.z);
    if (radial > .16) direction.normalize().multiplyScalar(gap);
    else direction.set(0, 0, 0);
    if (raised || radial <= .16) direction.y = gap;
    return direction;
  });
}

function showComparison(result: ComparisonData, name: string) {
  renderer ??= makeRenderer();
  const mounts = mountedBounds(result.parts);
  const bounds = mounts.reduce((whole, mount) => whole.union(mount), new Box3());
  const size = bounds.getSize(new Vector3());
  span = size.length() * .53;
  bounds.getCenter(target);
  partOffsets = explosionOffsets(mounts, size);
  explode.disabled = mounts.length < 2;
  if (explode.disabled) explode.value = explode.defaultValue;
  element('comparison-warnings').replaceChildren(...result.warnings.map(warning => {
    const item = document.createElement('li');
    item.textContent = warning;
    return item;
  }));
  renderGallery(result);
  spacing.disabled = false;
  const assembly = result.parts.length > 1 ? ' ' + result.parts.length + ' atlases reconstructed separately.' : '';
  showStatus(name + ' · Comparison ready.' + assembly + ' Camera settings are shared.');
}

function sourceOptions() {
  const parts = project?.nodes.filter(node => node.atlasId) ?? [];
  const sampleOptions = document.createElement('optgroup');
  sampleOptions.label = 'Built-in atlases';
  sampleOptions.append(...samples.map((name, index) => new Option(name, 'sample:' + index)));
  const projectOptions = document.createElement('optgroup');
  projectOptions.label = project?.name ?? 'Project';
  projectOptions.append(...parts.map(node => new Option(node.name, node.id)));
  if (parts.length > 1) projectOptions.append(new Option('Project · full (assembled)', 'project:assembly'));
  const options = parts.length ? [projectOptions, sampleOptions] : [sampleOptions];
  part.replaceChildren(...options);
}

function projectPlacement(nodes: SceneNode[]) {
  const root = new Group();
  const groups = new Map(nodes.map(node => {
    const group = new Group();
    group.position.set(...node.position);
    group.rotation.set(...node.rotation.map(MathUtils.degToRad) as [number, number, number]);
    group.scale.set(...node.scale);
    group.visible = node.visible;
    return [node.id, group];
  }));
  for (const node of nodes) {
    const parent = node.parentId ? groups.get(node.parentId) : undefined;
    (parent ?? root).add(groups.get(node.id)!);
  }
  root.updateMatrixWorld(true);
  const visible = new Set<Group>();
  root.traverseVisible(group => visible.add(group as Group));
  return nodes.flatMap(node => {
    const group = groups.get(node.id)!;
    return node.atlasId && visible.has(group) ? [{ node, matrix: group.matrixWorld.toArray() }] : [];
  });
}

async function projectAtlas(atlas: ProjectSummary['atlases'][number]) {
  const url = endpoint + '/atlas/' + encodeURIComponent(atlas.id);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the project atlas.');
  return { file: await response.blob(), layout: atlas.layout };
}

async function loadMappedHull(): Promise<ComparisonJob> {
  async function read(url: URL) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load the hull material passes.');
    return response;
  }
  const [file, clay, depth, baseColor, normal, calibration] = await Promise.all([
    read(mapsAssets.source).then(response => response.blob()),
    read(mapsAssets.clay).then(response => response.blob()),
    read(mapsAssets.depth).then(response => response.blob()),
    read(mapsAssets.baseColor).then(response => response.blob()),
    read(mapsAssets.normal).then(response => response.blob()),
    read(mapsAssets.calibration).then(response => response.json() as Promise<AtlasCalibration>),
  ]);
  return { file, layout: defaultLayout, settings: { ...defaultSettings, size: calibration.size },
    maps: { clay, depth, baseColor, normal, calibration } };
}

function loadPart() {
  if (part.value.startsWith('sample:')) {
    const index = Number(part.value.slice(7));
    const name = samples[index];
    if (!name) return;
    if (name === mapsSample) {
      start(loadMappedHull, name);
      return;
    }
    start(async () => {
      async function loadAtlas(url: URL) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not load the built-in atlas.');
        return { file: await response.blob(), layout: defaultLayout };
      }
      if (index === 0) {
        const parts = await Promise.all(tankParts.map(async ({ name, url, size, mounts }) => ({
          ...await loadAtlas(url), name, mounts, settings: { ...defaultSettings, size, height: size?.[2] },
        })));
        return { parts };
      }
      const url = tankParts[index - 1].url;
      return { ...await loadAtlas(url), settings: defaultSettings };
    }, name);
    return;
  }
  if (part.value === 'project:assembly' && project && endpoint) {
    const source = project;
    start(async () => {
      const placements = projectPlacement(source.nodes);
      if (!placements.length) throw new Error('No visible atlas parts in the project.');
      const reads = new Map<string, ReturnType<typeof projectAtlas>>();
      const parts = await Promise.all(placements.map(async ({ node, matrix }) => {
        const atlas = source.atlases.find(atlas => atlas.id === node.atlasId);
        if (!atlas) throw new Error('Missing atlas for ' + node.name);
        if (!reads.has(atlas.id)) reads.set(atlas.id, projectAtlas(atlas));
        return { ...await reads.get(atlas.id)!, name: node.name,
          mounts: [{ name: node.name, position: [0, 0, 0] as [number, number, number], matrix }], settings: node.settings };
      }));
      return { parts };
    }, source.name + ' · full (assembled)');
    return;
  }
  const node = project?.nodes.find(item => item.id === part.value);
  const atlas = project?.atlases.find(item => item.id === node?.atlasId);
  if (!endpoint || !node || !atlas) return;
  start(async () => ({ ...await projectAtlas(atlas), settings: node.settings }), node.name);
}

upload.addEventListener('change', () => {
  const file = upload.files?.[0];
  if (!file) return;
  part.selectedIndex = -1;
  start(async () => ({ file, layout: defaultLayout, settings: defaultSettings }), file.name);
});
part.addEventListener('change', () => { upload.value = ''; loadPart(); });
layers.addEventListener('input', () => {
  if (!source) return;
  const { job, name } = source;
  const value = layers.valueAsNumber;
  const request = cancelBuild();
  element('layers-value').textContent = String(value);
  showStatus('Rebuilding ' + name + ' at ' + value + ' layers…');
  const updated: ComparisonJob = 'parts' in job ? {
    parts: job.parts.map(part => ({ ...part, settings: { ...part.settings, layers: value } })),
  } : { ...job, settings: { ...job.settings, layers: value } };
  layerTimer = window.setTimeout(() => build(updated, name, request), 85);
});
spacing.addEventListener('input', () => {
  element('spacing-value').textContent = spacing.valueAsNumber.toFixed(2) + '×';
  previews.find(preview => preview.isStack)?.draw();
});
for (const input of [yaw, pitch, zoom, explode]) input.addEventListener('input', redraw);
clay.addEventListener('click', () => {
  clay.setAttribute('aria-pressed', String(clay.getAttribute('aria-pressed') !== 'true'));
  redraw();
});
element('reset').addEventListener('click', () => {
  for (const input of [yaw, pitch, zoom]) input.value = input.defaultValue;
  redraw();
});
const resize = new ResizeObserver(redraw);
sourceOptions();
const sampleIndex = query.get('sample');
if (sampleIndex !== null && [...part.options].some(option => option.value === 'sample:' + sampleIndex)) {
  part.value = 'sample:' + sampleIndex;
  loadPart();
}
if (endpoint) {
  const back = element<HTMLAnchorElement>('back');
  back.href = './project.html?session=' + token + '&playground=1';
  back.textContent = 'Playground';
  void fetch(endpoint + '/state').then(async response => {
    if (!response.ok) throw new Error('Could not read the project.');
    project = await response.json() as ProjectSummary;
    const selected = part.value;
    sourceOptions();
    if (!generation) {
      if ([...part.options].some(option => option.value === 'project:assembly')) part.value = 'project:assembly';
      loadPart();
    } else part.value = selected;
  }).catch(() => { if (!generation) loadPart(); });
} else if (!generation) loadPart();
