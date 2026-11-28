import * as T from 'three';

const cache = new Map();
function surface(source) {
  if (cache.has(source)) return cache.get(source);
  const cloth = /linen|wool/i.test(source.name);
  if (!cloth && !/oak|walnut/i.test(source.name)) return source;
  const width = 256,
    height = 192,
    data = new Uint8Array(width * height * 4),
    hex = source.color.getHex();
  const base = [hex >> 16, (hex >> 8) & 255, hex & 255];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x / width) * Math.PI * 2,
        v = (y / height) * Math.PI * 2;
      const fiber = v * 25 + 1.3 * Math.sin(u + v * 2) + 0.92 * Math.cos(2 * u - v);
      const grain = cloth
        ? 1 + 0.026 * Math.cos(64 * u) + 0.025 * Math.cos(48 * v)
        : 1 +
          0.041 * Math.sin(fiber) +
          0.024 * Math.sin(3 * fiber + 2 * Math.cos(u)) +
          0.032 * Math.cos(v * 6 + Math.sin(u));
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(base[c] * grain));
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, width, height);
  texture.name = source.name;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const result = source.clone();
  result.color.setHex(0xffffff);
  result.map = texture;
  cache.set(source, result);
  return result;
}
export function applyFinishes(group) {
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.material = surface(mesh.material);
    if (!mesh.material.map) return;
    const { position, normal, uv } = mesh.geometry.attributes;
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new T.Vector3()).toArray();
    // Map the grain along the longer physical dimension of each face.
    for (let i = 0; i < position.count; i++) {
      const axes = [0, 1, 2]
        .sort((a, b) => Math.abs(normal.getComponent(i, b)) - Math.abs(normal.getComponent(i, a)))
        .slice(1)
        .sort((a, b) => size[b] - size[a]);
      uv.setXY(
        i,
        position.getComponent(i, axes[0]) / 0.92 + 0.5,
        position.getComponent(i, axes[1]) / 0.38 + 0.5,
      );
    }
  });
}
