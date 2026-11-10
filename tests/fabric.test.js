import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import { createMachines } from '../app/src/usecases/factory/catalog.js';
import { step, telemetrySnapshot } from '../app/src/domain/simulation.js';
import { createFabricSource } from '../app/src/integration/telemetry/fabric.js';
import { DEVICE_CATALOGS } from '../server/catalogs.js';

const sent = [];
const credentialOptions = [];
const tokenRequests = [];
mock.module('@azure/event-hubs', {
  exports: { EventHubProducerClient: class {
    async createBatch() {
      return { events: [], tryAdd(e) { this.events.push(e); return true; } };
    }
    async sendBatch(batch) { sent.push(...batch.events); }
    async close() {}
  } },
});
mock.module('@azure/identity', {
  exports: { DefaultAzureCredential: class {
    constructor(options) { this.options = options; credentialOptions.push(options); }
    async getToken(scope) { tokenRequests.push({ scope, options: this.options }); return { token: 'test' }; }
  } },
});
const { publish, latestTelemetry, closeFabric, fabricConfig, getCredential, kql } = await import('../server/fabric.js');

test('Fabric source clears a polling error only after successful telemetry resumes', () => {
  const OriginalEventSource = globalThis.EventSource;
  let eventSource;
  globalThis.EventSource = class {
    constructor(url) { this.url = url; this.listeners = {}; eventSource = this; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    close() { this.closed = true; }
  };
  try {
    const statuses = [], readings = [];
    const source = createFabricSource({ scenario: 'pharma' });
    source.start({ onStatus: (value) => statuses.push(value.status), onTelemetry: (items) => readings.push(items) });
    eventSource.onopen();
    eventSource.listeners.status({ data: JSON.stringify({ status: 'error', detail: 'Eventhouse indisponível' }) });
    assert.deepEqual(statuses, ['connecting', 'connected', 'error']);
    eventSource.listeners.telemetry({ data: JSON.stringify({ items: [{ machineId: 'PHA-TRK-001' }] }) });
    assert.deepEqual(statuses, ['connecting', 'connected', 'error', 'connected']);
    assert.equal(readings.length, 1);
    eventSource.onerror();
    eventSource.onopen();
    assert.deepEqual(statuses.slice(-2), ['error', 'connected']);
    source.stop();
    assert.equal(eventSource.closed, true);
  } finally {
    if (OriginalEventSource === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = OriginalEventSource;
  }
});

test('documented KQL schemas support fractional utilization and speed', async () => {
  for (const path of ['../README.md', '../docs/setup-fabric-foundry.md']) {
    const content = await readFile(new URL(path, import.meta.url), 'utf8');
    const schema = content.match(/\.create table MachineTelemetry\s*\(([^)]*)\)/);
    assert.ok(schema, `Missing MachineTelemetry schema in ${path}`);
    for (const field of ['usage', 'speed']) {
      assert.match(schema[1], new RegExp(`\\b${field}\\s*:\\s*real\\b`), `${path}: ${field}`);
    }
  }
});

test('Fabric publisher accepts only telemetry and skips empty batches', async () => {
  const c = { connectionString: 'test' };
  await assert.rejects(publish([{ eventType: 'params' }], c), /somente/);
  await assert.rejects(publish([{ eventType: 'command' }], c), /somente/);
  await publish([], c);
  assert.equal(sent.length, 0);
  const e = { eventType: 'telemetry', machineId: 'FKL-001', mode: 'off', speed: 0, isRunning: false };
  await publish([e], c);
  assert.deepEqual(sent[0].body, e);
  assert.equal(sent[0].properties.eventType, 'telemetry');
  await closeFabric();
});

test('Event Hubs receives a telemetry object rather than a pre-stringified JSON body', async () => {
  const event = {
    eventType: 'telemetry', scenario: 'farm', machineId: 'TRT-001', fuel: 71, isRunning: true,
  };
  await publish([event], { connectionString: 'test' });
  const { body, contentType } = sent.at(-1);
  assert.equal(typeof body, 'object');
  assert.strictEqual(body, event);
  assert.deepEqual(body, event);
  assert.equal(contentType, 'application/json');
  await closeFabric();
});

test('latest telemetry queries operation state with compatibility for older schemas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const { csl } = JSON.parse(options.body);
    assert.match(csl, /column_ifexists\("isRunning", bool\(null\)\)/);
    assert.match(csl, /tobool\(column_ifexists\("isRunning", bool\(null\)\)\)/);
    assert.match(csl, /coalesce\(mode !in \("off", "paused"\) and speed > 0, false\)/);
    assert.match(csl, /arg_max\(ts, \*\)/);
    assert.match(csl, /powerKw = todouble\(column_ifexists\("powerKw", real\(null\)\)\)/);
    assert.match(csl, /vehicleState = tostring\(column_ifexists\("vehicleState", ""\)\)/);
    for (const key of ['fuel', 'headcount', 'speedKmh', 'throughputTph', 'inventoryT', 'payloadT', 'extractedT', 'tailingsT', 'deliveredT']) {
      assert.ok(csl.includes(`${key} = todouble(column_ifexists("${key}", real(null)))`), key);
    }
    return { ok: true, json: async () => ({ Tables: [{
      Columns: ['machineId', 'mode', 'speed', 'isRunning'].map((ColumnName) => ({ ColumnName })),
      Rows: [['FKL-001', 'off', 0, false]],
    }] }) };
  };
  try {
    assert.deepEqual(await latestTelemetry({
      kustoUri: 'https://kusto.test', database: 'test', scope: 'test', telemetryTable: 'MachineTelemetry',
    }), [{ machineId: 'FKL-001', mode: 'off', speed: 0, isRunning: false }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('Fabric uses its configured tenant without changing the default Foundry credential', async () => {
  const previousTenant = process.env.FABRIC_KUSTO_TENANT_ID;
  const overrideKeys = ['EVENTSTREAM_CONNECTION_STRING', 'EVENTSTREAM_NAME', 'KUSTO_URI',
    'KUSTO_DATABASE', 'TELEMETRY_TABLE', 'KUSTO_TENANT_ID'].map((key) => `FABRIC_FACTORY_${key}`);
  const previousOverrides = new Map(overrideKeys.map((key) => [key, process.env[key]]));
  for (const key of overrideKeys) delete process.env[key];
  process.env.FABRIC_KUSTO_TENANT_ID = 'fabric-tenant';
  const defaultCredential = getCredential();
  const createdBefore = credentialOptions.length;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ Tables: [] }) });
  try {
    assert.equal(fabricConfig().tenantId, 'fabric-tenant');
    const config = { kustoUri: 'https://kusto.test', database: 'test', scope: 'kusto-scope', tenantId: 'fabric-tenant' };
    await kql('print 1', config);
    await kql('print 2', config);
    assert.deepEqual(credentialOptions.slice(createdBefore), [{ tenantId: 'fabric-tenant' }]);
    assert.deepEqual(tokenRequests.at(-1), { scope: 'kusto-scope', options: { tenantId: 'fabric-tenant' } });
    assert.equal(getCredential(), defaultCredential);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousTenant === undefined) delete process.env.FABRIC_KUSTO_TENANT_ID;
    else process.env.FABRIC_KUSTO_TENANT_ID = previousTenant;
    for (const [key, value] of previousOverrides) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('simulator payload preserves boolean isRunning in the Event Hubs body', async () => {
  const device = createMachines()[0];
  for (const mode of ['auto', 'off']) {
    device.params.mode = mode;
    const event = {
      eventType: 'telemetry', ...step(device, 2),
      mode: device.params.mode, speed: device.params.speed,
    };
    await publish([event], { connectionString: 'test' });
    const body = JSON.parse(JSON.stringify(sent.at(-1).body));
    assert.equal(typeof body.isRunning, 'boolean');
    assert.equal(body.isRunning, mode === 'auto');
    assert.equal(body.eventType, 'telemetry');
  }
  await closeFabric();
});

test('first Fabric batch contains the same operation state and readings as the initial UI', async () => {
  const initial = createMachines();
  const events = createMachines().map(telemetrySnapshot).filter(Boolean)
    .map((reading) => ({ eventType: 'telemetry', ...reading }));
  const offset = sent.length;
  await publish(events, { connectionString: 'test' });
  const batch = sent.slice(offset);
  assert.equal(batch.length, 16);
  for (const { body } of batch) {
    const m = initial.find((device) => device.id === body.machineId);
    assert.equal(body.isRunning, m.isRunning, m.id);
    for (const field of ['temp', 'vib', 'usage']) assert.equal(body[field], m[field], `${m.id}.${field}`);
    assert.equal(body.mode, m.params.mode);
    assert.equal(body.speed, m.params.speed);
  }
  assert.equal(batch.find(({ body }) => body.machineId === 'ROB-003').body.isRunning, false);
  await closeFabric();
});

test('every scenario publishes its native readings and scenario ID unchanged to Eventstream', async () => {
  for (const [scenario, catalog] of Object.entries(DEVICE_CATALOGS)) {
    const devices = catalog.createAssets();
    const readings = catalog.createSimulation?.(devices).snapshot() || devices.map(telemetrySnapshot);
    const events = readings.map((reading) => ({ eventType: 'telemetry', scenario, ...reading }));
    const offset = sent.length;
    await publish(events, { connectionString: 'test' });
    assert.deepEqual(sent.slice(offset).map(({ body }) => body), events);
    if (scenario === 'farm') {
      assert.equal(events.find((event) => event.machineId === 'BOV-001').headcount, 48);
      assert.equal(events.find((event) => event.machineId === 'TRT-001').fuel, 71);
    }
    if (scenario === 'energy') {
      assert.ok(events.some((event) => !Number.isInteger(event.usage)), 'fractional usage must remain unrounded');
    }
    if (scenario === 'mining') {
      assert.equal(events.find((event) => event.machineId === 'MIN-EXC-001').extractedT, 31);
      assert.equal(events.find((event) => event.machineId === 'MIN-TRK-001').vehicleState, 'loading');
    }
  }
  await closeFabric();
});
