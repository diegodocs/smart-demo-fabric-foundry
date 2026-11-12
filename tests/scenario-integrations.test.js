import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';
import { DEVICE_CATALOGS } from '../server/catalogs.js';
import { telemetrySnapshot } from '../app/src/domain/simulation.js';
import { factoryProfile } from '../app/src/usecases/factory/profile.js';
import { farmProfile } from '../app/src/usecases/farm/profile.js';
import { energyProfile } from '../app/src/usecases/energy/profile.js';
import { miningProfile } from '../app/src/usecases/mining/profile.js';
import { pharmaProfile } from '../app/src/usecases/pharma/profile.js';
import { applyTelemetry, resetScenario, setConnection, store } from '../app/src/core/state.js';
import { buildContext } from '../app/src/integration/agent/context.js';
import { createFoundryAgent } from '../app/src/integration/agent/foundry.js';

const profiles = [factoryProfile, farmProfile, energyProfile, miningProfile, pharmaProfile];
const rows = Object.values(DEVICE_CATALOGS).flatMap((catalog) => {
  const devices = catalog.createAssets();
  const readings = catalog.createSimulation?.(devices).snapshot() || devices.map(telemetrySnapshot);
  return readings.slice(0, -1).map((reading, index) => ({
    ...reading,
    ts: new Date(Date.now() - (index === readings.length - 2 ? 60000 : 0)).toISOString(),
    ...(reading.machineId === 'TRT-001' ? { speedKmh: 7.25, fuel: 61 } : {}),
  }));
});
mock.module('../server/fabric.js', {
  exports: {
    fabricConfig: () => ({ pollMs: 100, staleSec: 15 }),
    canPublish: () => false,
    canQuery: () => true,
    getCredential: () => ({ getToken: async () => ({ token: 'test-token' }) }),
    latestTelemetry: async () => rows,
  },
});
process.env.API_PORT = '0';
process.env.FABRIC_LOOPBACK = 'false';
process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://foundry.test';
process.env.FOUNDRY_AGENT_NAME = 'scenario-agent';
process.env.FOUNDRY_DEBUG = 'false';
const { server } = await import('../server/index.js');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
  server.closeIdleConnections();
}));

async function sample(scenario) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(`${base}/api/telemetry/stream?scenario=${scenario}`, { signal: controller.signal });
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!/event: telemetry\ndata: .+\n/.test(text)) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(/event: telemetry\ndata: (.+)\n/.exec(text)[1]).items;
  } finally {
    clearTimeout(timeout);
    await reader?.cancel();
    controller.abort();
  }
}

test('every profile supports independent Fabric and Foundry modes', () => {
  assert.deepEqual(Object.keys(DEVICE_CATALOGS).sort(), ['energy', 'factory', 'farm', 'mining', 'pharma']);
  for (const profile of profiles) {
    assert.equal(profile.forceMock, false, profile.id);
    for (const telemetry of ['mock', 'fabric']) {
      for (const agent of ['mock', 'foundry']) {
        const badge = profile.envBadge(telemetry, agent);
        assert.equal(badge.includes('Fabric RTI'), telemetry === 'fabric', profile.id);
        assert.equal(badge.includes('Foundry'), agent === 'foundry', profile.id);
      }
    }
  }
});

for (const profile of profiles) {
  test(`${profile.id}: real-query SSE isolates devices, preserves native measurements and marks missing/stale readings`, async () => {
    const assets = DEVICE_CATALOGS[profile.id].createAssets();
    const items = await sample(profile.id);
    const ids = new Set(assets.map((asset) => asset.id));
    assert.equal(items.length, assets.length);
    assert.ok(items.every((reading) => ids.has(reading.machineId)));
    assert.equal(items.find((reading) => reading.machineId === assets.at(-1).id).commLost, true);
    assert.equal(items.find((reading) => reading.machineId === assets.at(-2).id).commLost, true);
    const native = rows.find((reading) => reading.machineId === assets[0].id);
    const received = items.find((reading) => reading.machineId === native.machineId);
    for (const key of Object.keys(native).filter((key) => key !== 'ts')) {
      assert.equal(received[key], native[key], `${profile.id}.${key}`);
    }
    assets.forEach((asset) => { asset.commLost = true; });
    resetScenario(assets, profile.initialKpis, { scenario: profile.id, plant: profile.plant });
    setConnection({ mode: 'fabric' });
    applyTelemetry(items);
    const context = buildContext(store.state);
    assert.equal(context.scenario, profile.id);
    assert.equal(context.machines.at(-1).telemetry, null);
    assert.equal(context.machines[0].telemetry.temp, native.temp);
    if (profile.id === 'farm') {
      assert.equal(store.state.byId['TRT-001'].speedKmh, 7.25);
      assert.equal(context.machines[0].telemetry.fuel, 61);
      applyTelemetry([{ machineId: 'TRT-001', temp: 30, vib: 0, usage: 0, commLost: false }]);
      assert.equal(store.state.byId['TRT-001'].fuel, undefined);
      assert.equal(store.state.byId['TRT-001'].speedKmh, undefined);
    }
    if (profile.id === 'mining') {
      assert.equal(context.machines[0].telemetry.extractedT, native.extractedT);
      assert.equal(store.state.byId['MIN-DIS-003'].deliveredT, undefined);
      assert.equal(store.state.byId['MIN-TER-001'].deliveredT, 0);
      applyTelemetry([{ machineId: 'MIN-SIL-001', commLost: true }]);
      assert.equal(profile.kpiRows(store.state).find((row) => row.label === 'Produto nos silos').value, '—');
    }
    if (profile.id === 'pharma') {
      assert.equal(received.status, 'online');
      assert.equal(received.isRunning, false);
      assert.equal(store.state.byId[native.machineId].status, received.status);
      assert.equal(items.find((reading) => reading.machineId === assets.at(-2).id).status, undefined);
      assert.equal(items.find((reading) => reading.machineId === assets.at(-1).id).status, undefined);
    }
  });

  test(`${profile.id}: Foundry receives scenario and live asset context via the HTTP proxy`, async (t) => {
    const catalog = DEVICE_CATALOGS[profile.id];
    const assets = catalog.createAssets();
    resetScenario(assets, profile.initialKpis, { scenario: profile.id, plant: profile.plant });
    setConnection({ mode: 'fabric' });
    applyTelemetry(await sample(profile.id));
    store.state.selectedId = assets[0].id;
    const context = buildContext(store.state);
    const requests = [];
    const originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (!String(url).startsWith('https://foundry.test/')) return originalFetch(url, options);
      const body = JSON.parse(options.body);
      requests.push(body);
      return Response.json(body.input
        ? { id: 'response_test', status: 'completed', output_text: `Resposta ${profile.id}` }
        : { id: `conversation_${profile.id}` });
    });
    const agent = createFoundryAgent({ apiBase: base });
    const result = await agent.send('Resumo do cenário', context);
    assert.equal(result.text, `Resposta ${profile.id}`);
    const input = requests[1].input;
    assert.ok(input.includes(`Cenário: ${profile.id}`));
    assert.ok(input.includes(profile.plant));
    assert.ok(input.includes(JSON.stringify(context.selected.telemetry)));
    assert.ok(input.includes(JSON.stringify(context.machines)));
    assert.ok(input.endsWith('Resumo do cenário'));
    await agent.send('Mais detalhes', context);
    assert.equal(requests[2].conversation, `conversation_${profile.id}`);
    agent.reset();
    await agent.send('Nova conversa', context);
    assert.deepEqual(requests[3], {});
  });
}

test('pharma ignores Fabric readings for removed assets', async () => {
  const removed = ['PHA-TRK-004', 'PHA-TRK-005', 'PHA-DIS-002', 'PHA-FAR-003'];
  const originalLength = rows.length;
  const template = rows.find((reading) => reading.machineId === 'PHA-TRK-001');
  rows.push(...removed.map((machineId) => ({ ...template, machineId, ts: new Date().toISOString() })));
  try {
    const items = await sample('pharma');
    assert.equal(items.length, 11);
    assert.ok(items.every((reading) => !removed.includes(reading.machineId)));
  } finally {
    rows.length = originalLength;
  }
});

test('farm KPIs do not treat disconnected seed values as live measurements', () => {
  const machines = DEVICE_CATALOGS.farm.createAssets();
  machines.forEach((asset) => { asset.commLost = true; });
  resetScenario(machines, farmProfile.initialKpis, { scenario: 'farm' });
  const rows = farmProfile.kpiRows(store.state);
  assert.equal(rows.find((row) => row.label === 'Combustível médio').value, '—');
  assert.equal(rows.find((row) => row.label === 'Animais monitorados').value, '—');
});
