import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

test('guided fits remove measured noise, optimize relations and guard mesh vertices', () => {
  const script = String.raw`
import sys
import numpy as np
sys.path.insert(0, sys.argv[1])
from regularization import optimize_planes, plane_fit, polygon_constraints, round_constraints, safe_displacement

coordinates = np.linspace(-1, 1, 9)
a,b = [value.ravel() for value in np.meshgrid(coordinates, coordinates)]
points = np.c_[a,b,0.03*a]
side = np.c_[0.03*a,b,a]
plane = plane_fit(points, np.tile([0,0,1],(len(a),1)),
                  {"bounds":[[-2,-2,-2],[2,2,2]], "normal":[0,0,1]}, 0.1)
wall = plane_fit(side, np.tile([1,0,0],(len(a),1)),
                 {"bounds":[[-2,-2,-2],[2,2,2]], "normal":[1,0,0]}, 0.1)
assert plane and wall
assert abs(np.dot(plane[2], [0,0,1])) > 0.999
cloud = np.vstack((points, side))
planes = {"front":plane, "side":(wall[0]+len(points),wall[1],wall[2])}
before = abs(plane[2]@wall[2])
fitted,count,error = optimize_planes(cloud,planes,[{"type":"perpendicular","features":["front","side"]}],0.1)
assert count == 1 and error < before/10, (before,error)
assert abs(fitted["front"][0]@fitted["side"][0]) < before/10

theta = np.arange(32)*2*np.pi/32
rho = 1+0.025*np.sin(5*theta)
unit_xy = np.c_[np.cos(theta),np.sin(theta)]
normals = np.c_[unit_xy,np.zeros(len(theta))]
coords = np.c_[unit_xy*rho[:,None],.012*np.cos(3*theta)]
for kind in ("circle","cylinder"):
    config = {"type":kind,"center":[0,0,0],"axis":[0,0,1],"radius":1,"bounds":[[-2,-2,-2],[2,2,2]]}
    fitted = round_constraints(coords,normals,config,0.1)
    assert len(fitted)==(2 if kind=="circle" else 1)
    result=coords.copy()
    for ids,directions,errors in fitted:
        result[ids]+=directions*errors[:,None]
    assert np.std(np.linalg.norm(result[:,:2],axis=1)) < 1e-7
    if kind=="circle":
        assert np.ptp(result[:,2]) < 1e-7

corners=np.array([[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]])
t=np.linspace(.18,.82,11)
points=[]
for a,b in zip(corners,np.roll(corners,-1,axis=0)):
    delta=b-a
    points.extend(a+t[:,None]*delta+np.sin(t[:,None]*17)*np.array([-delta[1],delta[0],1])*.008)
points=np.asarray(points)
fitted=polygon_constraints(points,{"id":"square","corners":corners},.08)
assert len(fitted)==5
result=points.copy()
for ids,directions,errors in fitted:
    result[ids]+=directions*errors[:,None]
assert np.ptp(result[:,2]) < 1e-8
assert np.linalg.svd(result[:11]-result[:11].mean(axis=0),compute_uv=False)[1] < 1e-6

points=np.array([[0,0,0],[1,0,0],[0,1,0],[4,0,0],[5,0,0],[4,1,0]],float)
moves=np.array([[1,0,0],[0,0,0],[0,0,0],[0,0,.1],[0,0,.1],[0,0,.1]])
result=safe_displacement(points,np.array([[0,1,2],[3,4,5]]),moves)
assert np.array_equal(result[:3],points[:3])
assert np.allclose(result[3:,2],.1)
`;
  const python = process.env.STACK3_PYTHON;
  const meshing = fileURLToPath(new URL('../meshing/', import.meta.url));
  const args = python ? [] : ['run', '--no-project', '--with', 'numpy==2.2.6', '--with', 'scipy==1.15.3',
    '--with', 'shapely==2.1.2', 'python'];
  const result = spawnSync(python || 'uv', [...args, '-c', script, meshing], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('pipeline render rejects a plane relation pointing to a non-plane feature', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stack3-regularization-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const recipe = join(dir, 'invalid.yaml');
  const plane = { id: 'front', type: 'plane', normal: [0,1,0], bounds: [[0,0,0],[1,1,1]] };
  const circle = { id: 'rim', type: 'circle', center: [0,0,0], axis: [0,1,0], radius: 1 };
  writeFileSync(recipe, stringify({version:1, nodes:[
    { id:'source', type:'load-stack', path:'input' },
    { id:'mesh', type:'extract-mesh', input:'source', method:'mc33', finish:{regularization:{
      tolerance:.01, features:[plane,circle], relations:[{type:'parallel',features:['front','rim']}],
    }} },
    { id:'export', type:'write-glb', input:'mesh', path:'out.glb' },
  ]}));
  const cli = fileURLToPath(new URL('../bin/stack3.mjs', import.meta.url));
  const result = spawnSync(process.execPath,[cli,'pipeline','render',recipe],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/must name two different plane features/);
});
