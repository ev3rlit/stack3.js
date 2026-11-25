export const DIRECTIONS = ['top', 'left', 'front', 'rear', 'right', 'bottom'] as const;
export type Direction = typeof DIRECTIONS[number];
export type Raster = { width: number; height: number; data: Uint8Array };
export type ViewSet = Partial<Record<Direction, Raster>>;
export type Box = { left: number; top: number; width: number; height: number };

export function readPngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value) ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error('Expected a PNG image.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error('Invalid PNG dimensions.');
  return { width, height };
}

export function readPngSize(bytes: Uint8Array) {
  const { width, height } = readPngDimensions(bytes);
  if (width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('PNG dimensions exceed the 8192 px or 16 MP input limit.');
  }
  return { width, height };
}

export function parseLayout(value: string): Direction[] {
  const directions = value.split(',').map(item => item.trim());
  if (directions.some(direction => !DIRECTIONS.includes(direction as Direction))) {
    throw new Error('Use directions top, left, front, rear, right, and bottom.');
  }
  if (directions.length !== 4 && directions.length !== 6 || new Set(directions).size !== directions.length ||
      DIRECTIONS.slice(0, directions.length).some(direction => !directions.includes(direction))) {
    throw new Error('A layout needs the four required directions or all six, with no duplicates.');
  }
  return directions as Direction[];
}

function maskedRaster(image: Raster, threshold: number): Raster {
  const { width, height } = image;
  const data = new Uint8Array(image.data);
  const count = width * height;
  // Explicit transparency takes precedence over color keying.
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) return { width, height, data };
  }
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let read = 0, write = 0;
  function enqueue(index: number) {
    if (seen[index]) return;
    seen[index] = 1;
    const p = index * 4;
    if (Math.min(data[p], data[p + 1], data[p + 2]) >= threshold) queue[write++] = index;
  }
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (read < write) {
    const index = queue[read++];
    data[index * 4 + 3] = 0;
    const x = index % width;
    if (x) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < count) enqueue(index + width);
  }
  return { width, height, data };
}

export function crop(image: Raster, box: Box): Raster {
  const { left, top, width, height } = box;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, data };
}

function bounds(image: Raster, region: Box): Box | null {
  const { left, top, width, height } = region;
  let minX = left + width, maxX = -1, minY = top + height, maxY = -1;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] < 128) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function runs(occupied: Uint8Array) {
  const result: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= occupied.length; i++) {
    if (occupied[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      result.push([start, i]);
      start = -1;
    }
  }
  return result;
}

function columns(image: Raster, top: number, bottom: number) {
  const used = new Uint8Array(image.width);
  for (let y = top; y < bottom; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] >= 128) used[x] = 1;
  }
  return runs(used);
}

function boxesFromMask(clean: Raster, layout: Direction[]): Box[] {
  parseLayout(layout.join(','));
  let regions: Box[] = columns(clean, 0, clean.height).map(([left, end]) =>
    ({ left, top: 0, width: end - left, height: clean.height }));
  if (regions.length !== layout.length) {
    const rows = new Uint8Array(clean.height);
    for (let y = 0; y < clean.height; y++) {
      for (let x = 0; x < clean.width; x++) {
        if (clean.data[(y * clean.width + x) * 4 + 3] >= 128) { rows[y] = 1; break; }
      }
    }
    regions = runs(rows).flatMap(([top, bottom]) => columns(clean, top, bottom).map(([left, end]) =>
      ({ left, top, width: end - left, height: bottom - top })));
  }
  if (regions.length !== layout.length) {
    throw new Error(`Expected ${layout.length} separated views, found ${regions.length}. Use clear gutters or individual PNGs.`);
  }
  return regions.map(region => bounds(clean, region)!);
}

export function atlasBoxes(image: Raster, layout: Direction[], threshold = 238): Box[] {
  return boxesFromMask(maskedRaster(image, threshold), layout);
}

export function splitAtlas(image: Raster, layout: Direction[], threshold = 238): ViewSet {
  const clean = maskedRaster(image, threshold);
  return Object.fromEntries(boxesFromMask(clean, layout).map((box, index) => {
    const tile = crop(clean, box);
    // Retain an explicit transparent border even when the tile itself is an opaque rectangle.
    const width = tile.width + 2, height = tile.height + 2;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < tile.height; y++) {
      data.set(tile.data.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((y + 1) * width + 1) * 4);
    }
    return [layout[index], { width, height, data }];
  }));
}

export function prepareViews(input: ViewSet, threshold = 238): ViewSet {
  parseLayout(Object.keys(input).join(','));
  const entries = Object.entries(input) as [Direction, Raster][];
  return Object.fromEntries(entries.map(([direction, image]) => {
    const clean = maskedRaster(image, threshold);
    const box = bounds(clean, { left: 0, top: 0, width: clean.width, height: clean.height });
    if (!box) throw new Error(`The ${direction} view has an empty silhouette.`);
    return [direction, crop(clean, box)];
  }));
}

export function inspectViews(views: ViewSet) {
  const { top, left, front, rear } = views as Required<ViewSet>;
  const expected = left.width / left.height * top.width / top.height;
  const observed = front.width / front.height;
  const warnings: string[] = [];
  if (Math.abs(expected / observed - 1) > 0.2) warnings.push('Top, left, and front proportions differ by more than 20%. Check alignment.');
  if (Math.abs((rear.width / rear.height) / observed - 1) > 0.2) warnings.push('Front and rear proportions differ by more than 20%.');
  const mapped = Object.entries(views).map(([direction, raster]) => ({ direction, width: raster.width, height: raster.height }));
  // Each axis can use evidence from any view that actually observes it.
  const nativeSamples = {
    x: Math.max(top.width, front.width, rear.width, views.bottom?.width ?? 0),
    y: Math.max(top.height, left.width, views.right?.width ?? 0, views.bottom?.height ?? 0),
    z: Math.max(left.height, front.height, rear.height, views.right?.height ?? 0),
  };
  return { views: mapped, nativeSamples, warnings };
}
