import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));

test('registered atlas and assembly distinguish three independent faults at known coordinates', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const n = 24, last = n-1;
  const views = ['top','left','front','rear'] as const;
  const images = views.map(() => new PNG({width:n, height:n}));
  const origins = [[0,0],[last,last],[0,last],[last,last]];
  // Independently project a solid, a low narrow wing, and a high post near the opposite end.
  for (let x = 4; x <= 18; x++) for (let y = 3; y <= 17; y++) for (let z = 3; z <= 13; z++) {
    if (!(x <= 11 && z <= 8 || x >= 12 && y >= 4 && y <= 6 && z >= 6 && z <= 7 ||
        x <= 6 && x >= 5 && y >= 14 && y <= 16 && z >= 9)) continue;
    const coords = [[x,y],[last-y,last-z],[x,last-z],[last-x,last-z]];
    coords.forEach(([u,v],i) => images[i].data[4*(v*n+u)+3] = 255);
  }
  const savePanels = () => views.forEach((view,i) => writeFileSync(join(dir,view+'.png'), PNG.sync.write(images[i])));
  savePanels();
  // JSON is a YAML subset; the locomotive example additionally exercises native YAML syntax.
  const save = (name: string, obj: unknown) => writeFileSync(join(dir,name+'.yaml'), JSON.stringify(obj));
  const atlas = {kind:'atlas', tolerancePx:0,
    views:Object.fromEntries(views.map((v,i) => [v,{image:v+'.png', origin:origins[i], scale:1}])),
    landmarks:[{id:'wingtip',points:{top:[18,5],front:[18,16],left:[18,16],rear:null}}]};
  save('atlas', atlas);
  function run(resource: string, manifest: string, ...args: string[]) {
    const r = spawnSync(process.execPath,[cli,'verify',...(resource ? [resource] : []),'-f',manifest+'.yaml',...args],{cwd:dir,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    return JSON.parse(r.stdout);
  }
  const normal = run('','atlas','--output-dir','qa');
  assert.equal('status' in normal,false);
  assert.equal(normal.results.projections.views.front.unsupportedSamples,0);
  assert.deepEqual(normal.results.landmarks.landmarks[0].hidden,['rear']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'qa/report.json'),'utf8')),normal);
  assert.ok(PNG.sync.read(readFileSync(join(dir,'qa/projections.png'))).width > n);

  // Move only FRONT's wingtip up. TOP and LEFT independently give disjoint depth intervals.
  const front = images[2];
  const old = 4*(16*n+18)+3, shifted = 4*(10*n+18)+3;
  front.data[old] = 0; front.data[shifted] = 255;
  savePanels();
  const broken = run('atlas','atlas','--check','projections').results.projections;
  assert.ok(broken.views.front.unsupportedSamples > 0);
  const tip = broken.views.front.runs.map((r: {sample: unknown})=>r.sample).find((s: {pixel: number[]})=>String(s.pixel)==='18,10');
  assert.equal(tip.gapPx,7);
  assert.deepEqual(tip.scanlines.top.intervals,[[3.5,6.5]]);
  assert.deepEqual(tip.scanlines.left.intervals,[[13.5,16.5]]);
  // A second disjoint run puts TOP's interval inside LEFT's bounding envelope, still in empty space.
  const near = 4*(10*n+last)+3;
  images[1].data[near] = 255; savePanels();
  const islands = run('atlas','atlas','--check','projections').results.projections.views.front.runs;
  const separated = islands.find((r: {sample: {pixel: number[]}})=>String(r.sample.pixel)==='18,10').sample;
  assert.equal(separated.gapPx,3);
  assert.deepEqual(separated.scanlines.left.intervals,[[-0.5,0.5],[13.5,16.5]]);
  images[1].data[near]=0;
  front.data[old]=255; front.data[shifted]=0; savePanels();

  atlas.landmarks[0].points.left=[22,16]; save('atlas',atlas);
  const mark = run('atlas','atlas','--check','landmarks').results.landmarks.landmarks[0];
  const prediction = mark.predictions.find((p: {heldOut: string})=>p.heldOut==='left');
  assert.equal(mark.status,'measured');
  assert.deepEqual(prediction.predicted,[18,16]);
  assert.equal(prediction.errorPx,4);

  const mounts = {top:[{part:[4,3],whole:[4,3]},{part:[11,3],whole:[11,3]}],front:[{part:[4,20],whole:[4,20]}]};
  const part = {atlas:'atlas.yaml',mounts,checks:[{id:'wingtip',view:'left',part:[18,16],whole:[18,16]},
    {id:'hidden',view:'rear',visible:false}]};
  const assembly = {kind:'assembly',tolerancePx:0,whole:'atlas.yaml',parts:{wing:part}};
  save('assembly',assembly);
  const combined = run('','assembly','--output-dir','assembly-qa');
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'assembly-qa/report.json'),'utf8')), combined);
  assert.equal(combined.atlases.whole.results.projections.unsupportedSamples,0);
  assert.equal(combined.atlases.parts.wing.results.landmarks.landmarks[0].predictions.find(
    (p: {heldOut: string})=>p.heldOut==='left').errorPx,4);
  assert.ok(combined.overlays.includes('whole-projections.png'));
  assert.ok(combined.overlays.includes('part-1-projections.png'));
  const fit = combined.results.wing;
  assert.equal(fit.heldOut[0].errorPx,0);
  assert.equal(fit.heldOut[1].status,'occluded');
  for (const mount of mounts.top) mount.whole[1]+=3;
  save('assembly',assembly);
  const slipped = run('assembly','assembly','--part','wing').results.wing;
  assert.equal(slipped.heldOut[0].errorPx,3);

  delete atlas.views.top.origin;
  save('unregistered',{views:atlas.views});
  const missing = run('','unregistered');
  assert.equal(missing.results.projections.status,'registration-needed');
  assert.equal(missing.results.landmarks.status,'skipped');
});
