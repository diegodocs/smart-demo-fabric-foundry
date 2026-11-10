import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITY_ROUTE, SOLAR_POSITIONS, HOUSE_POSITIONS, CIRCUITS,
  CHARGER_POSITIONS, chargingPath, pathPose, pathLength } from '../app/src/usecases/energy/layout.js';
import { routePose } from '../app/src/domain/routes.js';

test('energy layout has exactly ten rural panels, ten houses and three connected circuits', () => {
  assert.equal(SOLAR_POSITIONS.length, 10);
  assert.equal(HOUSE_POSITIONS.length, 10);
  assert.equal(CIRCUITS.length, 3);
  assert.ok(SOLAR_POSITIONS.every(([x]) => x < -10));
  assert.deepEqual(CIRCUITS[0].poles.at(-1), CIRCUITS[2].poles[0]);
  assert.deepEqual(CIRCUITS[1].poles.at(-1), CIRCUITS[2].poles[0]);
});

test('traffic loop does not intersect residential lots and charging paths reach every bay', () => {
  for (let d = 0; d < CITY_ROUTE.length; d += 0.3) {
    const p = routePose(CITY_ROUTE, d);
    assert.ok(HOUSE_POSITIONS.every(([x, , z]) => Math.hypot(x - p.x, z - p.z) > 3));
  }
  CHARGER_POSITIONS.forEach(([x, , z], n) => {
    const path = chargingPath(n);
    const end = pathPose(path, pathLength(path));
    assert.ok(Math.abs(end.x - (x + 1.9)) < 1e-8);
    assert.equal(end.z, z);
  });
});
