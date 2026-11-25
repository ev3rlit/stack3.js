import { totalmem } from 'node:os';
import { inspectViews, reconstructPrepared, reconstructionDimensions, type Settings, type ViewSet } from '@stack3/core';

export function buildFromPreparedViews(views: ViewSet, target: 'stack' | 'mesh', settings: Settings) {
  if (target === 'stack' || settings.meshMethod !== 'contour') {
    const { width, depth, layers } = reconstructionDimensions(views, settings);
    const { nativeSamples } = inspectViews(views);
    if (width > nativeSamples.x || depth > nativeSamples.y || layers > nativeSamples.z) {
      console.error(`Sampling ${width} × ${depth} × ${layers} from up to ${nativeSamples.x} × ${nativeSamples.y} × ${nativeSamples.z} source pixels along X, Y, Z. Oversampled axes reuse input pixels.`);
    }
    checkGridMemory(width, depth, layers, target);
  }
  return reconstructPrepared(views, target, settings);
}

export function checkGridMemory(width: number, depth: number, layers: number, target: 'stack' | 'mesh') {
  // Lower bound only: occupancy plus RGBA slices, or the padded MC field and edge cache.
  const cells = width * depth * layers;
  const bytes = target === 'stack' ? cells * 5 : cells + (width + 2) * (depth + 2) * (layers + 2) * 17;
  const budget = Math.min(totalmem(), process.constrainedMemory() || Infinity);
  if (bytes > budget) {
    throw new Error(`Grid ${width} × ${depth} × ${layers} needs at least ${Math.ceil(bytes / 2 ** 20)} MiB, exceeding the system memory budget. Reduce layers or resolution.`);
  }
}
