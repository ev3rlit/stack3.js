export const DEFAULT_LAYERS = 128;

export function samplingGrid(width: number, depth: number, resolution: number, layers: number) {
  if (!Number.isSafeInteger(layers) || layers < 8) throw new Error('Layers must be a safe integer of at least 8.');
  if (!Number.isSafeInteger(resolution) || resolution < 16) throw new Error('Resolution must be a safe integer of at least 16.');
  const longest = Math.max(width, depth);
  const columns = Math.max(2, Math.round(width / longest * resolution));
  const rows = Math.max(2, Math.round(depth / longest * resolution));
  if (!Number.isSafeInteger(columns * rows * layers * 4)) {
    throw new Error('Requested grid is too large to address its RGBA samples.');
  }
  return { width: columns, depth: rows, layers };
}
