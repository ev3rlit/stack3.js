import { fourWheelPreset, parseLayout, stackWheelScript, trackedTankPreset, vehicleScript,
  type ProjectAction, type ProjectSummary, type SceneNode, type SceneScript, type Vec3 } from '@stack3/core';
import { makeProjectStage } from './project-stage';
import './style.css';
import './project.css';

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
const query = new URLSearchParams(location.search);
const token = query.get('session');
const playground = query.get('playground') === '1';
if (token && /^[a-f0-9-]{36}$/.test(token)) start(token);
else {
  if (playground) element('openInstruction').append(' --playground');
  element('disconnected').hidden = false;
}

function start(token: string) {
  const endpoint = new URL('./__stack3_project/' + token, location.href).pathname;
  const viewport = element('viewport');
  viewport.dataset.endpoint = endpoint;
  const status = element<HTMLOutputElement>('status');
  const editorLink = element<HTMLAnchorElement>('editorMode');
  const playLink = element<HTMLAnchorElement>('playMode');
  element<HTMLAnchorElement>('compareMode').href = './compare.html?session=' + token;
  editorLink.href = './project.html?session=' + token;
  playLink.href = editorLink.href + '&playground=1';
  editorLink.hidden = playLink.hidden = false;
  (playground ? playLink : editorLink).setAttribute('aria-current', 'page');
  element('workspace').hidden = false;
  element('stageTitle').textContent = playground ? 'Playground' : 'Scene';
  status.value = 'Connecting…';

  let state: ProjectSummary | undefined;
  let inspectorKey = '';
  let assetKey = '';
  let viewportKey = '';
  let renderingTarget: string | undefined;
  let sending: Promise<void> = Promise.resolve();
  const stage = makeProjectStage(viewport, patch => send([{ action: 'view.set', patch }]), (message, ready) => {
    element<HTMLOutputElement>('buildStatus').value = message;
    viewport.dataset.readyCount = String(ready);
  }, playground, (node, script, message) => {
    const target = document.getElementById(scriptStatusId(node, script));
    if (target) target.textContent = message;
  });

  const tabs = [element<HTMLButtonElement>('objectTab'), element<HTMLButtonElement>('renderingTab')];
  function selectInspectorTab(index: number) {
    for (const [i, tab] of tabs.entries()) {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      element(tab.getAttribute('aria-controls')!).hidden = i !== index;
    }
    const hash = index === 1 ? '#rendering' : '';
    editorLink.hash = hash;
    playLink.hash = hash;
  }
  selectInspectorTab(location.hash === '#rendering' ? 1 : 0);
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectInspectorTab(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length;
      selectInspectorTab(target);
      tabs[target].focus();
    });
  }

  function showAssetRendering(project: ProjectSummary) {
    const parts = project.nodes.filter(node => node.atlasId);
    const target = parts.find(node => node.id === renderingTarget) ?? parts[0];
    renderingTarget = target?.id;
    const key = JSON.stringify([target?.id, target?.settings, parts.map(({ id, name }) => [id, name])]);
    if (key === assetKey) return;
    assetKey = key;
    const container = element('assetProperties');
    const expanded = container.querySelector('details')?.open;
    const focused = container.contains(document.activeElement) ? document.activeElement?.id : undefined;
    if (!target) {
      container.replaceChildren(muted('Import an atlas to configure asset rendering.'));
      return;
    }
    container.replaceChildren(
      selectField('Part', target.id, parts.map(({ id, name }) => [id, name]), value => {
        renderingTarget = value;
        if (state) showAssetRendering(state);
      }),
      ...assetInspector(target),
    );
    if (expanded) container.querySelector('details')!.open = true;
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  }

  function show(next: ProjectSummary) {
    if (state && next.revision <= state.revision) return;
    if (state?.view.selected !== next.view.selected && next.nodes.some(node => node.id === next.view.selected && node.atlasId)) {
      renderingTarget = next.view.selected!;
    }
    state = next;
    document.documentElement.dataset.revision = String(next.revision);
    stage.sync(next);
    element('projectName').textContent = next.name;
    document.title = next.name + ' · ' + (playground ? 'Playground' : 'Scene editor') + ' · stack3.js';
    element('emptyStage').hidden = next.nodes.some(node => node.atlasId);
    element('hierarchy').replaceChildren(tree(next, null));
    element('atlasLibrary').replaceChildren(...next.atlases.map(source => {
      const row = document.createElement('div');
      row.className = 'atlas-row';
      const name = document.createElement('span');
      name.textContent = source.name;
      const button = control('Instance', () => {
        const id = crypto.randomUUID();
        send([{ action: 'node.add', id, name: source.name, atlasId: source.id, parentId: state?.view.selected ?? null },
          { action: 'view.set', patch: { selected: id } }, { action: 'view.frame' }]);
      });
      row.append(name, button);
      if (!next.nodes.some(node => node.atlasId === source.id)) {
        row.append(control('Remove atlas', () => send([{ action: 'atlas.remove', id: source.id }])));
      }
      return row;
    }));
    const selected = next.nodes.find(node => node.id === next.view.selected);
    const scripted = stage.scripts?.hasScripts();
    element('playTarget').textContent = scripted
      ? (next.play.startedAt === null ? 'Press Play to run script components.' : 'Script components running. Keyboard input is active.')
      : (selected ? selected.name + ' · Nudge with WASD' : 'Select an object to nudge it with WASD.');
    element('moveButtons').hidden = !!scripted;
    for (const button of element('moveButtons').querySelectorAll('button')) button.disabled = !selected;
    const properties = element('properties');
    const active = document.activeElement;
    const focusedSlider = active instanceof HTMLInputElement && active.dataset.transformNode === selected?.id ? active.id : '';
    const key = JSON.stringify([selected, next.nodes.map(({ id, name, parentId }) => [id, name, parentId])]);
    if (key !== inspectorKey) {
      const openScripts = new Set(Array.from(properties.querySelectorAll<HTMLDetailsElement>('details[open]'))
        .map(details => details.dataset.scriptEditor));
      inspectorKey = key;
      properties.replaceChildren(...(selected ? inspector(selected, next) : [muted('Select an object to edit its properties.')]));
      for (const details of properties.querySelectorAll<HTMLDetailsElement>('details[data-script-editor]')) {
        details.open = openScripts.has(details.dataset.scriptEditor);
      }
      if (focusedSlider) document.getElementById(focusedSlider)?.focus({ preventScroll: true });
    }
    showAssetRendering(next);
    const view = element('viewProperties');
    const nextViewportKey = JSON.stringify([next.view, next.nodes.filter(node => node.scripts?.length)
      .map(({ id, name }) => [id, name])]);
    if (viewportKey !== nextViewportKey) {
      viewportKey = nextViewportKey;
      const focused = view.contains(document.activeElement) ? document.activeElement?.id : undefined;
      view.replaceChildren(...viewInspector(next));
      if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    }
    const play = element('togglePlay');
    play.textContent = next.play.startedAt === null ? 'Play' : 'Pause';
    play.setAttribute('aria-pressed', String(next.play.startedAt !== null));
  }

  async function refresh() {
    try {
      const after = state ? '?after=' + state.revision : '';
      const response = await fetch(endpoint + '/state' + after);
      if (!response.ok) throw new Error('The live project server is unavailable.');
      if (response.status !== 204) {
        show(await response.json());
        status.value = '';
      }
    } catch (error) {
      status.value = (error as Error).message;
    }
  }

  function send(actions: ProjectAction[] | ((current: ProjectSummary) => ProjectAction[])) {
    sending = sending.then(async () => {
      if (!state) return;
      try {
        const batch = typeof actions === 'function' ? actions(state) : actions;
        if (!batch.length) { status.value = ''; return; }
        const response = await fetch(endpoint + '/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: state.revision, actions: batch }) });
        const value = await response.json();
        if (response.status === 409) await refresh();
        if (!response.ok) throw new Error(value.error || 'Could not apply the edit.');
        show(value);
        status.value = '';
      } catch (error) { status.value = (error as Error).message; }
    });
    return sending;
  }

  function tree(project: ProjectSummary, parentId: string | null) {
    const list = document.createElement('ul');
    list.className = 'scene-tree';
    for (const node of project.nodes.filter(item => item.parentId === parentId)) {
      const row = document.createElement('li');
      const select = control(node.name, () => send([{ action: 'view.set', patch: { selected: node.id } }]));
      const kind = document.createElement('small');
      kind.textContent = node.atlasId ? (node.settings.format === 'glb' ? '3D' : '2D') : 'Group';
      select.prepend(kind);
      select.dataset.node = node.id;
      select.setAttribute('aria-pressed', String(node.id === project.view.selected));
      row.append(select, tree(project, node.id));
      list.append(row);
    }
    return list;
  }

  function inspector(node: SceneNode, project: ProjectSummary) {
    const set = (patch: object) => send([{ action: 'node.set', id: node.id, patch }]);
    const parentById = new Map(project.nodes.map(item => [item.id, item.parentId]));
    const allowedParents = project.nodes.filter(candidate => {
      for (let id: string | null | undefined = candidate.id; id; id = parentById.get(id)) if (id === node.id) return false;
      return true;
    });
    const rootGroup = !node.parentId && !node.atlasId;
    const transform = (title: string, key: 'position' | 'rotation') => {
      if (!rootGroup) return vectorField(title, node[key], value => set({ [key]: value }));
      const patchAxis = (source: Vec3, axis: number, component: number) => {
        const result: Vec3 = [...source];
        result[axis] = component;
        return result;
      };
      return transformSliders(title, node.id, node[key], key === 'position', (axis, value) =>
        stage.previewTransform(node.id, { [key]: patchAxis(node[key], axis, value) }), (axis, value) =>
        send(current => {
          const target = current.nodes.find(item => item.id === node.id);
          return target ? [{ action: 'node.set', id: node.id, patch: { [key]: patchAxis(target[key], axis, value) } }] : [];
        }));
    };
    const properties: HTMLElement[] = [
      line('Name', node.name, value => set({ name: value })),
      selectField('Parent', node.parentId ?? '', [['', 'Scene root'], ...allowedParents.map(item => [item.id, item.name] as [string, string])],
        value => send([{ action: 'node.move', id: node.id, parentId: value || null }])),
      check('Visible', node.visible, value => set({ visible: value })),
      transform('Position', 'position'),
      transform('Rotation (degrees)', 'rotation'),
      vectorField('Scale', node.scale, value => set({ scale: value })),
    ];
    if (rootGroup || project.nodes.some(child => child.parentId === node.id)) {
      const presets = document.createElement('div');
      presets.className = 'toolbar';
      presets.append(
        control('Apply Four-wheel', () => send(current => fourWheelPreset(current, node.id).actions)),
        control('Apply Tracked Tank', () => send(current => trackedTankPreset(current, node.id).actions)),
      );
      properties.push(heading('Presets'), presets);
    }
    properties.push(heading('Motion'), vectorField('Velocity (units/s)', node.velocity, value => set({ velocity: value })),
      vectorField('Angular velocity (degrees/s)', node.angularVelocity, value => set({ angularVelocity: value })));
    properties.push(heading('Script components'));
    for (const script of node.scripts ?? []) properties.push(scriptInspector(node, script));
    const addScript = (patch: Omit<SceneScript, 'id'>, id: string = crypto.randomUUID()) => send([
      { action: 'script.set', nodeId: node.id, id, patch },
    ]);
    const add = document.createElement('div');
    add.className = 'toolbar';
    add.append(control('Add script', () => addScript({
      name: 'Script', enabled: false, fields: [],
      source: 'function update({ dt, time, keys, fields, state, position, rotation, children }) {\n  return {};\n}',
    })), control('Add WASD vehicle', () => addScript(vehicleScript)));
    if (node.atlasId && !node.scripts?.some(script => script.id === 'sprite-stack-wheel')) {
      add.append(control('Add Sprite Stack Wheel', () => addScript(stackWheelScript, 'sprite-stack-wheel')));
    }
    properties.push(add);
    const remove = control('Remove subtree', () => send([{ action: 'node.remove', id: node.id }]));
    remove.className = 'danger';
    properties.push(remove);
    return properties;
  }

  function assetInspector(node: SceneNode) {
    const s = node.settings;
    const settings = (patch: object) => send([{ action: 'node.set', id: node.id, patch: { settings: patch } }]);
    const stack = s.format === 'stack';
    const contour = !stack && s.meshMethod === 'contour';
    const advanced = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Reconstruction settings';
    advanced.append(summary,
      ...(!contour ? [numberField('Layers', s.layers, 8, Number.MAX_SAFE_INTEGER, 1, value => settings({ layers: value }))] : []),
      ...(!contour || s.contourHub ? [numberField(contour ? 'Hub segments' : 'Texture resolution', s.resolution, 16, Number.MAX_SAFE_INTEGER, 1, value => settings({ resolution: value }))] : []),
      ...(stack ? [numberField('Spacing', s.spacing, .05, 20, .05, value => settings({ spacing: value }))] : []),
      numberField('Height', s.height, .01, 100, .01, value => settings({ height: value })),
      numberField('Background threshold', s.threshold, 0, 255, 1, value => settings({ threshold: value })),
      selectField('Pivot', s.pivot, [['ground', 'Ground'], ['center', 'Center']], value => settings({ pivot: value })),
      ...(!contour ? [selectField('Cross-section', s.profile, [['silhouette', 'From silhouettes'], ['round', 'Round'], ['round-base', 'Round above square base']],
        value => settings({ profile: value }))] : []),
    );
    return [
      selectField('Asset type', contour ? 'contour' : s.format, [['stack', 'Sprite stack'], ['glb', 'Marching Cubes (3D mesh)'], ['contour', 'Contour extrusion (3D mesh)']],
        value => settings({ format: value === 'stack' ? 'stack' : 'glb', meshMethod: value === 'contour' ? 'contour' : 'marching-cubes' })),
      ...(!stack ? [selectField('Texture projection', s.textureProjection ?? 'auto',
        [['auto', 'Automatic (multi-view)'], ['top-contour', 'Upper contour from TOP']],
        value => settings({ textureProjection: value }))] : []),
      ...(contour ? [check('Centered round hub', s.contourHub ?? false, value => settings({ contourHub: value }))] : []),
      muted(stack ? 'Multi-view texturing blends colors from the atlas views.' : 'Multi-view texturing projects atlas views onto the mesh.'),
      check('Material lighting', s.lighting, value => settings({ lighting: value })),
      ...(stack ? [
        check('Pixel art', s.pixelArt, value => settings({ pixelArt: value })),
        check('Smooth edges', s.smoothEdges, value => settings({ smoothEdges: value })),
      ] : []),
      advanced,
    ];
  }

  function scriptInspector(node: SceneNode, script: SceneScript) {
    const panel = document.createElement('section');
    panel.className = 'script-component';
    const patch = (value: Partial<Omit<SceneScript, 'id'>>) => send([
      { action: 'script.set', nodeId: node.id, id: script.id, patch: value },
    ]);
    const status = document.createElement('output');
    status.id = scriptStatusId(node.id, script.id);
    const prefix = status.id;
    status.textContent = script.enabled ? stage.scripts?.status(node.id, script.id) || '' : '';
    panel.append(heading(script.name), check('Enabled', script.enabled, enabled => patch({ enabled }), prefix + '-enabled'), status);
    for (const exposed of script.fields) {
      panel.append(numberField(exposed.label, exposed.value, exposed.min, exposed.max, exposed.step, value => {
        if (value < exposed.min || value > exposed.max) return;
        void send(current => {
          const latest = current.nodes.find(item => item.id === node.id)?.scripts?.find(item => item.id === script.id);
          return latest ? [{ action: 'script.set', nodeId: node.id, id: script.id, patch: {
            fields: latest.fields.map(item => item.name === exposed.name ? { ...item, value } : item),
          } }] : [];
        });
      }, prefix + '-field-' + exposed.name));
    }
    const details = document.createElement('details');
    details.dataset.scriptEditor = prefix;
    const summary = document.createElement('summary');
    summary.textContent = 'Edit script';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = script.name;
    const source = document.createElement('textarea');
    source.value = script.source;
    source.rows = 9;
    source.spellcheck = false;
    const fields = document.createElement('textarea');
    fields.value = JSON.stringify(script.fields, null, 2);
    fields.rows = 6;
    fields.spellcheck = false;
    name.id = prefix + '-name';
    source.id = prefix + '-source';
    fields.id = prefix + '-fields';
    const error = document.createElement('output');
    error.setAttribute('role', 'status');
    details.append(summary, field('Name', name), field('JavaScript', source), field('Inspector fields (JSON)', fields),
      error, control('Save script', () => {
        try {
          const exposed = JSON.parse(fields.value);
          if (!Array.isArray(exposed)) throw new Error('Use a JSON array for inspector fields.');
          void patch({ name: name.value, source: source.value, fields: exposed });
          error.textContent = '';
        } catch (problem) {
          error.textContent = (problem as Error).message;
        }
      }));
    panel.append(details, control('Remove script', () => send([{ action: 'script.remove', nodeId: node.id, id: script.id }])));
    return panel;
  }

  function viewInspector(project: ProjectSummary) {
    const view = project.view;
    const set = (patch: object) => send([{ action: 'view.set', patch }]);
    const followTargets = project.nodes.filter(node => node.scripts?.length || node.id === view.follow);
    return [
      selectField('Renderer', view.backend, [['cpu', 'CPU'], ['gpu', 'GPU']], value => set({ backend: value })),
      check('Grid', view.grid, value => set({ grid: value })),
      check('Supersampling', view.supersampling, value => set({ supersampling: value })),
      heading('CPU rendering'),
      check('Detail Normals', !!view.detailNormals, value => set({ detailNormals: value, backend: 'cpu' })),
      check('Subpixel AA', !!view.subpixelAA, value => set({ subpixelAA: value, backend: 'cpu' })),
      check('Specular AA', !!view.specularAA, value => set({ specularAA: value, backend: 'cpu' })),
      muted('Detail Normals and Specular AA use each part’s Material lighting setting.'),
      ...(playground && followTargets.length ? [selectField('Follow object', view.follow ?? '',
        [['', 'None'], ...followTargets.map(node => [node.id, node.name] as [string, string])],
        value => set({ follow: value || null }))] : []),
      numberField('Squash', view.squash, .2, 1, .01, value => set({ squash: value })),
      numberField('Zoom', view.scale, .1, 10, .05, value => set({ scale: value })),
      numberField('Heading', view.yaw, -360, 360, 1, value => set({ yaw: value })),
    ];
  }

  element('newGroup').addEventListener('click', () => {
    const id = crypto.randomUUID();
    send([{ action: 'node.add', id, name: 'Group', parentId: state?.view.selected ?? null },
      { action: 'view.set', patch: { selected: id } }]);
  });
  element('frameScene').addEventListener('click', () => send([{ action: 'view.frame' }]));
  element('stepTime').addEventListener('click', () => send([{ action: 'play.step', seconds: 1 }]));
  element('resetTime').addEventListener('click', () => send([{ action: 'play.reset' }]));
  element('togglePlay').addEventListener('click', () => {
    send([{ action: state?.play.startedAt === null ? 'play.start' : 'play.pause' }]);
  });
  if (playground) {
    element('playControls').hidden = false;
    const keys: Record<string, Vec3> = { KeyA: [-.25, 0, 0], KeyD: [.25, 0, 0], KeyW: [0, 0, -.25], KeyS: [0, 0, .25] };
    const move = (key: string) => {
      const id = state?.view.selected;
      if (id && keys[key]) send([{ action: 'play.nudge', id, translation: keys[key] }]);
    };
    for (const [key, label] of [['KeyA', 'Left'], ['KeyW', 'Forward'], ['KeyS', 'Back'], ['KeyD', 'Right']]) {
      element('moveButtons').append(control(label, () => move(key)));
    }
    const takesKeyboardInput = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input:not([type="checkbox"]),select,textarea,[contenteditable]');
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || takesKeyboardInput(event.target)) return;
      if (event.code === 'Space' && event.target instanceof HTMLInputElement && event.target.type === 'checkbox') return;
      if (stage.scripts?.hasScripts()) {
        if (state?.play.startedAt == null) return;
        if (Object.hasOwn(keys, event.code) || event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
        stage.scripts.keyDown(event.code);
        return;
      }
      if (event.repeat || !Object.hasOwn(keys, event.code)) return;
      event.preventDefault();
      move(event.code);
    });
    document.addEventListener('keyup', event => stage.scripts?.keyUp(event.code));
    document.addEventListener('focusin', event => {
      if (takesKeyboardInput(event.target)) stage.scripts?.clearKeys();
    });
    window.addEventListener('blur', () => stage.scripts?.clearKeys());
    document.addEventListener('visibilitychange', () => stage.scripts?.clearKeys());
  }

  const fileInput = element<HTMLInputElement>('atlasFiles');
  element('importAtlases').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const chosen = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!chosen.length || !state) return;
    const parentId = state.view.selected;
    try {
      const layout = parseLayout(element<HTMLInputElement>('importLayout').value).join(',');
      const actions: ProjectAction[] = [];
      let selected: string | undefined;
      for (const file of chosen) {
        if (file.size > 16 * 1024 * 1024) throw new Error('Use PNGs of up to 16 MB per file.');
        const { png, hash } = await atlasBytes(file, layout);
        const id = crypto.randomUUID();
        const name = file.name.replace(/\.png$/i, '');
        actions.push({ action: 'atlas.embed', id: hash, name, png, layout },
          { action: 'node.add', id, name, parentId, atlasId: hash });
        selected = id;
      }
      actions.push({ action: 'view.set', patch: { selected } }, { action: 'view.frame' });
      send(actions);
    } catch (error) { status.value = (error as Error).message; }
  });
  void refresh();
  window.setInterval(() => { void refresh(); }, 650);
}

function scriptStatusId(node: string, script: string) {
  return 'script-status-' + node + ':' + script;
}

async function atlasBytes(file: File, layout: string) {
  const data = new Uint8Array(await file.arrayBuffer());
  const text = new TextEncoder().encode(layout);
  const bytes = new Uint8Array(text.length + data.length);
  bytes.set(text); bytes.set(data, text.length);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  let raw = '';
  for (let i = 0; i < data.length; i += 8192) raw += String.fromCharCode(...data.subarray(i, i + 8192));
  return { hash, png: btoa(raw) };
}

function control(label: string, run: () => void) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label; button.addEventListener('click', run);
  return button;
}
function heading(text: string) {
  const h = document.createElement('h3'); h.textContent = text; return h;
}
function muted(text: string) {
  const p = document.createElement('p'); p.className = 'muted'; p.textContent = text; return p;
}
function field(title: string, input: HTMLElement) {
  const host = document.createElement('div');
  host.className = 'field';
  const label = document.createElement('label');
  label.append(title);
  input.id ||= 'field-' + title.toLowerCase().replaceAll(/[^a-z0-9]/g, '-');
  if (input.tagName === 'DIV') label.id = input.id + '-label';
  else label.htmlFor = input.id;
  host.append(label, input);
  return host;
}
function line(title: string, value: string, change: (value: string) => void) {
  const input = document.createElement('input');
  input.type = 'text'; input.value = value;
  input.addEventListener('change', () => change(input.value));
  return field(title, input);
}
function numberField(title: string, value: number, min: number, max: number, step: number, change: (value: number) => void, id = '') {
  const input = document.createElement('input');
  input.type = 'number'; input.value = String(Number(value.toFixed(4))); input.min = String(min); input.max = String(max); input.step = String(step);
  input.id = id;
  input.addEventListener('change', () => {
    if (Number.isFinite(input.valueAsNumber)) change(input.valueAsNumber);
  });
  return field(title, input);
}
function check(title: string, value: boolean, change: (value: boolean) => void, id = '') {
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = value;
  input.id = id;
  input.addEventListener('change', () => change(input.checked));
  return field(title, input);
}
function selectField(title: string, value: string, choices: [string, string][], change: (value: string) => void) {
  const input = document.createElement('select');
  for (const [id, name] of choices) input.add(new Option(name, id, false, id === value));
  input.addEventListener('change', () => change(input.value));
  return field(title, input);
}
function transformSliders(title: string, nodeId: string, value: Vec3, position: boolean,
  preview: (axis: number, value: number) => () => void, change: (axis: number, value: number) => Promise<void>) {
  const group = document.createElement('div');
  group.className = 'transform-sliders';
  group.setAttribute('role', 'group');
  const host = field(title, group);
  group.setAttribute('aria-labelledby', group.id + '-label');
  const limit = position ? 10000 : 360;
  value.forEach((component, axis) => {
    const name = ['X', 'Y', 'Z'][axis];
    const row = document.createElement('div');
    const label = document.createElement('label');
    const slider = document.createElement('input');
    const number = document.createElement('input');
    const range = position ? Math.max(5, Math.ceil(Math.abs(component))) : limit;
    label.textContent = name;
    slider.type = 'range';
    slider.id = group.id + '-' + axis;
    label.htmlFor = slider.id;
    slider.dataset.transformNode = nodeId;
    slider.setAttribute('aria-label', title + ' ' + name + ' slider');
    slider.min = String(-range);
    slider.max = String(range);
    slider.step = position ? '0.01' : '1';
    slider.value = String(component);
    number.type = 'number';
    number.setAttribute('aria-label', title + ' ' + name);
    number.min = String(-limit);
    number.max = String(limit);
    number.step = 'any';
    number.value = String(component);
    let clearPreview: (() => void) | undefined;
    slider.addEventListener('input', () => {
      number.value = slider.value;
      clearPreview = preview(axis, slider.valueAsNumber);
    });
    slider.addEventListener('change', () => {
      const clear = clearPreview;
      clearPreview = undefined;
      void change(axis, slider.valueAsNumber).finally(clear);
    });
    slider.addEventListener('pointercancel', () => {
      clearPreview?.();
      clearPreview = undefined;
      slider.value = number.value = String(component);
    });
    number.addEventListener('change', () => {
      if (number.validity.valid && Number.isFinite(number.valueAsNumber)) void change(axis, number.valueAsNumber);
    });
    row.append(label, slider, number);
    group.append(row);
  });
  return host;
}
function vectorField(title: string, value: Vec3, change: (value: Vec3) => void) {
  const row = document.createElement('div');
  row.className = 'field-vector'; row.setAttribute('role', 'group');
  const fields = value.map((component, axis) => {
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any'; input.value = String(component);
    input.setAttribute('aria-label', title + ' ' + ['X', 'Y', 'Z'][axis]);
    input.addEventListener('change', () => {
      const values = fields.map(field => field.valueAsNumber) as Vec3;
      if (values.every(Number.isFinite)) change(values);
    });
    return input;
  });
  row.append(...fields);
  const host = field(title, row);
  row.setAttribute('aria-labelledby', row.id + '-label');
  return host;
}
