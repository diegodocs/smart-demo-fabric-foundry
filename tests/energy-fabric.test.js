import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';

const now = new Date().toISOString();
mock.module('../server/fabric.js', {
  exports: {
    fabricConfig: () => ({ pollMs: 100, staleSec: 15 }),
    canPublish: () => false,
    canQuery: () => true,
    getCredential: () => { throw new Error('Tests must not authenticate with Azure.'); },
    latestTelemetry: async () => [
      { machineId: 'RED-CID-001', ts: now, temp: 25, vib: 0, usage: 40.25,
        mode: 'auto', speed: 99.5, isRunning: true, powerKw: 12.5, demandKw: 14, unservedKw: 1.5 },
      { machineId: 'VEH-CAR-001', ts: now, temp: 30, vib: 0, usage: 0,
        mode: 'auto', speed: 100, isRunning: false, batteryPct: 20, chargeKw: 0,
        positionX: 4, positionZ: -2, heading: 0, vehicleState: 'seeking', chargerId: '' },
      { machineId: 'CNC-001', ts: now, isRunning: true, powerKw: 999 },
    ],
  },
});
process.env.API_PORT = '0';
process.env.FABRIC_LOOPBACK = 'false';
const { server } = await import('../server/index.js');
if (!server.listening) await once(server, 'listening');
after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
  server.closeIdleConnections();
}));

test('real Fabric SSE routing preserves native energy measurements and marks missing devices stale', async () => {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/telemetry/stream?scenario=energy`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!/event: telemetry\ndata: .+\n/.test(text)) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      text += decoder.decode(value, { stream: true });
    }
    const { items } = JSON.parse(/event: telemetry\ndata: (.+)\n/.exec(text)[1]);
    assert.equal(items.length, 40);
    assert.equal(items.find((d) => d.machineId === 'RED-CID-001').powerKw, 12.5);
    assert.equal(items.find((d) => d.machineId === 'RED-CID-001').usage, 40.25);
    assert.equal(items.find((d) => d.machineId === 'RED-CID-001').speed, 99.5);
    const car = items.find((d) => d.machineId === 'VEH-CAR-001');
    assert.equal(car.batteryPct, 20);
    assert.equal(car.chargeKw, 0);
    assert.equal(car.vehicleState, 'seeking');
    assert.equal(car.isRunning, false);
    assert.equal(items.find((d) => d.machineId === 'HID-TUR-001').commLost, true);
    assert.ok(!items.some((d) => d.machineId === 'CNC-001'));
  } finally {
    await reader.cancel();
    controller.abort();
  }
});
