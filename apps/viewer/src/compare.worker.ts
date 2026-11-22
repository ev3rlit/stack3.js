import { compareAtlasPipeline, decodeDepthPng, inspectViews, reconstructMappedAtlas, parseLayout, prepareViews, splitAtlas,
  type AtlasCalibration, type ComparisonMesh, type Settings } from '@stack3/core';
import type { MatrixMount, PartLayout } from './assembly';
import { decodePng } from './png';

type MapInputs = { clay: Blob; depth: Blob; baseColor: Blob; normal: Blob; calibration: AtlasCalibration };
type AtlasInput = { file: Blob; layout: string; settings: Settings; maps?: MapInputs };
export type ComparisonLayout = Omit<PartLayout, 'mounts'> & { mounts: MatrixMount[] };
type PlacedAtlasInput = AtlasInput & ComparisonLayout;
export type ComparisonJob = AtlasInput | { parts: PlacedAtlasInput[] };
type MappedResult = ReturnType<typeof reconstructMappedAtlas>;
export type PartComparison = ReturnType<typeof compareAtlasPipeline> & ComparisonLayout & { mapped?: MappedResult };
export type ComparisonData = { parts: PartComparison[]; warnings: string[] };
export type ComparisonReply = ComparisonData | { error: string };

function transferBuffers(mesh: ComparisonMesh): ArrayBuffer[] {
  return [mesh.positions, mesh.normals, mesh.indices, mesh.uvs, mesh.texture.data]
    .map(array => array.buffer as ArrayBuffer);
}

self.onmessage = async ({ data }: MessageEvent<ComparisonJob>) => {
  try {
    const atOrigin = (input: AtlasInput): PlacedAtlasInput => ({
      ...input, name: '', mounts: [{ name: '', position: [0, 0, 0] }],
    });
    const inputs = 'parts' in data ? data.parts : [atOrigin(data)];
    const warnings: string[] = [];
    async function reconstructPart({ file, layout, settings, name, mounts, maps }: PlacedAtlasInput): Promise<PartComparison> {
      const views = splitAtlas(await decodePng(file), parseLayout(layout), settings.threshold);
      const result = compareAtlasPipeline(views, settings);
      const report = inspectViews(prepareViews(views, settings.threshold));
      warnings.push(...report.warnings.map(warning => name ? name + ' · ' + warning : warning));
      let mapped: MappedResult | undefined;
      if (maps) {
        const [clay, rawDepth, baseColor, normal] = await Promise.all([
          decodePng(maps.clay), maps.depth.arrayBuffer(), decodePng(maps.baseColor), decodePng(maps.normal, true),
        ]);
        mapped = reconstructMappedAtlas({
          calibration: maps.calibration, clay, depth: decodeDepthPng(new Uint8Array(rawDepth)), baseColor, normal,
        }, settings);
      }
      return { ...result, name, mounts, mapped };
    }
    const parts: PartComparison[] = [];
    for (const input of inputs) parts.push(await reconstructPart(input));
    const assets: ComparisonMesh[] = parts.flatMap(part => [part.voxel, part.marching, ...part.meshes]);
    const buffers = assets.flatMap(mesh => mesh.frontAccents
      ? [...transferBuffers(mesh), ...transferBuffers(mesh.frontAccents)] : transferBuffers(mesh));
    for (const part of parts) {
      buffers.push(part.stack.texture.data.buffer as ArrayBuffer);
      if (part.mapped) buffers.push(...transferBuffers(part.mapped.mesh),
        ...transferBuffers(part.mapped.silhouetteMesh), part.mapped.normalMap.data.buffer as ArrayBuffer);
    }
    (self as unknown as { postMessage(message: ComparisonReply, transfers: Transferable[]): void })
      .postMessage({ parts, warnings }, buffers);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies ComparisonReply);
  }
};
