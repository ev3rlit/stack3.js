import type { Raster, StackData } from '@stack3/core';

type BeltPixel = { offset: number; column: number; distance: number };

/** Map an outer tread onto a closed capsule around the track's side profile. */
function beltDistance(u: number, v: number, radius: number, span: number) {
  if (u > span) return 2 * span + (Math.atan2(v, u - span) + Math.PI / 2) * radius;
  if (u < -span) {
    const angle = Math.atan2(v, u + span);
    return 4 * span + Math.PI * radius + ((angle < 0 ? angle + 2 * Math.PI : angle) - Math.PI / 2) * radius;
  }
  return v < 0 ? u + span : 3 * span - u + Math.PI * radius;
}

export class TrackBelt {
  readonly asset: StackData;
  private pixels: BeltPixel[] = [];
  private depth = 0;
  private height = 0;
  private repeat = 0;
  private phase: number | undefined;

  constructor(private readonly source: StackData, private readonly tread: Raster) {
    this.asset = { ...source, texture: { ...source.texture, data: source.texture.data.slice() } };
  }

  private prepare(depth: number, height: number) {
    this.depth = depth;
    this.height = height;
    const radius = height / 2, span = Math.max(0, depth / 2 - radius);
    const loop = 4 * span + 2 * Math.PI * radius;
    this.repeat = loop / Math.max(1, Math.round(loop / (depth * .8)));
    this.pixels = [];
    const { layers, width, depth: rows, columns, texture } = this.source;
    for (let layer = 0; layer < layers; layer++) {
      const left = layer % columns * width, top = Math.floor(layer / columns) * rows;
      const v = ((layer + .5) / layers - .5) * height;
      for (let y = 0; y < rows; y++) {
        const u = ((y + .5) / rows - .5) * depth;
        if (Math.hypot(Math.max(0, Math.abs(u) - span), v) < radius * .77) continue;
        const distance = beltDistance(u, v, radius, span);
        for (let x = 0; x < width; x++) {
          const offset = ((top + y) * texture.width + left + x) * 4;
          if (!texture.data[offset + 3]) continue;
          this.pixels.push({ offset, column: Math.floor((x + .5) * this.tread.width / width), distance });
        }
      }
    }
  }

  update(travel: number | undefined, depth: number, height: number) {
    const base = this.source.texture.data;
    const dest = this.asset.texture.data;
    if (travel === undefined) {
      if (this.phase === undefined) return false;
      this.phase = undefined;
      dest.set(base);
      return true;
    }
    const resized = this.depth !== depth || this.height !== height;
    if (resized) {
      this.prepare(depth, height);
      dest.set(base);
    }
    const steps = Math.max(1, Math.round(this.tread.height * .8));
    const tick = Math.round(travel / this.repeat * steps) % steps;
    if (!resized && this.phase === tick) return false;
    this.phase = tick;
    const shift = tick / steps * this.repeat;
    for (const { offset, column, distance } of this.pixels) {
      const pos = ((distance + shift) % this.repeat + this.repeat) % this.repeat / this.repeat;
      const row = Math.floor((.1 + .8 * pos) * this.tread.height);
      const texel = (row * this.tread.width + column) * 4;
      const blend = this.tread.data[texel + 3] >= 128 ? .77 : 0;
      for (let channel = 0; channel < 3; channel++) {
        dest[offset + channel] = Math.round(base[offset + channel] * (1 - blend) + this.tread.data[texel + channel] * blend);
      }
    }
    return true;
  }
}
