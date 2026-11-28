import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isCoreMeshMethod, partMethods, type MeshMethod } from './part-mesh';

const schemaFiles = {
  recipe: new URL('../schema/pipeline.schema.json', import.meta.url),
  fragment: new URL('../schema/pipeline-fragment.schema.json', import.meta.url),
};
export async function printPipelineSchema(kind: string) {
  if (kind !== 'recipe' && kind !== 'fragment') throw new Error('Use stack3 pipeline schema [recipe|fragment].');
  const recipe = await readFile(schemaFiles.recipe, 'utf8');
  if (kind === 'recipe') {
    process.stdout.write(recipe);
    return;
  }
  // Make the fragment schema portable when stdout is redirected to any directory.
  const fragment = JSON.parse(await readFile(schemaFiles.fragment, 'utf8'));
  const definitions = JSON.parse(recipe).$defs;
  process.stdout.write(JSON.stringify({ ...fragment, $ref: '#/$defs/manifest', $defs: definitions }, null, 2) + '\n');
}

const meshInfo: Record<MeshMethod, { description: string; guideFields: string[] }> = {
  'marching-cubes': { description: 'Default interpolated surface from saved occupancy.', guideFields: [] },
  'surface-nets': { description: 'Averaged dual mesh for fast previews.', guideFields: [] },
  voxel: { description: 'Exposed voxel faces.', guideFields: [] },
  'section-loft': { description: 'Connect sections with linear interpolation.', guideFields: ['axis', 'stations'] },
  heightfield: { description: 'Build top and bottom surfaces along one axis.', guideFields: ['axis'] },
  'smooth-loft': { description: 'Connect sections with smooth interpolation.', guideFields: ['axis', 'stations'] },
  revolve: { description: 'Revolve a sampled meridian.', guideFields: ['axis', 'origin', 'segments'] },
  'extended-mc': { description: 'Marching Cubes with QEF feature vertices.', guideFields: [] },
  'hermite-dc': { description: 'Dual Contouring with QEF from estimated or supplied Hermite data.', guideFields: ['field', 'dexel'] },
  mc33: { description: 'Topology-aware Marching Cubes for ambiguous configurations.', guideFields: [] },
  'branch-loft': { description: 'Connect sections through branch and merge events.', guideFields: ['axis'] },
  'path-sweep': { description: 'Sweep a section along a specified path.', guideFields: ['path', 'up', 'profile'] },
  'section-network': { description: 'Reconstruct using independently measured sections.', guideFields: ['sections', 'tolerance'] },
  greedy: { description: 'Merge adjoining voxel faces into rectangles.', guideFields: [] },
  monotone: { description: 'Triangulate merged voxel surface regions.', guideFields: [] },
  organic: { description: 'Smooth a physical distance field, contour it and optionally smooth or adaptively remesh the surface.',
    guideFields: ['field', 'dexel', 'sigma', 'extractor', 'interpolation', 'smoothingIterations', 'targetEdgeLength', 'adaptive', 'reproject', 'dexelOccupancy', 'depthRegions'] },
  'signed-distance-dc': { description: 'Carrera Dual Contouring of Signed Distance Data.', guideFields: ['field', 'outerIterations', 'innerIterations'] },
};

const stackMethods: MeshMethod[] = ['marching-cubes', 'surface-nets', 'voxel', ...partMethods];
const stages = [
  { name: 'Voxel Reconstruction', options: ['reconstruct-stack', 'load-stack'], backend: 'node',
    description: 'Carve occupancy from calibrated silhouettes or reopen saved RGBA slices.' },
  { name: 'SDF and Normal Estimation', options: ['hermite-dc', 'signed-distance-dc'], backend: 'python',
    description: 'Estimate normals or distances from occupancy, or use aligned SDF samples in guide.field.' },
  { name: 'Triple-Dexel Capture and Depth Fusion', options: ['capture-dexel', 'dexelOccupancy', 'depthRegions'],
    backend: 'blender and python', description: 'Capture a registered closed source or accept measured XYZ intervals. Rebuild measured occupancy globally or blend into specified local regions of a prior field.' },
  { name: 'Triple-Dexel Hermite Data', options: ['guide.dexel', 'hermite-dc'], backend: 'python',
    description: 'Use axis-aligned crossing positions and outward normals from a registered NPZ.' },
  { name: 'Feature Segmentation and Plane Fitting', options: ['fitTolerance'], backend: 'python',
    description: 'Group adjacent faces by normal and fit supported planes with SVD.' },
  { name: 'Primitive Fitting', options: ['fitTolerance', 'primitives'], backend: 'python',
    description: 'Fit supported spherical and cylindrical patches.' },
  { name: 'Feature Boundary Stitching', options: ['fitTolerance'], backend: 'python',
    description: 'Solve shared boundary vertices together while fitting patches.' },
  { name: 'Guided Geometry Regularization', options: ['regularization.tolerance', 'regularization.features', 'regularization.relations'], backend: 'python',
    description: 'Fit selected planes, rim circles, fixed-axis cylinders and polygons. Jointly optimize explicit plane relations.' },
  { name: 'Procedural Bevel', options: ['bevelWidth', 'bevelSegments'], backend: 'blender',
    description: 'Bevel eligible edges in headless Blender.' },
  { name: 'Selective Rim Bevel after QEM', options: ['lodBevel.preTriangleBudget', 'lodBevel.rims', 'triangleBudget', 'bevelWidth', 'bevelSegments'], backend: 'blender',
    description: 'Reserve triangles with QEM, bevel specified circular rims, and verify the final budget and closed topology.' },
  { name: 'Organic Surface', options: ['organic', 'sigma', 'extractor', 'smoothingIterations', 'targetEdgeLength'], backend: 'python',
    description: 'Filter signed distances, then contour, Taubin-smooth and adaptively remesh in scene units.' },
  { name: 'Quad Retopology', options: ['quadTarget'], backend: 'blender',
    description: 'Run QuadriFlow before LOD and triangulate for GLB export.' },
  { name: 'Mesh Optimization and LOD', options: ['dissolveAngle', 'triangleBudget'], backend: 'blender',
    description: 'Apply planar dissolve and QEM with topology checks. Use separate branches for LODs.' },
  { name: 'Multi-view Texture Projection', options: ['extract-mesh'], backend: 'node or python',
    description: 'Project saved RGB from stack views onto the extracted surface.' },
  { name: 'Weighted Normals', options: ['extract-mesh', 'finish'], backend: 'python',
    description: 'Use area-weighted normal accumulation and split hard creases for hard-surface outputs.' },
  { name: 'Ambient Occlusion', options: ['aoRadius'], backend: 'blender',
    description: 'Bake vertex AO for GLB COLOR_0.' },
  { name: 'GLB Export and GPU Instancing', options: ['write-glb', 'lit', 'instances'], backend: 'node',
    description: 'Write GLB and optional per-instance translations.' },
] as const;

const samples = [
  { id: 'atlas-preview', path: 'atlas/preview.pipeline.yaml', backends: ['node'] },
  { id: 'finish-lod', path: 'finishing/finish-lod.pipeline.yaml', backends: ['node', 'python', 'blender'] },
  { id: 'guided-regularization', path: 'finishing/regularize.pipeline.yaml', backends: ['node', 'python'] },
  { id: 'benchmark-beveled-lod', path: 'case-studies/benchmark/lod-bevel.pipeline.yaml', backends: ['node', 'python', 'blender'] },
  { id: 'triple-dexel', path: 'measured-depth/triple-dexel/compare.pipeline.yaml', backends: ['node', 'python'] },
  { id: 'signed-distance', path: 'measured-depth/sdf/compare.pipeline.yaml', backends: ['node', 'python', 'gpytoolbox'] },
] as const;

function sampleRoot() {
  const packaged = new URL('../references/hard-surface/', import.meta.url);
  return existsSync(packaged) ? packaged : new URL('../../../skills/stack3/references/hard-surface/', import.meta.url);
}

function catalog() {
  const root = sampleRoot();
  return {
    version: 1,
    pipeline: {
      commands: { render: 'stack3 pipeline render', run: 'stack3 pipeline run', schema: 'stack3 pipeline schema [recipe|fragment]' },
      nodes: {
        'load-stack': { output: 'stack', backend: 'node' },
        'reconstruct-stack': { output: 'stack', backend: 'node' },
        'extract-mesh': { input: 'stack', output: 'mesh', backend: 'selected by method and finish options' },
        'write-glb': { input: 'mesh', output: 'glb', backend: 'node' },
      },
      schemas: Object.fromEntries(Object.entries(schemaFiles).map(([kind, file]) => [kind, fileURLToPath(file)])),
    },
    meshMethods: stackMethods.map(id => ({
      id, backend: isCoreMeshMethod(id) ? 'node' : 'python', supportsFinish: !isCoreMeshMethod(id), ...meshInfo[id],
      ...(id === 'organic' && { dependencies: ['pymeshlab (mesh postprocessing)'] }),
      ...(id === 'signed-distance-dc' && { dependencies: ['gpytoolbox'] }),
    })),
    stages,
    samples: samples.map(({ id, path, backends }) => ({ id, path: fileURLToPath(new URL(path, root)), backends })),
    backendConfiguration: { python: 'uv or STACK3_PYTHON', blender: 'Blender executable or BLENDER_BIN' },
  };
}

const help = 'Usage: stack3 capabilities [--json]\nList pipeline nodes, mesh methods, backends, schemas and runnable samples.';

export function capabilitiesCommand(args: string[]) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log(help); return; }
  const data = catalog();
  if (values.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  console.log(help);
  console.log('\nPipeline nodes:', Object.keys(data.pipeline.nodes).join(', '));
  console.log('Mesh methods:', data.meshMethods.map(({ id }) => id).join(', '));
  console.log('\nGeometry and export stages');
  for (const { name, backend, options } of data.stages) console.log(`  ${name} (${backend})   ${options.join(', ')}`);
  console.log('\nJSON Schemas');
  console.log('  stack3 pipeline schema recipe');
  console.log('  stack3 pipeline schema fragment');
  console.log('\nBundled recipes');
  for (const { id, path, backends } of data.samples) console.log(`  ${id} (${backends.join(', ')})\n    ${path}`);
}
