import { readPngSize, type Raster } from '@stack3/core';

export async function decodePng(file: Blob, dataTexture = false): Promise<Raster> {
  readPngSize(new Uint8Array(await file.slice(0, 33).arrayBuffer()));
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: dataTexture ? 'none' : 'default' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not decode the PNG.');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: new Uint8Array(image.data.buffer) };
  } finally {
    bitmap.close();
  }
}
