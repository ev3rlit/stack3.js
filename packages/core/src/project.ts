import { DEFAULT_LAYERS } from './sampling';
import { parseLayout, readPngSize } from './views';
import { scriptFields, validateScript, type SceneScript } from './scripts';

export type Vec3 = [number, number, number];
export type NodeSettings = {
  textureProjection?: 'auto' | 'top-contour';
  meshMethod?: 'marching-cubes' | 'contour'; contourHub?: boolean;
  format: 'stack' | 'glb'; layers: number; resolution: number; spacing: number; height: number;
  threshold: number; pivot: 'ground' | 'center'; profile: 'silhouette' | 'round' | 'round-base';
  pixelArt: boolean; smoothEdges: boolean; lighting: boolean;
};
export type SceneNode = {
  id: string; name: string; parentId: string | null; atlasId: string | null;
  visible: boolean; position: Vec3; rotation: Vec3; scale: Vec3;
  velocity: Vec3; angularVelocity: Vec3; settings: NodeSettings;
  scripts?: SceneScript[];
};
export type EmbeddedAtlas = { id: string; name: string; layout: string; png: string };
export type SceneView = {
  backend: 'cpu' | 'gpu'; grid: boolean; supersampling: boolean;
  detailNormals?: boolean; subpixelAA?: boolean; specularAA?: boolean;
  squash: number; scale: number; yaw: number; selected: string | null; frame: number; follow?: string | null;
};
export type SceneProject = {
  version: 1; revision: number; name: string; atlases: EmbeddedAtlas[]; nodes: SceneNode[];
  view: SceneView; play: { time: number; startedAt: number | null; offsets?: PlayOffset[]; resetCount?: number };
};
type PlayOffset = { id: string; translation: Vec3; rotation: Vec3 };
export type ProjectSummary = Omit<SceneProject, 'atlases'> & { atlases: (Omit<EmbeddedAtlas, 'png'> & { fingerprint?: string })[] };

export const nodeDefaults: NodeSettings = {
  format: 'stack', layers: DEFAULT_LAYERS, resolution: 96, spacing: 1, height: 1, threshold: 238,
  pivot: 'ground', profile: 'silhouette', pixelArt: false, smoothEdges: true, lighting: false,
};

type Field = { type: 'string' | 'boolean' | 'number' | 'integer' | 'array' | 'object' | 'list'; enum?: readonly string[];
  minimum?: number; maximum?: number; nullable?: boolean; fields?: Record<string, Field> };
const number = (minimum: number, maximum: number, type: 'number' | 'integer' = 'number'): Field =>
  ({ type, minimum, maximum });
const choice = (...values: string[]): Field => ({ type: 'string', enum: values });
const string: Field = { type: 'string' };
const boolean: Field = { type: 'boolean' };
const idOrNull: Field = { type: 'string', nullable: true };
const vector = (...limits: [number, number]): Field => ({ ...number(...limits), type: 'array' });
const settingsFields = {
  textureProjection: choice('auto', 'top-contour'),
  meshMethod: choice('marching-cubes', 'contour'), contourHub: boolean,
  format: choice('stack', 'glb'), layers: number(8, Number.MAX_SAFE_INTEGER, 'integer'), resolution: number(16, Number.MAX_SAFE_INTEGER, 'integer'),
  spacing: number(.05, 20), height: number(.01, 100), threshold: number(0, 255, 'integer'),
  pivot: choice('ground', 'center'), profile: choice('silhouette', 'round', 'round-base'),
  pixelArt: boolean, smoothEdges: boolean, lighting: boolean,
};
const nodeFields = {
  name: string, visible: boolean, position: vector(-10000, 10000), rotation: vector(-360, 360),
  scale: vector(.01, 100), velocity: vector(-100, 100), angularVelocity: vector(-720, 720),
  settings: { type: 'object', fields: settingsFields } satisfies Field,
};
const viewFields = {
  backend: choice('cpu', 'gpu'), grid: boolean, supersampling: boolean, squash: number(.2, 1),
  detailNormals: boolean, subpixelAA: boolean, specularAA: boolean,
  scale: number(.1, 10), yaw: number(-360, 360), selected: idOrNull, follow: idOrNull,
};
export const projectActions = {
  'atlas.embed': { description: 'Embed a four- or six-view PNG in the project asset library.', required: ['id', 'name', 'layout', 'png'],
    fields: { id: string, name: string, layout: string, png: string } },
  'atlas.remove': { description: 'Remove an unreferenced atlas from the library.', required: ['id'], fields: { id: string } },
  'node.add': { description: 'Create a group or an instance of an embedded atlas, with an optional parent.', required: ['id', 'name'],
    fields: { id: string, name: string, parentId: idOrNull, atlasId: idOrNull, position: nodeFields.position, settings: nodeFields.settings } },
  'node.set': { description: 'Change a node’s display, transform, animation, or reconstruction settings.', required: ['id', 'patch'],
    fields: { id: string, patch: { type: 'object', fields: nodeFields } } },
  'node.move': { description: 'Set a node’s parent. Null moves it to the root.', required: ['id', 'parentId'], fields: { id: string, parentId: idOrNull } },
  'node.remove': { description: 'Remove a node and its descendants. Embedded atlas data remains in the library.', required: ['id'], fields: { id: string } },
  'script.set': { description: 'Attach or update an isolated JavaScript component on a node. A new component requires name and source.',
    required: ['nodeId', 'id', 'patch'], fields: { nodeId: string, id: string, patch: { type: 'object', fields: {
      name: string, source: string, enabled: boolean, fields: { type: 'list', maximum: 24, fields: scriptFields },
    } } } },
  'script.remove': { description: 'Detach a component from its node.', required: ['nodeId', 'id'], fields: { nodeId: string, id: string } },
  'view.set': { description: 'Change view options or select an object.', required: ['patch'], fields: { patch: { type: 'object', fields: viewFields } } },
  'view.frame': { description: 'Frame the visible scene in the viewport.', required: [], fields: {} },
  'play.start': { description: 'Start or resume time-based motion.', required: [], fields: {} },
  'play.pause': { description: 'Pause while retaining the current simulation time.', required: [], fields: {} },
  'play.reset': { description: 'Pause and reset simulation time to zero.', required: [], fields: {} },
  'play.step': { description: 'Pause and advance by a fixed number of seconds.', required: ['seconds'], fields: { seconds: number(0, 3600) } },
  'play.nudge': { description: 'Move or rotate a node in the Playground without changing its authored transform.',
    required: ['id'], fields: { id: string, translation: vector(-100, 100), rotation: vector(-360, 360) } },
} satisfies Record<string, { description: string; required: string[]; fields: Record<string, Field> }>;

export type ProjectAction = { action: keyof typeof projectActions; [key: string]: unknown };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

function validateFields(value: Record<string, unknown>, fields: Record<string, Field>) {
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(fields, key)) throw new Error('Unknown field: ' + key);
    const rule = fields[key];
    if (rule.nullable && item === null) continue;
    if (rule.type === 'object') { validateFields(object(item), rule.fields!); continue; }
    if (rule.type === 'list') {
      if (!Array.isArray(item) || item.length > rule.maximum!) throw new Error('Invalid list for ' + key);
      for (const entry of item) {
        const record = object(entry);
        if (Object.keys(rule.fields!).some(field => !Object.hasOwn(record, field))) throw new Error('Incomplete script field.');
        validateFields(record, rule.fields!);
      }
      continue;
    }
    if (rule.type === 'array') {
      if (!Array.isArray(item) || item.length !== 3 || item.some(n => !Number.isFinite(n) || n < rule.minimum! || n > rule.maximum!)) {
        throw new Error(key + ' needs three numbers in range.');
      }
    } else if (rule.type === 'number' || rule.type === 'integer') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < rule.minimum! || item > rule.maximum! ||
        (rule.type === 'integer' && !Number.isInteger(item))) throw new Error(key + ' is out of range.');
    } else if (typeof item !== rule.type || (rule.enum && !rule.enum.includes(item as string))) {
      throw new Error('Invalid value for ' + key);
    }
  }
}

function identifier(id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)) throw new Error('Invalid ID.');
  return id;
}

function nameOf(name: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('Name must contain 1–200 characters.');
  return name.trim();
}

export function newProject(name: string): SceneProject {
  return { version: 1, revision: 0, name: nameOf(name), atlases: [], nodes: [],
    view: { backend: 'gpu', grid: true, supersampling: false, squash: .65, scale: 1, yaw: 45, selected: null, frame: 0 },
    play: { time: 0, startedAt: null } };
}

export function summarizeProject(project: SceneProject): ProjectSummary {
  return { ...project, atlases: project.atlases.map(({ id, name, layout }) => ({ id, name, layout })) };
}

export function playTime(play: SceneProject['play'], now = Date.now()) {
  return play.time + (play.startedAt === null ? 0 : Math.max(0, (now - play.startedAt) / 1000));
}

function assertAtlas(png: string, layout: string) {
  parseLayout(layout);
  if (png.length > 22_000_000 || png.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(png)) throw new Error('Expected an embedded PNG of 16 MB or less.');
  readPngSize(Uint8Array.from(atob(png.slice(0, 44)), char => char.charCodeAt(0)));
}

export function applyProjectActions(project: SceneProject, input: unknown, now = Date.now()): SceneProject {
  if (!Array.isArray(input) || !input.length || input.length > 500) throw new Error('Provide a batch of 1–500 project actions.');
  // Copy scene state for transactional batches while sharing immutable atlas strings.
  const next = { ...project, nodes: structuredClone(project.nodes), atlases: [...project.atlases],
    view: { ...project.view }, play: structuredClone(project.play) };
  const node = (id: unknown) => {
    const found = next.nodes.find(item => item.id === identifier(id));
    if (!found) throw new Error('Unknown node: ' + id);
    return found;
  };
  const atlas = (id: unknown) => {
    const found = next.atlases.find(item => item.id === identifier(id));
    if (!found) throw new Error('Unknown atlas: ' + id);
    return found;
  };

  for (const item of input) {
    const { action, ...params } = object(item);
    if (typeof action !== 'string' || !Object.hasOwn(projectActions, action)) throw new Error('Unknown action: ' + action);
    const spec = projectActions[action as keyof typeof projectActions];
    for (const field of spec.required) if (!Object.hasOwn(params, field)) throw new Error('Missing field: ' + field);
    validateFields(params, spec.fields);
    switch (action) {
      case 'atlas.embed': {
        const id = identifier(params.id), name = nameOf(params.name), layout = params.layout as string, png = params.png as string;
        assertAtlas(png, layout);
        const existing = next.atlases.find(item => item.id === id);
        if (existing && (existing.png !== png || existing.layout !== layout)) throw new Error('Atlas ID already exists: ' + id);
        if (!existing) next.atlases.push({ id, name, layout, png });
        break;
      }
      case 'atlas.remove': {
        const source = atlas(params.id);
        if (next.nodes.some(item => item.atlasId === source.id)) throw new Error('Atlas is still in use.');
        next.atlases = next.atlases.filter(item => item !== source);
        break;
      }
      case 'node.add': {
        const id = identifier(params.id);
        if (next.nodes.some(item => item.id === id)) throw new Error('Node ID already exists: ' + id);
        const parentId = params.parentId ? node(params.parentId).id : null;
        const atlasId = params.atlasId ? atlas(params.atlasId).id : null;
        const siblings = next.nodes.filter(item => item.parentId === parentId && item.atlasId);
        next.nodes.push({ id, name: nameOf(params.name), parentId, atlasId, visible: true,
          position: params.position as Vec3 ?? [atlasId ? siblings.length * 1.5 : 0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
          velocity: [0, 0, 0], angularVelocity: [0, 0, 0], settings: { ...nodeDefaults, ...params.settings as Partial<NodeSettings> } });
        break;
      }
      case 'node.set': {
        const current = node(params.id);
        const { settings, ...patch } = params.patch as Partial<SceneNode>;
        if (patch.name !== undefined) patch.name = nameOf(patch.name);
        Object.assign(current, patch);
        if (settings) Object.assign(current.settings, settings);
        break;
      }
      case 'node.move': {
        const current = node(params.id);
        const parent = params.parentId === null ? null : node(params.parentId);
        for (let ancestor = parent; ancestor; ancestor = ancestor.parentId === null ? null : node(ancestor.parentId)) {
          if (ancestor.id === current.id) throw new Error('A node cannot be its own ancestor.');
        }
        current.parentId = parent?.id ?? null;
        break;
      }
      case 'node.remove': {
        const removed = new Set([node(params.id).id]);
        do {
          const before = removed.size;
          for (const item of next.nodes) if (item.parentId && removed.has(item.parentId)) removed.add(item.id);
          if (removed.size === before) break;
        } while (true);
        next.nodes = next.nodes.filter(item => !removed.has(item.id));
        next.play.offsets = next.play.offsets?.filter(item => !removed.has(item.id));
        if (next.view.selected && removed.has(next.view.selected)) next.view.selected = null;
        if (next.view.follow && removed.has(next.view.follow)) next.view.follow = null;
        break;
      }
      case 'script.set': {
        const owner = node(params.nodeId);
        const id = identifier(params.id);
        const scripts = owner.scripts ??= [];
        const index = scripts.findIndex(script => script.id === id);
        const previous = index >= 0 ? scripts[index] : { id, name: '', source: '', enabled: true, fields: [] };
        const script: SceneScript = { ...previous, ...params.patch as Partial<SceneScript> };
        script.name = nameOf(script.name);
        validateScript(script);
        if (index >= 0) scripts[index] = script;
        else {
          if (next.nodes.reduce((count, item) => count + (item.scripts?.length ?? 0), 0) >= 16) {
            throw new Error('A scene supports up to 16 script components.');
          }
          scripts.push(script);
        }
        break;
      }
      case 'script.remove': {
        const owner = node(params.nodeId);
        const id = identifier(params.id);
        if (!owner.scripts?.some(script => script.id === id)) throw new Error('Unknown script: ' + id);
        owner.scripts = owner.scripts.filter(script => script.id !== id);
        break;
      }
      case 'view.set': {
        const patch = params.patch as Partial<SceneView>;
        if (patch.selected !== undefined && patch.selected !== null) node(patch.selected);
        if (patch.follow) node(patch.follow);
        Object.assign(next.view, patch);
        break;
      }
      case 'view.frame': next.view.frame++; break;
      case 'play.start': next.play.startedAt ??= now; break;
      case 'play.pause': next.play = { ...next.play, time: playTime(next.play, now), startedAt: null }; break;
      case 'play.reset': next.play = { time: 0, startedAt: null, resetCount: (next.play.resetCount ?? 0) + 1 }; break;
      case 'play.step': next.play = { ...next.play, time: playTime(next.play, now) + (params.seconds as number), startedAt: null }; break;
      case 'play.nudge': {
        const id = node(params.id).id;
        if (!params.translation && !params.rotation) throw new Error('Provide translation or rotation.');
        const offsets = next.play.offsets ??= [];
        let offset = offsets.find(item => item.id === id);
        if (!offset) { offset = { id, translation: [0, 0, 0], rotation: [0, 0, 0] }; offsets.push(offset); }
        for (const field of ['translation', 'rotation'] as const) {
          const delta = params[field] as Vec3 | undefined;
          if (delta) for (let axis = 0; axis < 3; axis++) offset[field][axis] += delta[axis];
        }
        break;
      }
    }
  }
  next.revision++;
  return next;
}
