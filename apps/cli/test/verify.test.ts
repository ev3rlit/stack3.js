import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const cli = process.env.STACK3_TEST_CLI ?? fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));

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
    landmarks:[{id:'wingtip',points:{top:[18,5],front:[18,16],left:[18,16],rear:null}}],
    axisPairs: Object.fromEntries(views.map((v,i) => [v,[{
      points: [[[5,5],[18,16],[5,16],[18,16]][i], [[5,5],[18,16],[5,16],[18,16]][i]],
      evidence: 'Known axis-aligned solid edges in the synthetic source'
    }]]))
  };
  save('atlas', atlas);
  function run(resource: string, manifest: string, ...args: string[]) {
    const r = spawnSync(process.execPath,[cli,'verify',...(resource ? [resource] : []),'-f',manifest+'.yaml',...args],{cwd:dir,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    return JSON.parse(r.stdout);
  }
  const normal = run('','atlas','--output-dir','qa');
  assert.equal(normal.acceptance.verdict,'PASS');
  assert.ok(normal.overlays.includes('atlas-guides.png'));
  writeFileSync(join(dir,'views.json'),JSON.stringify({views:Object.fromEntries(views.map(v=>[v,v+'.png']))}));
  const build = (report = 'qa/report.json', output = 'stack') => spawnSync(process.execPath,
    [cli,'build','views.json','--verification',report,'--format','stack','--output',output,
      '--layers','8','--resolution','16','--no-cache'],{cwd:dir,encoding:'utf8'});
  function rejectsBuild(report: string, message: RegExp) {
    const result = build(report, 'rejected-stack');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, 'rejected-stack')), false);
  }
  const accepted = build();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.ok(existsSync(join(dir, 'stack/stack.png')));
  const extraView = structuredClone(normal);
  extraView.acceptance.inputs.bottom = extraView.acceptance.inputs.top;
  writeFileSync(join(dir,'qa/extra-view.json'),JSON.stringify(extraView));
  rejectsBuild('qa/extra-view.json', /set of atlas views/);
  const sheet = new PNG({width:n*4,height:n});
  images.forEach((image,i) => PNG.bitblt(image,sheet,0,0,n,n,i*n,0));
  writeFileSync(join(dir,'atlas.png'),PNG.sync.write(sheet));
  save('sheet',{...atlas,views:Object.fromEntries(views.map((view,i)=>[
    view,{image:'atlas.png',crop:[i*n,0,n,n],origin:origins[i],scale:1}
  ]))});
  assert.equal(run('','sheet','--output-dir','sheet-qa').acceptance.verdict,'PASS');
  const guardedBuild = spawnSync(process.execPath,[cli,'build','atlas.png','--layout',views.join(','),
    '--verification','sheet-qa/report.json','--format','stack','--output','sheet-stack',
    '--layers','8','--resolution','16','--no-cache'],{cwd:dir,encoding:'utf8'});
  assert.equal(guardedBuild.status,0,guardedBuild.stderr);

  writeFileSync(join(dir,'sheet-qa/atlas-guides.png'),'stale');
  rejectsBuild('sheet-qa/report.json', /guide is missing or stale/);
  rmSync(join(dir,'sheet-qa/atlas-guides.png'));
  rejectsBuild('sheet-qa/report.json', /guide is missing or stale/);
  atlas.axisPairs.front[0].points[1] = [6,16];
  save('atlas',atlas);
  const tilted = run('','atlas','--output-dir','tilted');
  assert.equal(tilted.acceptance.verdict,'FAIL');
  assert.equal(tilted.acceptance.checks.cameras.views.front[0].errorPx,1);
  rejectsBuild('tilted/report.json', /requires a PASS report/);
  atlas.axisPairs.front[0].points[1] = [5,16];
  save('atlas',atlas);
  assert.equal(normal.results.projections.views.front.unsupportedSamples,0);
  assert.deepEqual(normal.results.landmarks.landmarks[0].hidden,['rear']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'qa/report.json'),'utf8')),normal);
  assert.ok(PNG.sync.read(readFileSync(join(dir,'qa/projections.png'))).width > n);

  // Move only FRONT's wingtip up. TOP and LEFT independently give disjoint depth intervals.
  const front = images[2];
  const old = 4*(16*n+18)+3, shifted = 4*(10*n+18)+3;
  front.data[old] = 0; front.data[shifted] = 255;
  savePanels();
  rejectsBuild('qa/report.json', /current FRONT input and mask/);
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
  assert.equal(missing.acceptance.verdict,'UNCONFIRMED');
  assert.equal(missing.results.projections.status,'registration-needed');
  assert.equal(missing.results.landmarks.status,'skipped');
});
