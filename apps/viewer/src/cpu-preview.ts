import * as THREE from 'three';
import { getStackSlice } from '@stack3/three';
import { CpuLighting, type CpuRenderOptions, type Pixels } from './cpu-lighting';

const edge = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
  (bx - ax) * (y - ay) - (by - ay) * (x - ax);

export class CpuPreview {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly textures = new WeakMap<object, Pixels>();
  private readonly transform = new THREE.Matrix4();
  private readonly vertex = new THREE.Vector4();
  private readonly lighting = new CpuLighting();
  private frame: ImageData | undefined;
  private sampleColors = new Uint8ClampedArray(0);
  private depth = new Float32Array(0);

  private pixels(map: THREE.Texture): Pixels | undefined {
    const image = map.image as Pixels | ImageBitmap | HTMLImageElement | undefined;
    if (!image?.width || !image.height) return;
    if ('data' in image) return image;
    const cached = this.textures.get(image);
    if (cached) return cached;
    try {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height);
      this.textures.set(image, pixels);
      return pixels;
    } catch { return; }
  }

  render(object: THREE.Object3D | null, camera: THREE.Camera, supersampling: boolean, showGrid: boolean, ground: number,
    lighting: boolean, options?: CpuRenderOptions) {
    // Keep interactive CPU cost bounded independently of display DPI.
    const scale = Math.min(1, 512 / Math.max(this.canvas.clientWidth, this.canvas.clientHeight, 1)) * (supersampling ? 2 : 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (!this.frame || this.frame.width !== width || this.frame.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.frame = this.ctx.createImageData(width, height);
    }
    const { data } = this.frame;
    const samples = options?.subpixelAA ? 4 : 1;
    const count = width * height * samples;
    if (this.depth.length !== count) this.depth = new Float32Array(count);
    const colorCount = samples === 4 ? count * 4 : 0;
    if (this.sampleColors.length !== colorCount) this.sampleColors = new Uint8ClampedArray(colorCount);
    const colors = samples === 4 ? this.sampleColors : data;
    colors.fill(0); // Transparent background lets the grid show through.
    this.depth.fill(Infinity);
    camera.updateMatrixWorld();
    if (options) this.lighting.camera(camera);
    object?.updateMatrixWorld(true);
    const visible: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; viewZ: number }[] = [];
    const inverse = camera.matrixWorldInverse.elements;
    object?.traverseVisible(child => {
      if (!(child instanceof THREE.Mesh) || !child.visible || Array.isArray(child.material)) return;
      const material = child.material as THREE.MeshBasicMaterial;
      if (!material.map) return;
      const world = child.matrixWorld.elements;
      const viewZ = inverse[2] * world[12] + inverse[6] * world[13] + inverse[10] * world[14];
      visible.push({ mesh: child, material, viewZ });
    });
    // Shade nearer layers first so covered fragments fail the depth check before texture sampling.
    if (options) visible.sort((a, b) => b.viewZ - a.viewZ);
    for (const { mesh, material } of visible) {
      this.draw(mesh, material, camera, width, height, colors, lighting || material instanceof THREE.MeshLambertMaterial, samples, options);
    }
    if (samples === 4) this.resolveSubpixels(data);
    this.ctx.putImageData(this.frame, 0, 0);
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-over';
    if (showGrid && object) this.drawGrid(camera, width, height, ground);
    this.ctx.fillStyle = '#121923';
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.restore();
  }

  private resolveSubpixels(data: Uint8ClampedArray) {
    const colors = this.sampleColors;
    for (let p = 0, sample = 0; p < data.length; p += 4, sample += 16) {
      const a = colors[sample + 3], b = colors[sample + 7], c = colors[sample + 11], d = colors[sample + 15];
      const coverage = a + b + c + d;
      data[p + 3] = coverage * .25;
      if (!coverage) {
        data[p] = data[p + 1] = data[p + 2] = 0;
        continue;
      }
      for (let channel = 0; channel < 3; channel++) {
        data[p + channel] = (colors[sample + channel] * a + colors[sample + 4 + channel] * b +
          colors[sample + 8 + channel] * c + colors[sample + 12 + channel] * d) / coverage;
      }
    }
  }

  private drawGrid(camera: THREE.Camera, width: number, height: number, ground: number) {
    const start = new THREE.Vector3(), end = new THREE.Vector3();
    this.ctx.strokeStyle = '#29394b';
    this.ctx.beginPath();
    for (let i = -12; i <= 12; i++) for (let axis = 0; axis < 2; axis++) {
      const k = i * .25;
      start.set(axis ? k : -3, ground, axis ? -3 : k).project(camera);
      end.set(axis ? k : 3, ground, axis ? 3 : k).project(camera);
      if (start.z < -1 || start.z > 1 || end.z < -1 || end.z > 1) continue;
      this.ctx.moveTo((start.x + 1) * width / 2, (1 - start.y) * height / 2);
      this.ctx.lineTo((end.x + 1) * width / 2, (1 - end.y) * height / 2);
    }
    this.ctx.stroke();
  }

  private draw(mesh: THREE.Mesh, material: THREE.MeshBasicMaterial, camera: THREE.Camera,
    width: number, height: number, data: Uint8ClampedArray, lighting: boolean,
    samples: number, options?: CpuRenderOptions) {
    const map = material.map!;
    const tex = this.pixels(map);
    const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    if (!tex || !positions || !uv) return;
    this.transform.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    const slice = options && getStackSlice(mesh);
    let clipLeft = 0, clipRight = width - 1, clipTop = 0, clipBottom = height - 1;
    if (slice) {
      if (!slice.bounds) return;
      const [u0, v0, u1, v1] = slice.bounds;
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const u of [u0, u1]) for (const v of [v0, v1]) {
        const point = this.vertex.set((u - .5) * slice.stack.size[0], 0, (.5 - v) * slice.stack.size[1], 1)
          .applyMatrix4(this.transform);
        const x = (1 + point.x / point.w) * width * .5, y = (1 - point.y / point.w) * height * .5;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      clipLeft = Math.max(clipLeft, Math.floor(left));
      clipRight = Math.min(clipRight, Math.ceil(right));
      clipTop = Math.max(clipTop, Math.floor(top));
      clipBottom = Math.min(clipBottom, Math.ceil(bottom));
      if (clipLeft > clipRight || clipTop > clipBottom) return;
    }
    const projected = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      const p = i * 4;
      const v = this.vertex.set(positions.getX(i), positions.getY(i), positions.getZ(i), 1).applyMatrix4(this.transform);
      projected[p] = (1 + v.x / v.w) * width * .5;
      projected[p + 1] = (1 - v.y / v.w) * height * .5;
      projected[p + 2] = v.z / v.w;
      projected[p + 3] = v.w > 0 ? 1 / v.w : 0;
    }
    const normals = mesh.geometry.getAttribute('normal');
    const shaded = !!(lighting && normals && options);
    if (lighting && normals && options) this.lighting.mesh(mesh, normals, map, tex, options);
    const index = mesh.geometry.index;
    const count = index?.count ?? positions.count;
    const sample = new Float32Array(4);
    const nearest = map.magFilter === THREE.NearestFilter;
    const mirrored = mesh.matrixWorld.determinant() < 0;
    const alphaCutoff = Math.max(1, material.alphaTest * 255);
    for (let i = 0; i < count; i += 3) {
      const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2;
      const A = a * 4, B = b * 4, C = c * 4;
      const az = projected[A + 2], bz = projected[B + 2], cz = projected[C + 2];
      if (!projected[A + 3] || !projected[B + 3] || !projected[C + 3] || Math.min(az, bz, cz) > 1) continue;
      const ax = projected[A], ay = projected[A + 1], bx = projected[B], by = projected[B + 1], cx = projected[C], cy = projected[C + 1];
      const area = edge(ax, ay, bx, by, cx, cy);
      const back = mirrored ? area < 0 : area > 0;
      if (!area || (back && material.side === THREE.FrontSide)) continue;
      const minX = Math.max(clipLeft, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(clipRight, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(clipTop, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(clipBottom, Math.ceil(Math.max(ay, by, cy)));
      const light = lighting && normals && !shaded ? .65 + .35 * Math.max(0, normals.getY(a) * .7 + normals.getZ(a) * .5 + normals.getX(a) * .45) : 1;
      if (shaded) this.lighting.triangle(positions, uv, a, b, c, area, map.flipY);
      const waX = (by - cy) / area, waY = (cx - bx) / area;
      const wbX = (cy - ay) / area, wbY = (ax - cx) / area;
      const fringe = samples === 4 ? .25 : 0;
      const waSpan = (Math.abs(waX) + Math.abs(waY)) * fringe;
      const wbSpan = (Math.abs(wbX) + Math.abs(wbY)) * fringe;
      const wcSpan = (Math.abs(waX + wbX) + Math.abs(waY + wbY)) * fringe;
      const au = uv.getX(a), bu = uv.getX(b), cu = uv.getX(c);
      const av = uv.getY(a), bv = uv.getY(b), cv = uv.getY(c);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const centerA = edge(bx, by, cx, cy, x + .5, y + .5) / area;
        const centerB = edge(cx, cy, ax, ay, x + .5, y + .5) / area;
        if (centerA < -waSpan || centerB < -wbSpan || 1 - centerA - centerB < -wcSpan) continue;
        let shadedColor = false, red = 0, green = 0, blue = 0;
        for (let sub = 0; sub < samples; sub++) {
          // Four quarter-pixel positions cover geometric edges and alpha-tested slice edges.
          const dx = samples === 1 ? 0 : sub & 1 ? .25 : -.25;
          const dy = samples === 1 ? 0 : sub & 2 ? .25 : -.25;
          const wa = centerA + dx * waX + dy * waY;
          const wb = centerB + dx * wbX + dy * wbY;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const z = wa * az + wb * bz + wc * cz;
          const pixel = (y * width + x) * samples + sub;
          if (z < -1 || z > 1 || z >= this.depth[pixel]) continue;
          const pa = wa * projected[A + 3], pb = wb * projected[B + 3], pc = wc * projected[C + 3];
          const divide = 1 / (pa + pb + pc);
          const u = (au * pa + bu * pb + cu * pc) * divide * map.repeat.x + map.offset.x;
          const textureV = (av * pa + bv * pb + cv * pc) * divide * map.repeat.y + map.offset.y;
          const v = map.flipY ? 1 - textureV : textureV;
          this.sample(tex, u, v, nearest, sample);
          if (sample[3] < alphaCutoff) continue;
          // Resolve coverage and depth per sample. Shade each visible primitive only once per pixel.
          if (!shadedColor) {
            if (shaded) this.lighting.shade(sample, tex, u, v, a, b, c, pa * divide, pb * divide, pc * divide, back);
            red = sample[0] * light;
            green = sample[1] * light;
            blue = sample[2] * light;
            shadedColor = true;
          }
          this.depth[pixel] = z;
          data[pixel * 4] = red;
          data[pixel * 4 + 1] = green;
          data[pixel * 4 + 2] = blue;
          data[pixel * 4 + 3] = material.alphaToCoverage ? sample[3] : 255;
        }
      }
    }
  }

  private sample(texture: Pixels, u: number, v: number, nearest: boolean, out: Float32Array) {
    const { width, height, data } = texture;
    const x = Math.min(width - 1, Math.max(0, u * width - .5));
    const y = Math.min(height - 1, Math.max(0, v * height - .5));
    if (nearest) {
      const p = (Math.round(y) * width + Math.round(x)) * 4;
      for (let channel = 0; channel < 4; channel++) out[channel] = data[p + channel];
      return;
    }
    const left = Math.floor(x), top = Math.floor(y), right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1);
    const t = x - left, s = y - top;
    for (let channel = 0; channel < 4; channel++) {
      out[channel] = (data[(top * width + left) * 4 + channel] * (1 - t) + data[(top * width + right) * 4 + channel] * t) * (1 - s) +
        (data[(bottom * width + left) * 4 + channel] * (1 - t) + data[(bottom * width + right) * 4 + channel] * t) * s;
    }
  }
}
