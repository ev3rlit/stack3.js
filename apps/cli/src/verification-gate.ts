import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Raster, ViewSet } from '@stack3/core';

const requiredChecks = ['dimensions', 'cameras', 'projections', 'landmarks'];

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function viewFingerprint(view: Raster) {
  const data = new Uint8Array(view.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) data.fill(0, i, i + 4);
  }
  return createHash('sha256').update(view.width + 'x' + view.height + ':').update(data).digest('hex');
}

export async function requireVerifiedViews(reportPath: string, views: ViewSet, sourceHashes: Map<string, string>) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const acceptance = report?.acceptance;
  if (report?.kind !== 'atlas' || acceptance?.version !== 1 || acceptance.verdict !== 'PASS' ||
      !requiredChecks.every(name => acceptance.checks?.[name]?.verdict === 'PASS')) {
    throw new Error('Build requires a PASS report from a full stack3 verify run.');
  }
  const viewEntries = Object.entries(views);
  if (Object.keys(acceptance.inputs ?? {}).length !== viewEntries.length) {
    throw new Error('Verification does not match the current set of atlas views. Verify the build inputs again.');
  }
  const guide = acceptance.checks.cameras;
  const overlay = guide.overlay === 'atlas-guides.png'
    ? await readFile(join(dirname(reportPath), guide.overlay)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    })
    : undefined;
  if (!overlay || guide.overlaySha256 !== sha256(overlay)) {
    throw new Error('Verification guide is missing or stale. Regenerate the report with --output-dir.');
  }
  for (const [name, view] of viewEntries) {
    const input = acceptance.inputs?.[name];
    if (input?.sourceSha256 !== sourceHashes.get(name) || input?.viewSha256 !== viewFingerprint(view)) {
      throw new Error('Verification does not match the current ' + name.toUpperCase() + ' input and mask. Verify the build inputs again.');
    }
  }
}
