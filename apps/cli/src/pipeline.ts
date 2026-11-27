import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeGlb, parseLayout, prepareViews, type GlbOptions, type MeshData, type Settings, type StackData } from '@stack3/core';
import { parse, stringify } from 'yaml';
import { readInput } from './atlas-input';
import { readSurfaceCache, writeBuildCache } from './build-cache';
import { printPipelineSchema } from './capabilities';
import { buildFromPreparedViews } from './grid-build';
import { isCoreMeshMethod, isStackMeshMethod, readStackMesh, type MeshMethod, type SurfaceFinish } from './part-mesh';
import { loadStack } from './stack-input';

type Mapping = Record<string, unknown>;
type AtlasSettings = Pick<Settings, 'layers' | 'resolution' | 'height' | 'pivot' | 'threshold' | 'profile'>;
type Node = { id: string } & (
  | { type: 'load-stack'; path: string }
  | ({ type: 'reconstruct-stack'; path: string; layout?: string } & AtlasSettings)
  | { type: 'extract-mesh'; input: string; method: MeshMethod; guide?: string; finish?: SurfaceFinish; cache?: boolean }
  | ({ type: 'write-glb'; input: string; path: string } & GlbOptions)
);

const help = `Usage: stack3 pipeline <render|run> <pipeline.yaml> [-f <values.yaml> ...]
       stack3 pipeline schema [recipe|fragment]
  render   Resolve includes and values, then print the validated pipeline YAML.
  run      Execute the same resolved pipeline and write its GLB outputs.
  schema   Print a standalone JSON Schema. The default is recipe.
  -f, --values   Override defaults in order. The last file takes precedence.

Nodes: load-stack, reconstruct-stack, extract-mesh, write-glb.
Run stack3 capabilities --json for backends, guide fields and sample paths.`;

function isMapping(value: unknown): value is Mapping {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mapping(value: unknown, name: string, fields?: readonly string[]): Mapping {
  if (!isMapping(value)) throw new Error(`${name} must be a mapping.`);
  const invalid = fields && Object.keys(value).find(key => !fields.includes(key));
  if (invalid) throw new Error(`${name} has unknown field ${invalid}.`);
  return value;
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string.`);
  return value;
}

async function readYaml(path: string): Promise<unknown> {
  try {
    return parse(await readFile(path, 'utf8'), { maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}

function mergeValues(base: Mapping, overrides: Mapping): Mapping {
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.hasOwn(base, key) && isMapping(base[key]) && isMapping(value)) {
      Object.defineProperty(merged, key, { value: mergeValues(base[key], value) });
    }
  }
  return merged;
}

function renderValue(value: unknown, values: Mapping, name: string): unknown {
  if (Array.isArray(value)) return value.map((entry, i) => renderValue(entry, values, `${name}[${i}]`));
  if (isMapping(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, renderValue(entry, values, `${name}.${key}`)]));
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  const reference = /\{\{\s*\.Values\.([\w-]+(?:\.[\w-]+)*)\s*\}\}/g;
  const get = (path: string) => {
    let current: unknown = values;
    for (const key of path.split('.')) {
      if (!isMapping(current) || !Object.hasOwn(current, key)) throw new Error(`${name}: missing .Values.${path}.`);
      current = current[key];
    }
    if (!['number', 'string', 'boolean'].includes(typeof current)) throw new Error(`${name}: .Values.${path} must be a scalar.`);
    return current;
  };
  const match = [...value.matchAll(reference)];
  if (value.replace(reference, '').includes('{{')) throw new Error(`${name}: use {{ .Values.name }} references.`);
  if (match.length === 1 && value.trim() === match[0][0]) return get(match[0][1]);
  return value.replace(reference, (_full, path: string) => String(get(path)));
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error(`${name} must be a boolean.`);
}

function parseFinish(value: unknown, id: string): SurfaceFinish | undefined {
  if (value === undefined) return;
  const limits = { fitTolerance: [0, Infinity], bevelWidth: [0, Infinity], bevelSegments: [0, 16],
    dissolveAngle: [0, 45], triangleBudget: [3, Infinity], aoRadius: [0, Infinity] } as const;
  const config = mapping(value, `${id}.finish`, [...Object.keys(limits), 'primitives']);
  const output: SurfaceFinish = {};
  for (const [key, [min, max]] of Object.entries(limits) as [keyof typeof limits, readonly [number, number]][]) {
    const number = config[key];
    if (number === undefined) continue;
    const integer = key === 'bevelSegments' || key === 'triangleBudget';
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= min || number > max || integer && !Number.isSafeInteger(number)) {
      throw new Error(`${id}.finish.${key} must be ${integer ? 'an integer' : 'a number'} greater than ${min}${max !== Infinity ? ` and at most ${max}` : ''}.`);
    }
    output[key] = number;
  }
  const primitives = optionalBoolean(config.primitives, `${id}.finish.primitives`);
  if (primitives !== undefined) output.primitives = primitives;
  if (primitives && !output.fitTolerance) throw new Error(`${id}.finish.primitives requires fitTolerance.`);
  if (output.bevelSegments && !output.bevelWidth) throw new Error(`${id}.finish.bevelSegments requires bevelWidth.`);
  return Object.keys(output).length ? output : undefined;
}

function parseInstances(value: unknown, id: string): GlbOptions['instances'] {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length || value.some(row => !Array.isArray(row) || row.length !== 3 ||
      row.some(number => typeof number !== 'number' || !Number.isFinite(Math.fround(number))))) {
    throw new Error(`${id}.instances must be a nonempty list of finite XYZ translations.`);
  }
  return value;
}

function parseAtlasSettings(node: Mapping): AtlasSettings {
  const settings: AtlasSettings = {};
  for (const [key, min, max] of [['layers', 8, Infinity], ['resolution', 16, Infinity], ['threshold', 0, 255]] as const) {
    const value = node[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer ${max === Infinity ? `≥ ${min}` : `from ${min} to ${max}`}.`);
    }
    settings[key] = value;
  }
  const { height, pivot, profile } = node;
  if (height !== undefined) {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) throw new Error('height must be positive.');
    settings.height = height;
  }
  if (pivot !== undefined) {
    if (pivot !== 'ground' && pivot !== 'center') throw new Error('pivot must be ground or center.');
    settings.pivot = pivot;
  }
  if (profile !== undefined) {
    if (profile !== 'silhouette' && profile !== 'round' && profile !== 'round-base') throw new Error('Unknown reconstruction profile.');
    settings.profile = profile;
  }
  return settings;
}

function parseNode(raw: unknown, values: Mapping, root: string, name: string): Node {
  const node = Object.fromEntries(Object.entries(mapping(raw, name)).map(([key, value]) =>
    [key, renderValue(value, values, `${name}.${key}`)]));
  const id = requiredText(node.id, `${name}.id`);
  if (!/^[\w-]+$/.test(id)) throw new Error(`${name}.id must use letters, digits, underscores, or hyphens.`);
  const fields = (...keys: string[]) => mapping(node, id, ['id', 'type', ...keys]);
  const path = (key: string) => resolve(root, requiredText(node[key], `${id}.${key}`));
  const input = () => requiredText(node.input, `${id}.input`);
  switch (node.type) {
    case 'load-stack':
      fields('path');
      return { id, type: node.type, path: path('path') };
    case 'reconstruct-stack': {
      fields('path', 'layout', 'layers', 'resolution', 'height', 'pivot', 'threshold', 'profile');
      const source = path('path');
      const extension = extname(source).toLowerCase();
      const settings = parseAtlasSettings(node);
      if (extension === '.json' && node.layout === undefined) return { id, type: node.type, path: source, ...settings };
      if (extension !== '.png') throw new Error(`${id}: use a PNG atlas with layout or a JSON view manifest.`);
      const layout = parseLayout(requiredText(node.layout, `${id}.layout`)).join(',');
      return { id, type: node.type, path: source, layout, ...settings };
    }
    case 'extract-mesh': {
      fields('input', 'method', 'guide', 'finish', 'cache');
      const method = requiredText(node.method, `${id}.method`);
      if (!isStackMeshMethod(method)) throw new Error(`${id}: unknown mesh method ${method}.`);
      const finish = parseFinish(node.finish, id);
      if (isCoreMeshMethod(method) && (node.guide !== undefined || finish)) throw new Error(`${id}: ${method} does not accept ${finish ? 'finishing options' : 'a guide'}.`);
      const guide = node.guide === undefined ? undefined : path('guide');
      const cache = optionalBoolean(node.cache, `${id}.cache`);
      return { id, type: node.type, input: input(), method, ...(guide && { guide }), ...(finish && { finish }), ...(cache !== undefined && { cache }) };
    }
    case 'write-glb': {
      fields('input', 'path', 'lit', 'instances');
      const output = path('path');
      if (extname(output).toLowerCase() !== '.glb') throw new Error(`${id}: output must have the .glb extension.`);
      const lit = optionalBoolean(node.lit, `${id}.lit`);
      const instances = parseInstances(node.instances, id);
      return { id, type: node.type, input: input(), path: output, ...(lit !== undefined && { lit }), ...(instances && { instances }) };
    }
    default:
      throw new Error(`${id}: unknown node type ${String(node.type)}.`);
  }
}

function orderNodes(nodes: Node[]) {
  const byId = new Map<string, Node>();
  const outputs = new Set<string>();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate node ID ${node.id}.`);
    byId.set(node.id, node);
    if (node.type === 'write-glb') {
      if (outputs.has(node.path)) throw new Error(`Duplicate output path ${node.path}.`);
      outputs.add(node.path);
    }
  }
  if (!outputs.size) throw new Error('The pipeline needs at least one write-glb node.');
  const ordered: Node[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(node: Node) {
    if (visiting.has(node.id)) throw new Error(`Dependency cycle: ${[...visiting, node.id].join(' → ')}.`);
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    if ('input' in node) {
      const source = byId.get(node.input);
      if (!source) throw new Error(`${node.id}: unknown input ${node.input}.`);
      visit(source);
      const accepted = node.type === 'write-glb' ? source.type === 'extract-mesh'
        : source.type === 'load-stack' || source.type === 'reconstruct-stack';
      if (!accepted) throw new Error(`${node.id}: unsupported input type ${source.type} from ${source.id}.`);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    ordered.push(node);
  }
  nodes.forEach(visit);
  return ordered;
}

async function renderPipeline(path: string, overridePaths: string[]) {
  let values: Mapping = {};
  const rawNodes: { raw: unknown; name: string }[] = [];
  const loaded = new Set<string>();
  const loading = new Set<string>();
  async function load(file: string, root: boolean) {
    const canonical = await realpath(file);
    if (loading.has(canonical)) throw new Error(`Include cycle at ${file}.`);
    if (loaded.has(canonical)) return;
    loading.add(canonical);
    const doc = mapping(await readYaml(file), file, ['version', 'includes', 'values', 'nodes']);
    if ((root || doc.version !== undefined) && doc.version !== 1) throw new Error(`${file}: expected version 1.`);
    for (const key of ['includes', 'nodes'] as const) {
      if (doc[key] !== undefined && !Array.isArray(doc[key])) throw new Error(`${file}.${key} must be a list.`);
    }
    if (Array.isArray(doc.includes)) {
      for (const include of doc.includes) {
        await load(resolve(dirname(file), requiredText(include, `${file}.includes item`)), false);
      }
    }
    if (doc.values !== undefined) values = mergeValues(values, mapping(doc.values, `${file}.values`));
    if (Array.isArray(doc.nodes)) doc.nodes.forEach((raw, index) => rawNodes.push({ raw, name: `${file}.nodes[${index}]` }));
    loading.delete(canonical);
    loaded.add(canonical);
  }
  await load(path, true);
  for (const overridePath of overridePaths) values = mergeValues(values, mapping(await readYaml(overridePath), overridePath));
  const nodes = orderNodes(rawNodes.map(({ raw, name }) => parseNode(raw, values, dirname(path), name)));
  return { version: 1, nodes };
}

async function surfaceCacheKey(node: Extract<Node, { type: 'extract-mesh' }>, stack: StackData) {
  const { texture, ...bounds } = stack;
  const hash = createHash('sha256');
  hash.update(JSON.stringify(['surface-v4', node.method, node.finish, bounds, texture.width, texture.height,
    process.env.STACK3_PYTHON, process.env.BLENDER_BIN]));
  hash.update(texture.data);
  if (node.guide) {
    const guide = await readFile(node.guide);
    hash.update(guide);
    if (node.method === 'signed-distance-dc' || node.method === 'hermite-dc') {
      const { field, dexel } = JSON.parse(guide.toString('utf8'));
      for (const source of [field, dexel]) {
        if (typeof source === 'string') hash.update(await readFile(resolve(dirname(node.guide), source)));
      }
    }
  }
  return hash.digest('hex');
}

async function extract(node: Extract<Node, { type: 'extract-mesh' }>, stack: StackData) {
  const key = node.cache ? await surfaceCacheKey(node, stack) : undefined;
  const cached = key ? await readSurfaceCache(key) : undefined;
  if (cached) {
    console.error(`${node.id}: geometry cache hit`);
    return cached;
  }
  const mesh = await readStackMesh(stack, node.method, node.guide, node.finish);
  if (key && key === await surfaceCacheKey(node, stack)) await writeBuildCache(key, { format: 'surface', mesh });
  return mesh;
}

async function runPipeline(nodes: Node[]) {
  const assets = new Map<string, StackData | MeshData>();
  const remaining = new Map<string, number>();
  for (const node of nodes) if ('input' in node) remaining.set(node.input, (remaining.get(node.input) ?? 0) + 1);
  for (const node of nodes) {
    try {
      if (node.type === 'load-stack') {
        assets.set(node.id, (await loadStack(node.path)).stack);
      } else if (node.type === 'reconstruct-stack') {
        const { id, type, path, layout, ...settings } = node;
        const threshold = settings.threshold ?? 238;
        const views = prepareViews(await readInput(path, layout, threshold), threshold);
        assets.set(node.id, buildFromPreparedViews(views, 'stack', settings));
      } else {
        const source = assets.get(node.input);
        if (node.type === 'extract-mesh' && source?.target === 'stack') {
          assets.set(node.id, await extract(node, source));
        } else if (node.type === 'write-glb' && source?.target === 'mesh') {
          await mkdir(dirname(node.path), { recursive: true });
          await writeFile(node.path, encodeGlb(source, node));
          console.log(`${node.id}: ${node.path}`);
        } else {
          throw new Error(`Missing resolved input ${node.input}.`);
        }
        const count = (remaining.get(node.input) ?? 1) - 1;
        remaining.set(node.input, count);
        if (!count) assets.delete(node.input);
      }
      if (!remaining.has(node.id)) assets.delete(node.id);
    } catch (error) {
      throw new Error(`${node.id} (${node.type}): ${(error as Error).message}`);
    }
  }
}

export async function pipelineCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    values: { type: 'string', short: 'f', multiple: true },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !args.length) { console.log(help); return; }
  const [verb, file] = positionals;
  if (verb === 'schema') {
    if (positionals.length > 2 || values.values) throw new Error('Use stack3 pipeline schema [recipe|fragment].');
    await printPipelineSchema(file ?? 'recipe');
    return;
  }
  if ((verb !== 'render' && verb !== 'run') || positionals.length !== 2) throw new Error(help);
  const pipeline = await renderPipeline(resolve(file), values.values ?? []);
  if (verb === 'render') process.stdout.write(stringify(pipeline));
  else await runPipeline(pipeline.nodes);
}
