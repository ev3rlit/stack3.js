import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { applyProjectActions, newProject, type SceneProject } from '@stack3/core';

export async function readProject(file: string): Promise<SceneProject> {
  const data = JSON.parse(await readFile(file, 'utf8')) as SceneProject;
  if (data.version !== 1 || !Number.isInteger(data.revision) || !Array.isArray(data.nodes) || !Array.isArray(data.atlases) ||
    !data.view || !data.play) throw new Error('Expected a version 1 stack3 scene project.');
  return data;
}

export async function initProject(file: string, name: string) {
  await mkdir(dirname(file), { recursive: true });
  const project = newProject(name);
  await writeFile(file, JSON.stringify(project) + '\n', { flag: 'wx', mode: 0o600 });
  return project;
}

export class RevisionConflict extends Error {}

export async function editProject(file: string, actions: unknown, expected?: number) {
  const lock = file + '.lock';
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error('The project is locked by another editor: ' + lock);
      await setTimeout(35);
    }
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const project = await readProject(file);
    if (expected !== undefined && project.revision !== expected) throw new RevisionConflict('Project revision changed.');
    const next = applyProjectActions(project, actions);
    await writeFile(temporary, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
    return next;
  } finally {
    await handle.close();
    await unlink(lock);
    await unlink(temporary).catch(() => {});
  }
}

export function projectReader(file: string) {
  let previous: { signature: string; value: SceneProject } | undefined;
  return async () => {
    const stats = await stat(file, { bigint: true });
    const signature = [stats.ino, stats.mtimeNs, stats.size].join(':');
    if (previous?.signature !== signature) previous = { signature, value: await readProject(file) };
    return previous.value;
  };
}
