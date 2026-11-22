import * as THREE from 'three';
import { getStackSlice } from '@stack3/three';
import { stackLighting } from './stack-lighting';

export type CpuRenderOptions = { detailNormals?: boolean; subpixelAA?: boolean; specularAA?: boolean };
export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
const light = new THREE.Vector3(.45, .7, .5).normalize();

function ggxHighlight(roughness: number, normalDot: number, variance: number) {
  // Match the demo's variance-broadened lobe and lower the peak where normals disagree.
  const a2 = Math.min(1, roughness ** 4 + variance);
  const d = normalDot * normalDot * (a2 - 1) + 1;
  return Math.min(2.4 / (1 + 4 * variance), a2 / (d * d) * .63);
}

export class CpuLighting {
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly worldMatrix = new THREE.Matrix3();
  private readonly half = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();
  private readonly uEdge = new THREE.Vector3();
  private readonly vEdge = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private normals = new Float32Array(0);
  private variance = 0;
  private detail = false;
  private specularAA = false;
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;
  private slice?: { width: number; row: number; roll: NonNullable<ReturnType<typeof getStackSlice>>['roll'];
    spacing: number; lighting: ReturnType<typeof stackLighting> };

  camera(camera: THREE.Camera) {
    camera.getWorldDirection(this.half).negate().add(light).normalize();
  }

  mesh(mesh: THREE.Mesh, normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    map: THREE.Texture, texture: Pixels, options: CpuRenderOptions) {
    this.detail = !!options.detailNormals;
    this.specularAA = !!options.specularAA;
    const slice = getStackSlice(mesh);
    this.slice = slice ? { width: slice.stack.width, row: slice.layer * slice.stack.depth, roll: slice.roll,
      spacing: mesh.parent?.scale.y ?? 1, lighting: stackLighting(slice.roll?.source ?? slice.stack) } : undefined;
    if (this.normals.length < normals.count * 3) this.normals = new Float32Array(normals.count * 3);
    this.normalMatrix.getNormalMatrix(mesh.matrixWorld);
    this.worldMatrix.setFromMatrix4(mesh.matrixWorld);
    for (let i = 0; i < normals.count; i++) {
      this.n.fromBufferAttribute(normals, i).applyNormalMatrix(this.normalMatrix).toArray(this.normals, i * 3);
    }
    // The stack packs slices next to one another. Keep the bump stencil within its tile.
    this.minX = Math.max(0, Math.round(map.offset.x * texture.width - .5));
    this.maxX = Math.min(texture.width - 1, Math.round((map.offset.x + map.repeat.x) * texture.width - .5));
    const v0 = map.offset.y, v1 = v0 + map.repeat.y;
    this.minY = Math.max(0, Math.round((map.flipY ? 1 - v1 : v0) * texture.height - .5));
    this.maxY = Math.min(texture.height - 1, Math.round((map.flipY ? 1 - v0 : v1) * texture.height - .5));
  }

  triangle(positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, a: number, b: number, c: number,
    area: number, flipY: boolean) {
    if (this.detail) {
      const bu = uv.getX(b) - uv.getX(a), bv = uv.getY(b) - uv.getY(a);
      const cu = uv.getX(c) - uv.getX(a), cv = uv.getY(c) - uv.getY(a);
      const determinant = bu * cv - cu * bv;
      this.tangent.set(0, 0, 0);
      this.bitangent.set(0, 0, 0);
      if (Math.abs(determinant) > 1e-12) {
        this.n.fromBufferAttribute(positions, a);
        this.uEdge.fromBufferAttribute(positions, b).sub(this.n).applyMatrix3(this.worldMatrix);
        this.vEdge.fromBufferAttribute(positions, c).sub(this.n).applyMatrix3(this.worldMatrix);
        this.tangent.copy(this.uEdge).multiplyScalar(cv / determinant).addScaledVector(this.vEdge, -bv / determinant).normalize();
        this.bitangent.copy(this.uEdge).multiplyScalar(-cu / determinant).addScaledVector(this.vEdge, bu / determinant)
          .normalize().multiplyScalar(flipY ? -1 : 1);
      }
    }
    this.variance = 0;
    if (this.specularAA && !this.slice) {
      const n = this.normals;
      const ai = a * 3, bi = b * 3, ci = c * 3;
      const dot = (i: number, j: number) => n[i] * n[j] + n[i + 1] * n[j + 1] + n[i + 2] * n[j + 2];
      this.variance = Math.min(.14, Math.max(0, 3 - dot(ai, bi) - dot(bi, ci) - dot(ci, ai)) /
        Math.max(3, Math.sqrt(Math.abs(area)) * 3));
    }
  }

  shade(sample: Float32Array, texture: Pixels, u: number, v: number,
    a: number, b: number, c: number, wa: number, wb: number, wc: number, back: boolean) {
    const ai = a * 3, bi = b * 3, ci = c * 3;
    const n = this.normals;
    const normal = this.normal.set(
      n[ai] * wa + n[bi] * wb + n[ci] * wc,
      n[ai + 1] * wa + n[bi + 1] * wb + n[ci + 1] * wc,
      n[ai + 2] * wa + n[bi + 2] * wb + n[ci + 2] * wc,
    ).normalize();
    if (back) normal.negate();
    const luma = (sample[0] * .2126 + sample[1] * .7152 + sample[2] * .0722) / 255;
    let variance = this.variance;
    if (this.detail || this.slice) {
      const x = Math.min(this.maxX, Math.max(this.minX, Math.floor(u * texture.width)));
      const y = Math.min(this.maxY, Math.max(this.minY, Math.floor(v * texture.height)));
      if (this.slice) {
        const { row, width, roll, spacing, lighting } = this.slice;
        const sampled = row + y - this.minY;
        const source = roll ? roll.rows[sampled] : sampled;
        if (source >= 0) {
          const i = source * width + x - this.minX;
          const nx = lighting.normals[i * 3], ny = lighting.normals[i * 3 + 1], nz = lighting.normals[i * 3 + 2];
          if (nx || ny || nz) {
            normal.set(nx, ny, nz);
            if (roll) normal.set(nx, ny * roll.cos - nz * roll.sin * spacing, ny * roll.sin / spacing + nz * roll.cos);
            normal.applyNormalMatrix(this.normalMatrix);
          }
          if (this.specularAA) variance = lighting.variance[i] / 255 * .24;
        }
      }
      if (this.detail) variance = this.perturb(normal, texture, x, y, luma, variance);
    }
    const nl = Math.max(0, normal.dot(light));
    const roughness = .38 + .23 * (1 - luma);
    const highlight = ggxHighlight(roughness, Math.max(0, normal.dot(this.half)), variance) * nl;
    const diffuse = .68 + .31 * nl + .06 * Math.max(0, normal.y);
    const specular = (12 + 22 * luma) * highlight;
    for (let channel = 0; channel < 3; channel++) {
      const color = sample[channel] * diffuse;
      sample[channel] = color + specular * (1 - color / 340);
    }
  }

  private perturb(normal: THREE.Vector3, texture: Pixels, x: number, y: number, luma: number, variance: number) {
    const mid = this.luma(texture, x, y, luma);
    const left = this.luma(texture, x - 1, y, mid), right = this.luma(texture, x + 1, y, mid);
    const top = this.luma(texture, x, y - 1, mid), bottom = this.luma(texture, x, y + 1, mid);
    // The demo blends one- and two-texel luminance gradients and ignores transparent neighbors.
    const du = .76 * (right - left) + .12 * (this.luma(texture, x + 2, y, right) - this.luma(texture, x - 2, y, left));
    const dv = .76 * (bottom - top) + .12 * (this.luma(texture, x, y + 2, bottom) - this.luma(texture, x, y - 2, top));
    const scale = Math.min(1.7, .38 / Math.max(.001, Math.hypot(du, dv)));
    this.n.copy(this.tangent).multiplyScalar(du).addScaledVector(this.bitangent, dv);
    this.n.addScaledVector(normal, -this.n.dot(normal));
    normal.addScaledVector(this.n, -scale).normalize();
    if (!this.specularAA) return variance;
    const dx = left + right - 2 * mid, dy = top + bottom - 2 * mid;
    return Math.min(.24, variance + .45 * (dx * dx + dy * dy));
  }

  private luma(texture: Pixels, x: number, y: number, fallback: number) {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return fallback;
    const p = (y * texture.width + x) * 4;
    const data = texture.data;
    return data[p + 3] >= 128 ? (data[p] * .2126 + data[p + 1] * .7152 + data[p + 2] * .0722) / 255 : fallback;
  }
}
