import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { builtinComponents, encodeGlb, encodeStack, fourWheelPreset, parseLayout, projectActions, reconstruct, respaceStack, splitAtlas, summarizeProject, trackedTankPreset,
  type ProjectAction } from '@stack3/core';
import { editProject, initProject, readProject } from './project-store';

const help = `Usage: stack3 project <verb> [project-file] [options]

  schema                                  List agent actions and field constraints as JSON
  components [component-id]               List built-in script components or inspect one
  init <file> [--name <name>]              Create a level project
  get <file>                              Read JSON hierarchy, settings, and current view state
  import <file> <atlas.png>...             Embed PNGs and add a scene object for each
      [--layout top,left,front,rear]       Direction order shared by inputs in this command
      [--parent <node-id>]                 Place the new objects under an existing node
  apply <file> <actions.json|->           Apply an atomic JSON action batch or read it from stdin
      [--revision <number>]                Require this revision before applying changes
  preset <file> four-wheel <root-id>       Attach WASD Vehicle and four Sprite Stack Wheel components
      [--wheels <fl,fr,rl,rr>]              Specify wheel IDs in front-left, front-right, rear-left, rear-right order
      [--revision <number>]                Require this revision before applying changes
  preset <file> tracked-tank <root-id>     Attach Tracked Drive, Turret Control, and both Track Belt components
  open <file> [--no-open] [--playground]   Open the live editor or interactive play view
  export <file> <node-id> --output <path>  Export one object's asset with its reconstruction settings
      [--format stack|glb]                 Overrides the object's output format
`;

async function stdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

export async function projectCommand(args: string[]) {
  const { positionals: [verb, file, ...inputs], values } = parseArgs({
    args, allowPositionals: true, options: {
      help: { type: 'boolean', short: 'h' }, name: { type: 'string' }, layout: { type: 'string' },
      parent: { type: 'string' }, revision: { type: 'string' }, output: { type: 'string', short: 'o' },
      format: { type: 'string' }, 'no-open': { type: 'boolean' }, playground: { type: 'boolean' },
      wheels: { type: 'string' },
    },
  });
  if (!verb || values.help) { console.log(help); return; }
  if (verb === 'schema') { print(projectActions); return; }
  if (verb === 'components') {
    if (inputs.length) throw new Error('components expects at most one component ID.');
    if (!file) {
      print(Object.entries(builtinComponents).map(([id, { description, script }]) => ({ id, name: script.name, description })));
      return;
    }
    if (!Object.hasOwn(builtinComponents, file)) throw new Error('Unknown built-in component: ' + file);
    const { description, script } = builtinComponents[file as keyof typeof builtinComponents];
    print({ id: file, description, ...script });
    return;
  }
  if (!file) throw new Error('Provide a project file.');
  const path = resolve(file);
  switch (verb) {
    case 'init': {
      if (inputs.length) throw new Error('init expects only a project file.');
      print(summarizeProject(await initProject(path, values.name || basename(path, extname(path)))));
      return;
    }
    case 'get': print(summarizeProject(await readProject(path))); return;
    case 'open': {
      const { openProject } = await import('./project-server');
      await openProject(path, !values['no-open'], !!values.playground);
      return;
    }
    case 'apply': {
      if (inputs.length !== 1) throw new Error('Provide a JSON action file or - for standard input.');
      const revision = values.revision === undefined ? undefined : Number(values.revision);
      if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) throw new Error('Invalid project revision.');
      print(summarizeProject(await editProject(path, JSON.parse(inputs[0] === '-' ? await stdin() : await readFile(inputs[0], 'utf8')), revision)));
      return;
    }
    case 'preset': {
      const [kind, rootId] = inputs;
      if (inputs.length !== 2 || (kind !== 'four-wheel' && kind !== 'tracked-tank')) {
        throw new Error('Use stack3 project preset <file> <four-wheel|tracked-tank> <root-id>.');
      }
      if (kind === 'tracked-tank' && values.wheels !== undefined) throw new Error('--wheels applies to the four-wheel preset.');
      const project = await readProject(path);
      const revision = values.revision === undefined ? project.revision : Number(values.revision);
      if (!Number.isInteger(revision) || revision < 0) throw new Error('Invalid project revision.');
      if (revision !== project.revision) throw new Error('Project revision changed.');
      const { actions, ...preset } = kind === 'four-wheel'
        ? fourWheelPreset(project, rootId, values.wheels) : trackedTankPreset(project, rootId);
      const next = actions.length ? await editProject(path, actions, revision) : project;
      print({ preset: kind, revision: next.revision, changed: actions.length > 0, ...preset });
      return;
    }
    case 'import': {
      if (!inputs.length || inputs.length > 128) throw new Error('Provide 1–128 PNG atlas paths.');
      const layout = parseLayout(values.layout ?? 'top,left,front,rear').join(',');
      const actions: ProjectAction[] = [];
      const nodes: string[] = [];
      for (const image of inputs) {
        const bytes = await readFile(image);
        const name = basename(image, extname(image));
        const atlasId = createHash('sha256').update(layout).update(bytes).digest('hex');
        const id = randomUUID();
        nodes.push(id);
        actions.push({ action: 'atlas.embed', id: atlasId, name, layout, png: bytes.toString('base64') },
          { action: 'node.add', id, name, atlasId, parentId: values.parent ?? null });
      }
      actions.push({ action: 'view.set', patch: { selected: nodes.at(-1) } }, { action: 'view.frame' });
      const project = await editProject(path, actions);
      print({ revision: project.revision, nodes: project.nodes.filter(node => nodes.includes(node.id)) });
      return;
    }
    case 'export': {
      if (inputs.length !== 1 || !values.output) throw new Error('Provide a node ID and --output.');
      const project = await readProject(path);
      const node = project.nodes.find(item => item.id === inputs[0]);
      const atlas = project.atlases.find(item => item.id === node?.atlasId);
      if (!node || !atlas) throw new Error('Export requires an atlas-backed node.');
      const format = values.format ?? (extname(values.output).toLowerCase() === '.glb' ? 'glb' : node.settings.format);
      if (format !== 'glb' && format !== 'stack') throw new Error('Use --format glb or --format stack.');
      const output = resolve(values.output);
      if (format === 'glb' && extname(output).toLowerCase() !== '.glb') throw new Error('GLB output must end in .glb.');
      const image = PNG.sync.read(Buffer.from(atlas.png, 'base64'));
      const settings = node.settings;
      const asset = reconstruct(splitAtlas(image, parseLayout(atlas.layout), settings.threshold), format === 'glb' ? 'mesh' : 'stack', settings);
      if (asset.target === 'mesh') {
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, encodeGlb(asset));
      } else {
        const bundle = encodeStack(respaceStack(asset, settings.spacing));
        await mkdir(output, { recursive: true });
        await writeFile(join(output, 'stack.png'), bundle.png);
        await writeFile(join(output, 'stack.json'), JSON.stringify(bundle.manifest, null, 2) + '\n');
      }
      print({ node: node.id, format, output });
      return;
    }
    default: throw new Error('Unknown project command: ' + verb);
  }
}
