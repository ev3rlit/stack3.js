import { zipSync, zlibSync } from 'fflate';
import type { MeshData, StackData } from './reconstruct';
import { readPngDimensions, type Raster } from './views';

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function pngChunk(name: string, bytes: Uint8Array) {
  const chunk = new Uint8Array(bytes.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length);
  chunk.set(encoder.encode(name), 4);
  chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[i]) & 255];
  view.setUint32(chunk.length - 4, crc ^ 0xffffffff);
  return chunk;
}

export function encodePng({ width, height, data }: Raster) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return concat([Uint8Array.of(137,80,78,71,13,10,26,10), pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(rows)), pngChunk('IEND', new Uint8Array(0))]);
}

const align = (length: number) => (length + 3) & ~3;
function padded(bytes: Uint8Array, pad = 0) {
  const output = new Uint8Array(align(bytes.length)).fill(pad);
  output.set(bytes);
  return output;
}

function asBytes(data: Float32Array | Uint32Array) {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function encodeGlb(mesh: MeshData) {
  const sources = [asBytes(mesh.positions), asBytes(mesh.normals), asBytes(mesh.uvs), asBytes(mesh.indices), encodePng(mesh.texture)];
  let offset = 0;
  const bufferViews = sources.map((source, index) => {
    const target = index < 3 ? 34962 : index === 3 ? 34963 : undefined;
    const entry = { buffer: 0, byteOffset: offset, byteLength: source.length, target };
    offset += align(source.length);
    return entry;
  });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], mesh.positions[i]);
    max[i % 3] = Math.max(max[i % 3], mesh.positions[i]);
  }
  const count = mesh.positions.length / 3;
  const json = padded(encoder.encode(JSON.stringify({
    asset: { version: '2.0', generator: 'stack3.js' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, extras: { size: mesh.size, pivot: mesh.pivot } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: mesh.nearestTexture ? 9728 : 9729, minFilter: mesh.nearestTexture ? 9728 : 9729, wrapS: 33071, wrapT: 33071 }],
    images: [{ mimeType: 'image/png', bufferView: 4 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
    bufferViews, buffers: [{ byteLength: offset }],
  })), 32);
  const binary = concat(sources.map(source => padded(source)));
  const header = new Uint8Array(20), head = new DataView(header.buffer);
  head.setUint32(0, 0x46546c67, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, 28 + json.length + binary.length, true);
  head.setUint32(12, json.length, true);
  head.setUint32(16, 0x4e4f534a, true);
  const chunk = new Uint8Array(8), bin = new DataView(chunk.buffer);
  bin.setUint32(0, binary.length, true);
  bin.setUint32(4, 0x004e4942, true);
  return concat([header, json, chunk, binary]);
}

export function encodeStack(stack: StackData) {
  const { width, depth, layers, columns, spacing, size, pivot } = stack;
  return {
    png: encodePng(stack.texture),
    manifest: {
      version: 1, atlas: 'stack.png', width, depth, layers, columns, spacing, size, pivot,
      layerOrder: 'bottom-to-top', layout: 'row-major', axes: 'xy-ground-z-up-y-forward',
    },
  };
}

function stackMetadata(manifest: unknown, texture: Pick<Raster, 'width' | 'height'>) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Expected a stack3 stack manifest.');
  const { version, atlas, layout, layerOrder, axes, width, depth, layers, columns, spacing, size, pivot } =
    manifest as Record<string, unknown>;
  const dimension = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const vector = (value: unknown): value is StackData['size'] =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (version !== 1 || atlas !== 'stack.png' || layout !== 'row-major' ||
    layerOrder !== 'bottom-to-top' || axes !== 'xy-ground-z-up-y-forward' ||
    !dimension(width) || !dimension(depth) || !dimension(layers) || !dimension(columns) ||
    columns > layers || !Number.isSafeInteger(texture.width * texture.height * 4) ||
    !vector(size) || size.some(value => value <= 0) || !vector(pivot) ||
    typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0 ||
    texture.width !== width * columns || texture.height !== depth * Math.ceil(layers / columns)) {
    throw new Error('The stack manifest does not match the PNG or uses an unsupported layout.');
  }
  return { width, depth, layers, columns, spacing, size, pivot };
}

export function readStackPngSize(bytes: Uint8Array, manifest: unknown) {
  const dimensions = readPngDimensions(bytes);
  stackMetadata(manifest, dimensions);
  return dimensions;
}

export function readStackBundle(manifest: unknown, texture: Raster): StackData {
  const meta = stackMetadata(manifest, texture);
  if (texture.data.length !== texture.width * texture.height * 4) throw new Error('Invalid stack texture data length.');
  return { target: 'stack', texture, ...meta };
}

export function encodeStackZip(stack: StackData) {
  const bundle = encodeStack(stack);
  return zipSync({
    'stack.png': bundle.png,
    'stack.json': encoder.encode(JSON.stringify(bundle.manifest, null, 2) + '\n'),
  });
}
