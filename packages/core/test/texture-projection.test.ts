import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconstruct, type Raster } from '../src/index';

function panel(width: number, height: number, color: number, inside = (_x: number, _y: number) => true): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (inside(x, y)) data.set([color, 90, 30, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

for (const meshMethod of ['marching-cubes', 'contour'] as const) {
  test(meshMethod + ' supports independent upper-contour UV selection', () => {
    const views = { top: panel(36, 14, 220), left: panel(14, 18, 40),
      front: panel(36,18,70,(x,y)=>y >= Math.abs(x-18)/5), rear: panel(36,18,100,(x,y)=>y >= Math.abs(x-18)/5) };
    const settings = { meshMethod, layers: 18, resolution: 36 };
    const original = reconstruct(views, 'mesh', settings);
    const mapped = reconstruct(views, 'mesh', {...settings, textureProjection:'top-contour'});
    assert.equal(original.target,'mesh'); assert.equal(mapped.target,'mesh');
    assert.deepEqual(original, reconstruct(views,'mesh',{...settings,textureProjection:'auto'}));
    assert.equal(original.indices.length, mapped.indices.length);
    let remapped = 0, retained = 0;
    for(let i=0;i<original.indices.length;i++) {
      const a:number=original.indices[i], b:number=mapped.indices[i];
      for(let axis=0;axis<3;axis++) assert.equal(original.positions[a*3+axis],mapped.positions[b*3+axis]);
      if(b >= original.positions.length/3) {
        assert.ok(mapped.uvs[b*2]*mapped.texture.width < views.top.width+2);
        remapped++;
      } else retained++;
    }
    assert.ok(remapped && retained);
  });
}
