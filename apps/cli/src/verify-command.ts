import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const help = `stack3 verify -f <manifest.yaml> [--output-dir <dir>]
  Print one JSON measurement report to stdout.
  Atlas: projections and landmarks. Assembly: whole and part atlases plus mount measurements.
  --output-dir <dir>  Also save report.json and annotated PNG overlays
  -f, --file          Image and child manifest paths are relative to their YAML file.`;

export async function verifyCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    file: { type: 'string', short: 'f' }, output: { type: 'string', short: 'o' },
    check: { type: 'string' }, part: { type: 'string' }, 'output-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !args.length) { console.log(help); return; }
  const [kind] = positionals;
  if (positionals.length > 1 || (kind !== undefined && !['atlas', 'assembly'].includes(kind)) || !values.file ||
      (values.output !== undefined && values.output !== 'json') ||
      (values.check !== undefined && (kind !== 'atlas' || !['projections', 'landmarks'].includes(values.check))) ||
      (values.part !== undefined && (kind !== 'assembly' || !values.part))) throw new Error(help);
  const script = fileURLToPath(new URL('../verification/verify.py', import.meta.url));
  const python = process.env.STACK3_PYTHON;
  const params = [...(python ? [] : ['run', '--no-project', '--script']), script, values.file];
  if (kind) params.push('--kind', kind);
  for (const key of ['check', 'part', 'output-dir'] as const) {
    if (values[key] !== undefined) params.push('--' + key, values[key]);
  }
  await new Promise<void>((done, reject) => {
    const child = spawn(python || 'uv', params, { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    child.once('error', error => reject(new Error(`Cannot start verifier: ${error.message}. Install uv or set STACK3_PYTHON.`)));
    child.once('close', code => code === 0 ? done() : reject(new Error('Verification could not complete.')));
  });
}
