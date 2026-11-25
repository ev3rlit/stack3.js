import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { partMesh, partMethods } from './part-mesh';
import { loadStack } from './stack-input';
import { buildFromPreparedViews, checkGridMemory } from './grid-build';
import { DEFAULT_LAYERS, DIRECTIONS, encodeGlb, encodeStack, meshFromStack, inspectViews, parseLayout, prepareViews, reconstructionDimensions, readPngSize, respaceStack,
  splitAtlas, type Direction, type Raster, type Settings, type ViewSet } from '@stack3/core';
import { buildCacheKey, readBuildCache, writeBuildCache, type BuildOutput } from './build-cache';

const HELP = `Usage: stack3 <verb> <input> [options]

  example <name>         Copy future-tank or traffic-cone into the current directory
  inspect <input>        Check mapped directions and fitted image sizes
  build <input>          Build an asset and save it to --output
  mesh <stack-directory> Extract a surface from saved stack.png + stack.json (--output mesh.glb)
                        --mesh-method marching-cubes (default), surface-nets, voxel
                        or ${partMethods.join(', ')}
                        --guide <part.json> uses pivot-relative stack XYZ scene units.
                        section-loft, smooth-loft, branch-loft, heightfield: optional axis (x/y/z, default z)
                        section-loft, smooth-loft: optional stations [{slice,outer?,holes?}]
                        revolve: axis + origin, optional segments (8-512, default 64)
                        path-sweep: path; optional up and profile {outer,holes?} (defaults to first stack section)
                        section-network: sections [{source:"independent",origin,u,v,outer,holes?}], optional tolerance
                        extended-mc, hermite-dc, mc33, greedy, monotone: no guide
                        New methods use uv or STACK3_PYTHON. See the stack3 skill for guide examples.
  view <directory>       Open a stack bundle in Blender (use --web for the browser viewer)
                        --output scene.blend saves a named scene; add --no-open for headless export
                        --no-open alone prints the web preview URL
  project --help        Edit a level and control its live viewer and playground

Inputs
  PNG atlas              Supply --layout top,left,front,rear (add right,bottom for six views)
  JSON manifest          Map directions to separate PNG paths under "views"

Build options
  --format glb|stack     Write a GLB file or a directory with stack.png and stack.json
                        Can be omitted when --output ends in .glb
  --output <path>        Required output path
  --texture-projection <name>  auto (default) or top-contour for GLB output
  --mesh-method <name>   marching-cubes (default) or contour for GLB output
  --contour-hub          Add a centered round axle measured from TOP and LEFT
  --layers <integer|native>  Vertical samples (default ${DEFAULT_LAYERS})
  --spacing <number>     Sprite stack spacing multiplier (default 1)
  --profile <name>       silhouette, round, or round-base
  --no-cache             Bypass the local build cache
  --resolution <integer|native>  Longer horizontal axis samples (default 96)
  --height <number>      Asset height in scene units (default 1)
  --pivot ground|center  Origin position (default ground)
  --threshold <0–255>    Background threshold for opaque PNGs (default 238)
`;

async function png(path: string): Promise<Raster> {
  const bytes = await readFile(path);
  readPngSize(bytes);
  const image = PNG.sync.read(bytes);
  return { width: image.width, height: image.height, data: image.data };
}

async function readInput(path: string, layout: string | undefined, threshold: number): Promise<ViewSet> {
  if (extname(path).toLowerCase() === '.png') {
    if (!layout) throw new Error('A PNG atlas needs an explicit --layout.');
    return splitAtlas(await png(path), parseLayout(layout), threshold);
  }
  if (extname(path).toLowerCase() !== '.json') throw new Error('Choose a PNG atlas or a JSON view manifest.');
  if (layout) throw new Error('View manifests define their directions in the views field.');
  const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
  const views = manifest && typeof manifest === 'object' && 'views' in manifest ? manifest.views : null;
  if (!views || typeof views !== 'object' || Array.isArray(views)) throw new Error('The manifest needs a views object.');
  const entries = Object.entries(views);
  parseLayout(entries.map(([name]) => name).join(','));
  return Object.fromEntries(await Promise.all(entries.map(async ([name, file]) => {
    if (!DIRECTIONS.includes(name as Direction) || typeof file !== 'string' || !file) throw new Error(`Invalid view entry: ${name}`);
    return [name, await png(resolve(dirname(path), file))];
  })));
}

function outputFormat(output: string, format?: string, target?: string): 'glb' | 'stack' {
  if (format !== undefined && format !== 'glb' && format !== 'stack') {
    throw new Error('Use --format glb or --format stack.');
  }
  if (target !== undefined && target !== 'mesh' && target !== 'stack') {
    throw new Error('Use --format glb or --format stack.');
  }
  const legacyFormat = target === 'mesh' ? 'glb' : target;
  if (format && legacyFormat && format !== legacyFormat) throw new Error('--format and --target disagree.');
  const isGlbPath = extname(output).toLowerCase() === '.glb';
  const selected = format ?? legacyFormat ?? (isGlbPath ? 'glb' : undefined);
  if (!selected) throw new Error('Use --format stack for a stack directory or specify a .glb output file.');
  if (selected === 'glb' && !isGlbPath) throw new Error('GLB output must have the .glb extension.');
  return selected;
}

async function copyExample(name: string, output?: string) {
  const examples = new Map([
    ['future-tank', ['future-tank.stack3.json', 'samples/future-tank/future-tank.stack3.json']],
    ['traffic-cone', ['traffic-cone-4view.png', 'samples/props/traffic-cone-4view.png']],
  ]);
  const example = examples.get(name);
  if (!example) throw new Error('Choose future-tank or traffic-cone.');
  const [filename, workspacePath] = example;
  const packaged = new URL('../examples/' + filename, import.meta.url);
  const source = existsSync(packaged) ? packaged : new URL('../../../' + workspacePath, import.meta.url);
  const destination = resolve(output ?? filename);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  console.log(destination);
}

async function main() {
  if (process.argv[2] === 'project') {
    const { projectCommand } = await import('./project-command');
    await projectCommand(process.argv.slice(3));
    return;
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, layout: { type: 'string' },
      format: { type: 'string' }, target: { type: 'string' },
      output: { type: 'string', short: 'o' }, layers: { type: 'string' }, resolution: { type: 'string' },
      height: { type: 'string' }, pivot: { type: 'string' }, threshold: { type: 'string' },
      'texture-projection': { type: 'string' },
      'mesh-method': { type: 'string' }, guide: { type: 'string' }, 'contour-hub': { type: 'boolean' },
      spacing: { type: 'string' }, profile: { type: 'string' }, 'no-cache': { type: 'boolean' }, 'no-open': { type: 'boolean' }, web: { type: 'boolean' },
    },
  });
  if (values.version) {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(manifest.version);
    return;
  }
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  const [verb, input] = positionals;
  if (values.guide !== undefined && verb !== 'mesh') throw new Error('--guide requires stack3 mesh.');
  if (verb === 'example' && positionals.length === 2) {
    await copyExample(input, values.output);
    return;
  }
  if (positionals.length !== 2 || (verb !== 'inspect' && verb !== 'build' && verb !== 'mesh' && verb !== 'view')) {
    throw new Error('See stack3 --help for available commands and arguments.');
  }
  if (verb === 'mesh') {
    if (!values.output || extname(values.output).toLowerCase() !== '.glb' || Object.keys(values).some(k => k !== 'output' && k !== 'mesh-method' && k !== 'guide')) {
      throw new Error('Use stack3 mesh <stack-directory> --output <file.glb>. Geometry settings come from the saved stack.');
    }
    const method = values['mesh-method'] ?? 'marching-cubes';
    const legacy = method === 'marching-cubes' || method === 'surface-nets' || method === 'voxel';
    if (!legacy && !partMethods.some(name => name === method)) {
      throw new Error(`Stack mesh methods: marching-cubes, surface-nets, voxel, ${partMethods.join(', ')}.`);
    }
    if (legacy && values.guide !== undefined) throw new Error(`${input}: ${method} does not accept --guide.`);
    const { stack } = await loadStack(resolve(input));
    checkGridMemory(stack.width, stack.depth, stack.layers, 'mesh');
    let bytes: Uint8Array;
    try {
      bytes = encodeGlb(legacy ? meshFromStack(stack, method) : await partMesh(stack, method, values.guide));
    } catch (error) {
      throw new Error(`${input} (${method}): ${(error as Error).message}`);
    }
    const output = resolve(values.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    console.log(`Meshed ${stack.layers} saved layers with ${method} into ${output}`);
    return;
  }
  if (verb === 'view') {
    const { viewStack } = await import('./view');
    await viewStack(resolve(input), !values['no-open'], values.web ?? false, values.output);
    return;
  }
  const threshold = values.threshold === undefined ? 238 : Number(values.threshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error('Threshold must be an integer from 0 to 255.');
  if (verb === 'inspect') {
    const views = await readInput(input, values.layout, threshold);
    console.log(JSON.stringify(inspectViews(prepareViews(views, threshold)), null, 2));
    return;
  }
  if (!values.output) throw new Error('Build requires --output <path>.');
  const output = resolve(values.output);
  const format = outputFormat(output, values.format, values.target);
  const spacing = values.spacing === undefined ? 1 : Number(values.spacing);
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Spacing must be a positive, finite multiplier.');
  if (values.spacing !== undefined && format !== 'stack') throw new Error('--spacing is available with --format stack.');
  const profile = values.profile;
  if (profile !== undefined && profile !== 'silhouette' && profile !== 'round' && profile !== 'round-base') {
    throw new Error('Use --profile silhouette, round, or round-base.');
  }
  if (values.pivot !== undefined && values.pivot !== 'ground' && values.pivot !== 'center') throw new Error('Pivot must be ground or center.');
  const textureProjection = values['texture-projection'];
  if (textureProjection !== undefined && textureProjection !== 'auto' && textureProjection !== 'top-contour')
    throw new Error('Use --texture-projection auto or top-contour.');
  if (textureProjection !== undefined && format !== 'glb') throw new Error('--texture-projection requires GLB output.');
  const meshMethod = values['mesh-method'];
  if (meshMethod !== undefined && meshMethod !== 'marching-cubes' && meshMethod !== 'contour')
    throw new Error('Use --mesh-method marching-cubes or contour.');
  if ((meshMethod || values['contour-hub']) && format !== 'glb') throw new Error('Mesh methods require GLB output.');
  if (values['contour-hub'] && meshMethod !== 'contour') throw new Error('--contour-hub requires --mesh-method contour.');
  if (meshMethod === 'contour' && profile && profile !== 'silhouette') throw new Error('Contour extrusion uses the FRONT silhouette.');
  const views = prepareViews(await readInput(input, values.layout, threshold), threshold);
  const { nativeSamples } = inspectViews(views);
  const settings: Settings = {
    textureProjection, meshMethod, contourHub: values['contour-hub'],
    layers: values.layers === 'native' ? Math.max(8, nativeSamples.z) : Number(values.layers ?? DEFAULT_LAYERS),
    resolution: values.resolution === 'native' || values.resolution === undefined ? undefined : Number(values.resolution),
    height: values.height === undefined ? undefined : Number(values.height),
    pivot: values.pivot, threshold, profile,
  };
  if (values.resolution === 'native') {
    const { size: [width, depth] } = reconstructionDimensions(views, settings);
    const samples = width === depth ? Math.max(nativeSamples.x, nativeSamples.y)
      : width > depth ? nativeSamples.x : nativeSamples.y;
    settings.resolution = Math.max(16, samples);
  }
  const key = values['no-cache'] ? undefined : buildCacheKey(views, format, settings, spacing);
  const cached = key ? await readBuildCache(key, format) : undefined;
  const artifact = cached ?? buildOutput(views, format, settings, spacing);
  if (artifact.format === 'glb') {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, artifact.bytes);
  } else {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'stack.png'), artifact.png);
    await writeFile(join(output, 'stack.json'), artifact.manifest);
  }
  if (key && !cached) await writeBuildCache(key, artifact);
  console.log(`Built ${format} at ${output}${cached ? ' · disk cache' : ''}`);
}

function buildOutput(views: ViewSet, format: BuildOutput['format'], settings: Settings, spacing: number): BuildOutput {
  const asset = buildFromPreparedViews(views, format === 'glb' ? 'mesh' : 'stack', settings);
  if (asset.target === 'mesh') return { format: 'glb', bytes: encodeGlb(asset) };
  const bundle = encodeStack(respaceStack(asset, spacing));
  return { format: 'stack', png: bundle.png, manifest: JSON.stringify(bundle.manifest, null, 2) + '\n' };
}

main().catch(error => {
  console.error('stack3: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
