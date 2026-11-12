import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';
import { createMachines } from '../app/src/usecases/factory/catalog.js';
import { step } from '../app/src/domain/simulation.js';
import { createDeviceControl, applyControlSnapshot } from '../server/deviceControl.js';
import { DEVICE_CATALOGS } from '../server/catalogs.js';

mock.module('../server/fabric.js', {
  exports: {
    fabricConfig: () => ({ pollMs: 50 }),
    canPublish: () => false,
    canQuery: () => false,
    latestTelemetry: () => { throw new Error('Loopback must not query Fabric'); },
    getCredential: () => { throw new Error('Control must not authenticate with Azure'); },
  },
});
process.env.API_PORT = '0';
process.env.API_HOST = '127.0.0.1';
process.env.FABRIC_LOOPBACK = 'true';
const { server } = await import('../server/index.js');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve, reject) => {
  server.close((err) => err ? reject(err) : resolve());
  server.closeIdleConnections();
}));

test('API_HOST limits the proxy listener to the configured interface', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

async function post(path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('HTTP control stops and resumes a separate simulator without Fabric publication', async () => {
  const devices = createMachines();
  const applied = new Map();
  const stop = await post('/api/commands', { machineId: 'FKL-001', command: 'EMERGENCY_STOP' });
  assert.equal(stop.status, 200);
  assert.deepEqual(await stop.json(), { ack: true, delivery: 'local-control' });
  applyControlSnapshot(devices, await (await fetch(`${base}/api/devices/control`)).json(), applied);
  const forklift = devices.find((d) => d.id === 'FKL-001');
  assert.equal(forklift.params.mode, 'off');
  assert.equal(forklift.params.speed, 0);
  const telemetry = { eventType: 'telemetry', ...step(forklift), mode: forklift.params.mode, speed: forklift.params.speed };
  assert.equal(telemetry.eventType, 'telemetry');
  assert.equal(telemetry.mode, 'off');
  assert.equal(telemetry.speed, 0);
  assert.equal(telemetry.isRunning, false);
  assert.equal(typeof telemetry.temp, 'number');
  assert.equal(telemetry.command, undefined);

  assert.equal((await post('/api/commands', { machineId: 'FKL-001', command: 'RESUME' })).status, 200);
  applyControlSnapshot(devices, await (await fetch(`${base}/api/devices/control`)).json(), applied);
  assert.equal(forklift.params.mode, 'auto');
  assert.equal(forklift.params.speed, forklift.defaults.speed);
  assert.equal(step(forklift).isRunning, true);
});

test('parameter adjustments reach the simulated device over HTTP', async () => {
  const devices = createMachines();
  const device = devices.find((d) => d.id === 'CNC-001');
  const params = { ...device.params, speed: 65.5, targetTemp: 60 };
  assert.equal((await post('/api/params', { machineId: device.id, params })).status, 200);
  const response = await fetch(`${base}/api/devices/control`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  applyControlSnapshot(devices, await response.json(), new Map());
  assert.deepEqual(device.params, params);
  assert.equal(step(device).speed, 65.5);
});

test('invalid commands, machine IDs and parameter modes are rejected', async () => {
  assert.equal((await post('/api/commands', { machineId: 'FKL-001', command: 'INVALID' })).status, 400);
  assert.equal((await post('/api/commands', { machineId: 'INVALID', command: 'PAUSE' })).status, 400);
  assert.equal((await post('/api/params', { machineId: 'CNC-001', params: {} })).status, 400);
  const params = { ...createMachines()[0].params, mode: 'toString' };
  assert.equal((await post('/api/params', { machineId: 'CNC-001', params })).status, 400);
});

test('calibration applies once per revision and survives skipped control snapshots', () => {
  const control = createDeviceControl();
  const devices = createMachines();
  const applied = new Map();
  const d = devices[0];
  const initialVib = d.vib;
  control.command(d.id, 'CALIBRATE');
  control.command(d.id, 'CALIBRATE');
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(d.vib, initialVib * 0.75 ** 2);
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(d.vib, initialVib * 0.75 ** 2);
  control.setParams(d.id, { ...d.params, speed: 80 });
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(d.vib, initialVib * 0.75 ** 2);
  assert.equal(d.params.speed, 80);
});

test('resume reconnects an offline device and a proxy restart restores defaults', () => {
  const control = createDeviceControl();
  const devices = createMachines();
  const applied = new Map();
  const robot = devices.find((d) => d.id === 'ROB-003');
  control.devices[robot.id].commLost = true;
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(robot.commLost, true);
  control.command(robot.id, 'RESUME');
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(robot.commLost, false);
  assert.equal(robot.params.speed, 100);
  control.command(devices[0].id, 'EMERGENCY_STOP');
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(devices[0].params.mode, 'off');
  applyControlSnapshot(devices, createDeviceControl().snapshot(), applied);
  assert.equal(devices[0].params.mode, 'auto');
  assert.equal(robot.commLost, false);
  assert.equal(robot.params.mode, 'off');
  assert.equal(robot.params.speed, 0);
});

test('loopback SSE reports the resulting mode and speed', async () => {
  await post('/api/commands', { machineId: 'FKL-002', command: 'EMERGENCY_STOP' });
  const abort = new AbortController();
  const response = await fetch(`${base}/api/telemetry/stream`, { signal: abort.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('event: telemetry')) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      text += decoder.decode(value, { stream: true });
    }
    const match = /event: telemetry\ndata: (.+)\n/.exec(text);
    assert.ok(match);
    const d = JSON.parse(match[1]).items.find((item) => item.machineId === 'FKL-002');
    assert.equal(d.mode, 'off');
    assert.equal(d.speed, 0);
    assert.equal(d.isRunning, false);
    const initial = createMachines().find((device) => device.id === d.machineId);
    for (const field of ['temp', 'vib', 'usage']) assert.equal(d[field], initial[field]);
  } finally {
    abort.abort();
    await reader.cancel().catch((e) => {
      if (e.name !== 'AbortError') throw e;
    });
  }
});

for (const scenario of ['farm', 'mining', 'pharma']) {
  test(`${scenario}: HTTP controls use the catalog schema, reject cross-scenario IDs and stream native loopback telemetry`, async () => {
    const catalog = DEVICE_CATALOGS[scenario];
    const devices = catalog.createAssets();
    const device = devices[0];
    const control = await (await fetch(`${base}/api/devices/control?scenario=${scenario}`)).json();
    assert.equal(control.items.length, devices.length);
    const params = { ...device.params, speed: 70 };
    assert.equal((await post('/api/params', { scenario, machineId: device.id, params })).status, 200);
    assert.equal((await post('/api/params', { scenario, machineId: device.id, params: { ...params, speed: -1 } })).status, 400);
    assert.equal((await post('/api/params', { scenario, machineId: device.id, params: { mode: 'auto', speed: 70 } })).status, 400);
    assert.equal((await post('/api/commands', { scenario, machineId: 'CNC-001', command: 'PAUSE' })).status, 400);
    assert.equal((await post('/api/params', { scenario, machineId: 'CNC-001', params })).status, 400);
    if (scenario === 'farm') {
      assert.equal((await post('/api/commands', { scenario, machineId: 'BOV-001', command: 'SPEED_UP' })).status, 400);
    }
    assert.equal((await post('/api/commands', { scenario, machineId: device.id, command: 'PAUSE' })).status, 200);
    const applied = new Map();
    applyControlSnapshot(devices, await (await fetch(`${base}/api/devices/control?scenario=${scenario}`)).json(), applied);
    assert.equal(device.params.mode, 'paused');
    assert.equal(device.params.speed, 70);

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    let reader;
    try {
      const response = await fetch(`${base}/api/telemetry/stream?scenario=${scenario}`, { signal: abort.signal });
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!/event: telemetry\ndata: .+\n/.test(text)) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        text += decoder.decode(value, { stream: true });
      }
      const items = JSON.parse(/event: telemetry\ndata: (.+)\n/.exec(text)[1]).items;
      assert.equal(items.length, devices.length);
      const reading = items.find((item) => item.machineId === device.id);
      assert.equal(reading.mode, 'paused');
      assert.equal(reading.speed, 70);
      assert.equal(reading.isRunning, false);
      if (scenario === 'farm') {
        assert.equal(reading.fuel, device.fuel);
        assert.equal(items.find((item) => item.machineId === 'SUI-003').nh3,
          devices.find((item) => item.id === 'SUI-003').nh3);
      } else if (scenario === 'mining') {
        assert.equal(reading.extractedT, 31);
        assert.equal(items.find((item) => item.machineId === 'MIN-TRK-001').vehicleState, 'loading');
      } else {
        assert.equal(reading.inventoryUnits, 0);
        assert.equal(reading.batchId, '');
        assert.equal(items.find((item) => item.machineId === 'PHA-TRK-001').temp, 5);
        assert.ok(items.every((item) => item.commLost === false));
        for (const id of ['PHA-TRK-003']) {
          const truck = items.find((item) => item.machineId === id);
          assert.equal(truck.isRunning, false);
          assert.equal(truck.speedKmh, 0);
        }
      }
    } finally {
      clearTimeout(timeout);
      await reader?.cancel();
      abort.abort();
    }
    assert.equal((await post('/api/commands', { scenario, machineId: device.id, command: 'RESUME' })).status, 200);
    applyControlSnapshot(devices, await (await fetch(`${base}/api/devices/control?scenario=${scenario}`)).json(), applied);
    assert.equal(device.params.mode, 'auto');
    assert.equal(device.params.speed, 70);
  });
}

test('farm herd calibration matches the local mock and is applied once per revision', () => {
  const catalog = DEVICE_CATALOGS.farm;
  const control = createDeviceControl(catalog.createAssets);
  const devices = catalog.createAssets();
  const herd = devices.find((device) => device.id === 'BOV-002');
  const outside = herd.outside;
  const applied = new Map();
  control.command(herd.id, 'CALIBRATE');
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(herd.outside, Math.max(0, outside - 1));
  assert.equal(control.devices[herd.id].outside, herd.outside);
  applyControlSnapshot(devices, control.snapshot(), applied);
  assert.equal(herd.outside, Math.max(0, outside - 1));
});

test('every added mining asset accepts scenario-isolated parameters and commands', async () => {
  const devices = DEVICE_CATALOGS.mining.createAssets().slice(8);
  assert.equal(devices.length, 13);
  for (const device of devices) {
    assert.equal((await post('/api/params', {
      scenario: 'mining', machineId: device.id, params: { ...device.params, speed: 80 },
    })).status, 200);
    assert.equal((await post('/api/commands', {
      scenario: 'mining', machineId: device.id, command: 'PAUSE',
    })).status, 200);
  }
  const control = await (await fetch(`${base}/api/devices/control?scenario=mining`)).json();
  assert.equal(control.items.length, 21);
  for (const device of devices) {
    const item = control.items.find((reading) => reading.machineId === device.id);
    assert.equal(item.params.mode, 'paused');
    assert.equal(item.params.speed, 80);
    assert.equal((await post('/api/commands', {
      scenario: 'farm', machineId: device.id, command: 'RESUME',
    })).status, 400);
  }
});

test('remaining added pharma assets accept scenario-isolated parameters and commands', async () => {
  const devices = DEVICE_CATALOGS.pharma.createAssets().slice(8);
  assert.equal(devices.length, 3);
  for (const device of devices) {
    assert.equal((await post('/api/params', {
      scenario: 'pharma', machineId: device.id, params: { ...device.params, speed: 80 },
    })).status, 200);
    assert.equal((await post('/api/commands', {
      scenario: 'pharma', machineId: device.id, command: 'PAUSE',
    })).status, 200);
  }
  const control = await (await fetch(`${base}/api/devices/control?scenario=pharma`)).json();
  assert.equal(control.items.length, 11);
  for (const device of devices) {
    const item = control.items.find((reading) => reading.machineId === device.id);
    assert.equal(item.params.mode, 'paused');
    assert.equal(item.params.speed, 80);
    assert.equal((await post('/api/commands', {
      scenario: 'mining', machineId: device.id, command: 'RESUME',
    })).status, 400);
  }
});

test('removed pharma assets are absent from controls and reject commands and parameters', async () => {
  const removed = ['PHA-TRK-004', 'PHA-TRK-005', 'PHA-DIS-002', 'PHA-FAR-003'];
  const control = await (await fetch(`${base}/api/devices/control?scenario=pharma`)).json();
  const params = DEVICE_CATALOGS.pharma.createAssets()[0].params;
  for (const machineId of removed) {
    assert.ok(!control.items.some((item) => item.machineId === machineId));
    assert.equal((await post('/api/commands', { scenario: 'pharma', machineId, command: 'PAUSE' })).status, 400);
    assert.equal((await post('/api/params', { scenario: 'pharma', machineId, params })).status, 400);
  }
});
