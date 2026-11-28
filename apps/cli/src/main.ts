import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readInput } from './atlas-input';
import { readStackMesh, partMethods, isCoreMeshMethod, isStackMeshMethod } from './part-mesh';
import { loadStack } from './stack-input';
import { buildFromPreparedViews } from './grid-build';
import { DEFAULT_LAYERS, encodeGlb, encodeStack, inspectViews, prepareViews, reconstructionDimensions, respaceStack,
  type Settings, type ViewSet } from '@stack3/core';
import { requireVerifiedViews } from './verification-gate';
import { buildCacheKey, readBuildCache, writeBuildCache, type BuildOutput } from './build-cache';

const HELP = `Usage: stack3 <verb> <input> [options]

  help [topic]           Show command help (pipeline, mesh, or capabilities)
  capabilities [--json]  List mesh methods, runtime requirements, schemas and example recipes
  example <name>         Copy future-tank or traffic-cone into the current directory
  verify -f <manifest>   Measure atlas views and mounts in one JSON report
  capture-dexel <stack> --source aligned.glb --output depth.npz
                        Capture ordered XYZ depth and normal intervals in the saved grid using Blender
  inspect <input>        Check mapped directions and fitted image sizes
  build <input>          Build an asset and save it to --output
  pipeline --help        Render or run YAML, or export its JSON Schema
  mesh <stack-directory> Extract a surface from saved stack.png + stack.json (--output mesh.glb)
                        --mesh-method marching-cubes (default), surface-nets, voxel
                        or ${partMethods.join(', ')}
                        --guide <part.json> uses pivot-relative stack XYZ scene units.
                        section-loft, smooth-loft, branch-loft, heightfield: optional axis (x/y/z, default z)
                        section-loft, smooth-loft: optional stations [{slice,outer?,holes?}]
                        revolve: axis + origin, optional segments (8-512, default 64)
                        path-sweep: path; optional up and profile {outer,holes?} (defaults to first stack section)
                        section-network: sections [{source:"independent",origin,u,v,outer,holes?}], optional tolerance
                        hermite-dc: optional field (.npy SDF) or dexel (.npz crossings and normals)
                        signed-distance-dc: optional field, outerIterations and innerIterations
                        organic: optional field or dexel, sigma, extractor, interpolation, smoothingIterations, targetEdgeLength, adaptive, reproject, dexelOccupancy, depthRegions
                        extended-mc, mc33, greedy, monotone: no guide
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
  --verification <file>  Require a matching atlas PASS report before building
  --no-cache             Bypass the local build cache
  --resolution <integer|native>  Longer horizontal axis samples (default 96)
  --height <number>      Asset height in scene units (default 1)
  --pivot ground|center  Origin position (default ground)
  --threshold <0–255>    Background threshold for opaque PNGs (default 238)
`;

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
  const args = process.argv.slice(2);
  if (args[0] === 'help') {
    if (args.length === 1) { console.log(HELP); return; }
    if (args.length !== 2 || !['pipeline', 'mesh', 'capabilities', 'capture-dexel'].includes(args[1])) {
      throw new Error('Use stack3 help [pipeline|mesh|capabilities].');
    }
    args.splice(0, 2, args[1], '--help');
  }
  if (args[0] === 'capabilities') {
    const { capabilitiesCommand } = await import('./capabilities');
    capabilitiesCommand(args.slice(1));
    return;
  }
  if (args[0] === 'pipeline') {
    const { pipelineCommand } = await import('./pipeline');
    await pipelineCommand(args.slice(1));
    return;
  }
  if (args[0] === 'capture-dexel') {
    const { positionals, values } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      source: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    const usage = 'stack3 capture-dexel <stack> --source aligned.glb --output depth.npz';
    if (values.help) { console.log(usage); return; }
    if (positionals.length !== 1 || !values.source || !values.output ||
        extname(values.source).toLowerCase() !== '.glb' || extname(values.output).toLowerCase() !== '.npz') throw new Error(usage);
    const { captureDexel } = await import('./blender');
    await captureDexel(resolve(positionals[0]), resolve(values.source), resolve(values.output));
    return;
  }
  if (args[0] === 'verify') {
    const { verifyCommand } = await import('./verify-command');
    await verifyCommand(args.slice(1));
    return;
  }
  if (args[0] === 'project') {
    const { projectCommand } = await import('./project-command');
    await projectCommand(args.slice(1));
    return;
  }
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, layout: { type: 'string' },
      format: { type: 'string' }, target: { type: 'string' }, verification: { type: 'string' },
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
  if (values.verification !== undefined && verb !== 'build') throw new Error('--verification requires stack3 build.');
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
    if (!isStackMeshMethod(method)) {
      throw new Error(`Stack mesh methods: marching-cubes, surface-nets, voxel, ${partMethods.join(', ')}.`);
    }
    if (isCoreMeshMethod(method) && values.guide !== undefined) throw new Error(`${input}: ${method} does not accept --guide.`);
    const { stack } = await loadStack(resolve(input));
    let bytes: Uint8Array;
    try {
      bytes = encodeGlb(await readStackMesh(stack, method, values.guide));
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
  const sourceHashes = values.verification === undefined ? undefined : new Map<string, string>();
  const views = prepareViews(await readInput(input, values.layout, threshold, sourceHashes), threshold);
  if (values.verification !== undefined && sourceHashes) {
    await requireVerifiedViews(values.verification, views, sourceHashes);
  }
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
