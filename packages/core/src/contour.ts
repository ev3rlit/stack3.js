import { contours } from 'd3-contour';
import earcut from 'earcut';
import simplify from 'simplify-js';
import type { MeshData } from './reconstruct';
import type { Direction, Raster, ViewSet } from './views';

type Point = { x: number; y: number };
type Vec3 = MeshData['size'];
type Tiles = Map<Direction, { image: Raster; left: number }>;

// Extend surface colour across transparent texels for bilinear filtering at the cut edge.
export function bleedEdges(image: Raster): Raster {
  const { width, height } = image;
  const data = image.data.slice();
  const queue = new Int32Array(width * height);
  let read = 0, write = 0;
  for (let i = 0; i < queue.length; i++) if (data[i * 4 + 3] >= 128) queue[write++] = i;
  function spread(from: number, to: number) {
    if (data[to * 4 + 3] >= 128) return;
    data.set(data.subarray(from * 4, from * 4 + 3), to * 4);
    data[to * 4 + 3] = 255;
    queue[write++] = to;
  }
  while (read < write) {
    const i = queue[read++], x = i % width;
    if (x) spread(i, i - 1);
    if (x + 1 < width) spread(i, i + 1);
    if (i >= width) spread(i, i - width);
    if (i + width < queue.length) spread(i, i + width);
  }
  return { width, height, data };
}

function outline(image: Raster): Point[][][] {
  const { width, height, data } = image;
  const alpha = new Array<number>(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return contours().size([width, height]).contour(alpha, 127.5).coordinates.map(polygon =>
    polygon.map((ring, index) => {
      const raw = ring.map(([x, y]) => ({ x, y }));
      const reduced = simplify(raw, .75, true);
      const points = (reduced.length >= 4 ? reduced : raw).slice(0, -1);
      const area = points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length];
        return sum + a.x * b.y - b.x * a.y;
      }, 0);
      if ((area > 0) !== (index === 0)) points.reverse();
      return points.map(p => ({ x: p.x / width, y: p.y / height }));
    }));
}

function containsCenter(ring: Point[]) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.y > .5) !== (b.y > .5) && .5 < a.x + (.5 - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

function columnSpan(image: Raster, x: number): [number, number] | undefined {
  let first = image.height, last = -1;
  for (let y = 0; y < image.height; y++) if (image.data[4 * (y * image.width + x) + 3] >= 128) {
    first = Math.min(first, y); last = y;
  }
  if (last >= first) return [first / image.height, (last + 1) / image.height];
}

// TOP supplies the thin plate's depth away from the axle. LEFT supplies the
// diameter of the projecting collar. Limit the collar to the available FRONT material.
function measureHub(views: ViewSet, rings: Point[][], [width, , height]: Vec3) {
  const top = views.top!, left = views.left!;
  const widths: number[] = [];
  for (let x = 0; x < top.width; x++) {
    const span = columnSpan(top, x);
    if (span) widths.push(span[1] - span[0]);
  }
  widths.sort((a, b) => a - b);
  const plate = widths[Math.floor(widths.length / 2)];
  if (!(plate > 0 && plate < 1)) throw new Error('Contour hub needs a projecting axle in TOP.');
  let clearance = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const x = (a.x - .5) * width, y = (a.y - .5) * height;
    const dx = (b.x - a.x) * width, dy = (b.y - a.y) * height;
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    clearance = Math.min(clearance, Math.hypot(x + t * dx, y + t * dy));
  }
  const spans = [.12, .88].map(u => columnSpan(left, Math.floor(u * left.width)));
  if (spans.some(s => !s)) throw new Error('Contour hub needs a centered collar in LEFT.');
  const radii = spans.map(s => Math.min((s![1] - s![0]) * height / 2, clearance * .95));
  return { plate, radii };
}

export function extrudeContours(views: ViewSet, size: Vec3, pivot: Vec3, front: Raster,
  tiles: Tiles, texture: Raster, withHub: boolean, segments: number): MeshData {
  const [width, depth, height] = size;
  const polygons = outline(front);
  if (!polygons.length) throw new Error('Empty FRONT contour.');
  const centered = withHub ? polygons.find(rings => containsCenter(rings[0]) && !rings.slice(1).some(containsCenter)) : undefined;
  if (withHub && !centered) throw new Error('Contour hub needs solid material at the center of FRONT.');
  const hub = centered && measureHub(views, centered, size);
  const half = depth * (hub?.plate ?? 1) / 2;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  function vertex(p: Point, z: number, n: Vec3, direction: Direction): number {
    const i = positions.length / 3;
    positions.push((p.x - .5) * width, (1 - p.y) * height - pivot[2], z);
    normals.push(...n);
    const d = z / depth + .5;
    let u = p.x, v = p.y;
    if (direction === 'rear') u = 1 - u;
    if (direction === 'top') v = 1 - d;
    if (direction === 'bottom') v = d;
    if (direction === 'left') u = d;
    if (direction === 'right') u = 1 - d;
    const tile = tiles.get(direction)!;
    uvs.push((tile.left + .5 + u * (tile.image.width - 1)) / texture.width,
      (1.5 + v * (tile.image.height - 1)) / texture.height);
    return i;
  }
  function circle(radius: number): Point[] {
    return Array.from({ length: segments }, (_, i) => {
      const angle = -2 * Math.PI * i / segments;
      return { x: .5 + radius * Math.cos(angle) / width, y: .5 + radius * Math.sin(angle) / height };
    });
  }
  function cap(rings: Point[][], z: number, side: number) {
    const holes: number[] = [], xy: number[] = [];
    const base = positions.length / 3;
    for (const [i, ring] of rings.entries()) {
      if (i) holes.push(xy.length / 2);
      for (const p of ring) {
        xy.push(p.x, p.y);
        vertex(p, z, [0, 0, side], side < 0 ? 'front' : 'rear');
      }
    }
    const triangles = earcut(xy, holes);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = base + triangles[i], b = base + triangles[i + 1], c = base + triangles[i + 2];
      if (side < 0) indices.push(a, b, c); else indices.push(a, c, b);
    }
  }
  function collar(radius: number, side: number, root: Point[]) {
    // A short shoulder, straight barrel and bevelled lip share one watertight boundary with the plate.
    const length = depth / 2 - half;
    const sections = [[0, 1], [.38, 1], [.44, .93], [.87, .93], [1, .82]];
    let previous = root;
    for (let j = 1; j < sections.length; j++) {
      const [t, r] = sections[j], [t0, r0] = sections[j - 1];
      const next = circle(radius * r);
      const slope = (r0 - r) * radius / ((t - t0) * length);
      const mag = Math.hypot(1, slope);
      const base = positions.length / 3;
      for (let i = 0; i < segments; i++) {
        const angle = -2 * Math.PI * i / segments;
        const n: Vec3 = [Math.cos(angle) / mag, -Math.sin(angle) / mag, side * slope / mag];
        vertex(previous[i], side * (half + t0 * length), n, 'left');
        vertex(next[i], side * (half + t * length), n, 'left');
      }
      for (let i = 0; i < segments; i++) {
        const a = base + i * 2, b = base + ((i + 1) % segments) * 2;
        if (side > 0) indices.push(a, b, b + 1, a, b + 1, a + 1);
        else indices.push(a, b + 1, b, a, a + 1, b + 1);
      }
      previous = next;
    }
    cap([previous], side * depth / 2, side);
  }
  for (const rings of polygons) {
    for (const side of [-1, 1]) {
      if (rings === centered && hub) {
        const radius = hub.radii[side < 0 ? 0 : 1], root = circle(radius);
        cap([...rings, root], side * half, side);
        collar(radius, side, root);
      } else cap(rings, side * half, side);
    }
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = (b.x - a.x) * width, dy = (b.y - a.y) * height, mag = Math.hypot(dx, dy);
      if (!mag) continue;
      const n: Vec3 = [dy / mag, dx / mag, 0];
      const direction = Math.abs(n[1]) >= Math.abs(n[0])
        ? n[1] < 0 && views.bottom ? 'bottom' : 'top'
        : n[0] > 0 && views.right ? 'right' : 'left';
      const start = vertex(a, -half, n, direction);
      vertex(b, -half, n, direction); vertex(b, half, n, direction); vertex(a, half, n, direction);
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
    }
  }
  return { target: 'mesh', positions: Float32Array.from(positions), normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs), texture, size, pivot };
}
