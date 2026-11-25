import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export async function openBlenderStack(directory: string, output: string | undefined, open: boolean) {
  const macApp = '/Applications/Blender.app/Contents/MacOS/Blender';
  const blender = process.env.BLENDER_BIN || (process.platform === 'darwin' && existsSync(macApp) ? macApp : 'blender');
  const script = fileURLToPath(new URL('../blender/import_stack.py', import.meta.url));
  const destination = output && resolve(output);
  if (destination && extname(destination).toLowerCase() !== '.blend') throw new Error('Use a .blend output file.');
  if (destination && existsSync(destination)) throw new Error('Output already exists: ' + destination);
  if (destination) await mkdir(dirname(destination), { recursive: true });
  const scratch = await mkdtemp(join(destination ? dirname(destination) : tmpdir(), 'stack3-blender-'));
  const generated = join(scratch, (basename(directory) || 'stack') + '.blend');
  const scene = destination || generated;
  let keepPreview = false;
  try {
    await promisify(execFile)(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', directory, generated]);
    if (destination) await link(generated, destination);
    console.log('Blender scene ' + scene);
    if (open) {
      const child = spawn(blender, [scene], { detached: true, stdio: 'ignore' });
      await new Promise<void>((ok, fail) => { child.once('error', fail); child.once('spawn', ok); });
      child.unref();
    }
    keepPreview = !destination;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (error as NodeJS.ErrnoException).path === blender) {
      throw new Error('Blender was not found. Set BLENDER_BIN to its executable, or use stack3 view --web.');
    }
    throw error;
  } finally {
    if (!keepPreview) await rm(scratch, { recursive: true, force: true });
  }
}
