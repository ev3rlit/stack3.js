import type { StackData } from '@stack3/core';

// Output rows stay horizontal. Inverse rotation about the axle maps them back to source voxels.
export class RollingStack {
  readonly asset: StackData;
  readonly rows: Int32Array;
  cos = 1;
  sin = 0;
  private angle = NaN;
  private spacing = NaN;
  private readonly output: Uint32Array;
  private readonly rowOffsets: Uint32Array;
  private readonly sourceRows: Uint32Array[];

  constructor(readonly source: StackData) {
    const data = source.texture.data.slice();
    const input = new Uint32Array(data.buffer);
    this.output = new Uint32Array(input.length);
    this.asset = { ...source, texture: { ...source.texture, data: new Uint8Array(this.output.buffer) } };
    this.rows = new Int32Array(source.depth * source.layers);
    const { width, depth, columns, texture } = source;
    this.rowOffsets = Uint32Array.from(this.rows, (_, i) => {
      const layer = Math.floor(i / depth), y = i % depth;
      return (Math.floor(layer / columns) * depth + y) * texture.width + layer % columns * width;
    });
    this.sourceRows = Array.from(this.rowOffsets, start => input.subarray(start, start + width));
    this.update(0, 1);
  }

  update(degrees: number, spacing: number) {
    const angle = Math.round(degrees * 2) % 720 / 2;
    if (this.angle === angle && this.spacing === spacing) return false;
    this.angle = angle;
    this.spacing = spacing;
    this.cos = Math.cos(angle * Math.PI / 180);
    this.sin = Math.sin(angle * Math.PI / 180);
    const { depth, layers, size } = this.source;
    const depthStep = size[1] / Math.max(1, depth - 1);
    const heightStep = this.source.spacing * spacing;
    const yCenter = (depth - 1) / 2, zCenter = (layers - 1) / 2;
    this.output.fill(0);
    for (let z = 0; z < layers; z++) for (let y = 0; y < depth; y++) {
      const dy = (y - yCenter) * depthStep, dz = (z - zCenter) * heightStep;
      const sy = Math.round(yCenter + (this.cos * dy - this.sin * dz) / depthStep);
      const sz = Math.round(zCenter + (this.sin * dy + this.cos * dz) / heightStep);
      const row = z * depth + y;
      if (sy < 0 || sy >= depth || sz < 0 || sz >= layers) {
        this.rows[row] = -1;
        continue;
      }
      this.rows[row] = sz * depth + sy;
      this.output.set(this.sourceRows[this.rows[row]], this.rowOffsets[row]);
    }
    return true;
  }
}
