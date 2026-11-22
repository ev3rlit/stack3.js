import { inspectViews, parseLayout, prepareViews, reconstructPrepared, splitAtlas,
  type AssetData, type Direction, type Raster, type Settings, type ViewSet } from '@stack3/core';
import { decodePng } from './png';

export type AtlasSource = { atlas: Blob; layout: string; size?: Settings['size'] };
export type Source = AtlasSource | { files: Partial<Record<Direction, Blob>> } | { parts: AtlasSource[] };
export type Job = { id: number; sourceKey: string; source: Source; target: 'mesh' | 'stack'; settings: Settings; preview?: Settings; keepTop?: boolean };
type Success = { result: AssetData; inspection: ReturnType<typeof inspectViews>; elapsed: number; parts?: AssetData[]; top?: Raster };
export type Reply = { id: number } & ((Success & { preview: boolean }) | { error: string });

let decoded: { key: string; views: Promise<ViewSet[]> } | undefined;
let newest = 0;

async function decode(source: Exclude<Source, { parts: AtlasSource[] }>, threshold?: number) {
  if ('atlas' in source) return splitAtlas(await decodePng(source.atlas), parseLayout(source.layout), threshold);
  const entries = Object.entries(source.files) as [Direction, Blob][];
  parseLayout(entries.map(([direction]) => direction).join(','));
  return Object.fromEntries(await Promise.all(entries.map(async ([name, file]) => [name, await decodePng(file)])));
}

function treadTexture(source: Raster): Raster {
  const scale = Math.min(1, 256 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (Math.floor((y + .5) * source.height / height) * source.width + Math.floor((x + .5) * source.width / width)) * 4;
    data.set(source.data.subarray(p, p + 4), (y * width + x) * 4);
  }
  return { width, height, data };
}

self.onmessage = async ({ data }: MessageEvent<Job>) => {
  newest = data.id;
  const started = performance.now();
  try {
    const { id, sourceKey, source, target, settings, preview } = data;
    const key = JSON.stringify([sourceKey, settings.threshold]);
    if (decoded?.key !== key) {
      const inputs = 'parts' in source ? source.parts : [source];
      const views = Promise.all(inputs.map(async input => prepareViews(await decode(input, settings.threshold), settings.threshold)));
      decoded = { key, views };
    }
    const allViews = await decoded.views;
    if (id !== newest) return;
    const reports = allViews.map(inspectViews);
    const inspection = { views: reports[0].views, warnings: [...new Set(reports.flatMap(report => report.warnings))] };

    function send(buildSettings: Settings, isPreview: boolean) {
      const parts = 'parts' in source ? source.parts : undefined;
      const sizes = parts?.map(part => part.size);
      const maxHeight = Math.max(1, ...(sizes ?? []).map(size => size?.[2] ?? 1));
      const maxLength = Math.max(1, ...(sizes ?? []).map(size => size ? Math.max(size[0], size[1]) : 1));
      const built = allViews.map((views, index) => {
        const size = sizes?.[index];
        return reconstructPrepared(views, target, size ? {
          ...buildSettings, size, pivot: 'ground',
          layers: Math.max(8, Math.round((buildSettings.layers ?? 48) * size[2] / maxHeight)),
          resolution: Math.max(16, Math.round((buildSettings.resolution ?? 96) * Math.max(size[0], size[1]) / maxLength)),
        } : buildSettings);
      });
      const buffers = built.flatMap(item => (item.target === 'mesh'
        ? [item.texture.data, item.positions, item.normals, item.indices, item.uvs]
        : [item.texture.data]).map(array => array.buffer as ArrayBuffer));
      const top = data.keepTop && allViews[0].top ? treadTexture(allViews[0].top) : undefined;
      if (top) buffers.push(top.data.buffer as ArrayBuffer);
      const reply: Reply = { id, result: built[0], parts: parts ? built : undefined, top,
        inspection, preview: isPreview, elapsed: performance.now() - started };
      (self as unknown as { postMessage(message: Reply, transfers: Transferable[]): void }).postMessage(reply, buffers);
    }

    if (preview) {
      try { send(preview, true); } catch { /* Thin geometry may be absent in a low-resolution preview. */ }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (id === newest) send(settings, false);
  } catch (error) {
    if (data.id === newest) {
      decoded = undefined;
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies Reply);
    }
  }
};
