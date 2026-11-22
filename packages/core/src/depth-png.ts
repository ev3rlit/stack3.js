import { unzlibSync } from 'fflate';
import { readPngSize } from './views';

export type DepthRaster = { width: number; height: number; data: Uint16Array };

export function decodeDepthPng(bytes: Uint8Array): DepthRaster {
  const { width, height } = readPngSize(bytes);
  if (bytes[24] !== 16 || bytes[25] !== 0 || bytes[26] || bytes[27] || bytes[28]) {
    throw new Error('Depth maps must be non-interlaced 16-bit grayscale PNGs.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = header.getUint32(offset);
    const tag = header.getUint32(offset + 4);
    const end = offset + 12 + size;
    if (end > bytes.length) throw new Error('Truncated depth PNG.');
    if (tag === 0x49444154) {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
      length += size;
    }
    if (tag === 0x49454e44) break;
    offset = end;
  }
  if (!length) throw new Error('Depth PNG is missing image data.');
  const compressed = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const stride = width * 2;
  const expected = (stride + 1) * height;
  const raw = unzlibSync(compressed, { out: new Uint8Array(expected + 1) });
  if (raw.length !== expected) throw new Error('Invalid depth PNG scanline length.');
  const data = new Uint16Array(width * height);
  let row = new Uint8Array(stride), previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    if (filter > 4) throw new Error('Invalid depth PNG filter.');
    for (let x = 0; x < stride; x++) {
      const left = x >= 2 ? row[x - 2] : 0;
      const up = previous[x];
      const corner = x >= 2 ? previous[x - 2] : 0;
      let predictor = 0;
      switch (filter) {
        case 1: predictor = left; break;
        case 2: predictor = up; break;
        case 3: predictor = (left + up) >> 1; break;
        case 4: {
          const p = left + up - corner;
          const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
          predictor = a <= b && a <= c ? left : b <= c ? up : corner;
          break;
        }
      }
      row[x] = raw[start + 1 + x] + predictor;
    }
    for (let x = 0; x < width; x++) data[y * width + x] = row[x * 2] * 256 + row[x * 2 + 1];
    [row, previous] = [previous, row];
  }
  return { width, height, data };
}

export function depthDistance(value: number, near: number, far: number) {
  return near + (far - near) * (65535 - value) / 65534;
}
