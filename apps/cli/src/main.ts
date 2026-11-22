import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { DIRECTIONS, encodeGlb, encodeStack, inspectViews, parseLayout, prepareViews, readPngSize, reconstruct, respaceStack,
  splitAtlas, type Direction, type Raster, type Settings, type ViewSet } from '@stack3/core';
import { buildCacheKey, readBuildCache, writeBuildCache, type BuildOutput } from './build-cache';

const HELP = `Usage: stack3 <verb> <input> [options]

  inspect <input>        Check mapped directions and fitted image sizes
  build <input>          Build an asset and save it to --output
  view <directory>       Open a stack bundle in the local viewer (--no-open to print the URL only)
  project --help        Edit a level and control its live viewer and playground

Inputs
  PNG atlas              Supply --layout top,left,front,rear (add right,bottom for six views)
  JSON manifest          Map directions to separate PNG paths under "views"

Build options
  --format glb|stack     Write a GLB file or a directory with stack.png and stack.json
                        Can be omitted when --output ends in .glb
  --output <path>        Required output path
  --layers <integer>     Vertical samples (default 48)
  --spacing <number>     Sprite stack spacing multiplier (default 1)
  --profile <name>       silhouette, round, or round-base
  --no-cache             Bypass the local build cache
  --resolution <integer> Maximum horizontal axis samples (default 96)
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

async function main() {
  if (process.argv[2] === 'project') {
    const { projectCommand } = await import('./project-command');
    await projectCommand(process.argv.slice(3));
    return;
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, layout: { type: 'string' },
      format: { type: 'string' }, target: { type: 'string' },
      output: { type: 'string', short: 'o' }, layers: { type: 'string' }, resolution: { type: 'string' },
      height: { type: 'string' }, pivot: { type: 'string' }, threshold: { type: 'string' },
      spacing: { type: 'string' }, profile: { type: 'string' }, 'no-cache': { type: 'boolean' }, 'no-open': { type: 'boolean' },
    },
  });
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  const [verb, input] = positionals;
  if (positionals.length !== 2 || (verb !== 'inspect' && verb !== 'build' && verb !== 'view')) {
    throw new Error('Use stack3 inspect <input>, stack3 build <input>, or stack3 view <directory>.');
  }
  if (verb === 'view') {
    const { viewStack } = await import('./view');
    await viewStack(resolve(input), !values['no-open']);
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
  const settings: Settings = {
    layers: values.layers === undefined ? undefined : Number(values.layers),
    resolution: values.resolution === undefined ? undefined : Number(values.resolution),
    height: values.height === undefined ? undefined : Number(values.height),
    pivot: values.pivot, threshold, profile,
  };
  const views = await readInput(input, values.layout, threshold);
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
  const asset = reconstruct(views, format === 'glb' ? 'mesh' : 'stack', settings);
  if (asset.target === 'mesh') return { format: 'glb', bytes: encodeGlb(asset) };
  const bundle = encodeStack(respaceStack(asset, spacing));
  return { format: 'stack', png: bundle.png, manifest: JSON.stringify(bundle.manifest, null, 2) + '\n' };
}

main().catch(error => {
  console.error('stack3: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
