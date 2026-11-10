import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';
import { DEVICE_CATALOGS } from '../server/catalogs.js';

const originalEnv = { ...process.env };
for (const key of Object.keys(process.env)) {
  if (/^(FABRIC_|FOUNDRY_|DEVICE_|API_|SCENARIO$)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  API_PORT: '0',
  API_HOST: '127.0.0.1',
  FABRIC_LOOPBACK: 'true',
  FABRIC_EVENTSTREAM_CONNECTION_STRING: 'fake-shared-connection',
  FABRIC_EVENTSTREAM_NAME: 'shared-stream',
  FABRIC_KUSTO_URI: 'https://shared.kusto.test/',
  FABRIC_KUSTO_DATABASE: 'SharedDb',
  FABRIC_KUSTO_TENANT_ID: 'shared-tenant',
  FABRIC_TELEMETRY_TABLE: 'SharedTelemetry',
  FABRIC_KUSTO_SCOPE: 'test-scope',
  FABRIC_POLL_MS: '1000',
  FABRIC_STALE_SEC: '60',
  FABRIC_FACTORY_EVENTSTREAM_CONNECTION_STRING: 'fake-factory-connection',
  FABRIC_FACTORY_EVENTSTREAM_NAME: 'factory-stream',
  FABRIC_FACTORY_KUSTO_URI: 'https://factory.kusto.test/',
  FABRIC_FACTORY_KUSTO_DATABASE: 'FactoryDb',
  FABRIC_FACTORY_KUSTO_TENANT_ID: 'factory-tenant',
  FABRIC_FACTORY_TELEMETRY_TABLE: 'FactoryTelemetry',
  FABRIC_FARM_EVENTSTREAM_CONNECTION_STRING: 'Endpoint=sb://farm.test;EntityPath=farm-stream',
  FABRIC_FARM_KUSTO_URI: 'https://farm.kusto.test/',
  FABRIC_FARM_KUSTO_DATABASE: 'FarmDb',
  FABRIC_FARM_TELEMETRY_TABLE: 'FarmTelemetry',
  FABRIC_ENERGY_EVENTSTREAM_CONNECTION_STRING: 'fake-energy-connection',
  FABRIC_ENERGY_EVENTSTREAM_NAME: 'energy-stream',
  FABRIC_ENERGY_KUSTO_URI: 'https://energy.kusto.test/',
  FABRIC_ENERGY_KUSTO_DATABASE: 'EnergyDb',
  FABRIC_ENERGY_KUSTO_TENANT_ID: 'energy-tenant',
  FABRIC_ENERGY_TELEMETRY_TABLE: 'EnergyTelemetry',
  FABRIC_PHARMA_KUSTO_URI: 'https://pharma.kusto.test/',
  FOUNDRY_PROJECT_ENDPOINT: 'https://foundry.test',
  FOUNDRY_AGENT_NAME: 'shared-agent',
  FOUNDRY_FACTORY_AGENT_NAME: 'factory-agent',
  FOUNDRY_FARM_AGENT_NAME: 'farm-agent',
  FOUNDRY_ENERGY_AGENT_NAME: 'energy-agent',
});

const producers = [];
const tokenRequests = [];
mock.module('@azure/event-hubs', {
  exports: { EventHubProducerClient: class {
    constructor(...args) { this.args = args; this.batches = []; this.closes = 0; producers.push(this); }
    async createBatch() { return { events: [], tryAdd(event) { this.events.push(event); return true; } }; }
    async sendBatch(batch) { this.batches.push(batch.events); }
    async close() { this.closes++; if (this.failClose) throw new Error('fake close failure'); }
  } },
});
mock.module('@azure/identity', {
  exports: { DefaultAzureCredential: class {
    constructor(options) { this.tenant = options?.tenantId || 'default'; }
    async getToken(scope) {
      tokenRequests.push({ tenant: this.tenant, scope });
      return { token: `fake-${this.tenant}` };
    }
  } },
});

const fabric = await import('../server/fabric.js');
const queries = [];
const foundryCalls = [];
const controlRequests = [];
let nextConversation = 0;
const originalFetch = globalThis.fetch;
let server;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === String(server.address().port)) {
    if (url.pathname === '/api/devices/control') controlRequests.push(url.searchParams.get('scenario'));
    return originalFetch(input, options);
  }
  if (url.hostname.endsWith('.kusto.test')) {
    const destinations = {
      'factory.kusto.test': ['factory', 11],
      'farm.kusto.test': ['farm', 22],
      'energy.kusto.test': ['energy', 33],
      'mining.kusto.test': ['mining', 55],
      'pharma.kusto.test': ['pharma', 66],
      'shared.kusto.test': ['mining', 44],
    };
    const destination = destinations[url.hostname];
    assert.ok(destination, `Unexpected Kusto target: ${url.hostname}`);
    queries.push({ host: url.hostname, body: JSON.parse(options.body), authorization: options.headers.Authorization });
    const now = new Date().toISOString();
    const id = DEVICE_CATALOGS[destination[0]].createAssets()[0].id;
    const foreignId = DEVICE_CATALOGS[destination[0] === 'pharma' ? 'factory' : 'pharma'].createAssets()[0].id;
    const columns = ['machineId', 'ts', 'temp', 'vib', 'usage', 'mode', 'speed', 'isRunning', 'ingestedAt'];
    const row = (machineId, temp) => [machineId, now, temp, 0.1, 50, 'auto', 100, true, now];
    return Response.json({ Tables: [{
      Columns: columns.map((ColumnName) => ({ ColumnName })),
      Rows: [row(id, destination[1]), row(foreignId, 999)],
    }] });
  }
  if (url.hostname === 'foundry.test') {
    const body = JSON.parse(options.body);
    foundryCalls.push({ path: url.pathname, body });
    return Response.json(url.pathname.endsWith('/conversations')
      ? { id: `proxy_conversation_${++nextConversation}` }
      : { id: 'proxy_response', status: 'completed', output_text: 'ok' });
  }
  throw new Error(`Unexpected external request in offline test: ${url.origin}`);
};

({ server } = await import('../server/index.js'));
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await fabric.closeFabric();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});

const suffixes = [
  'EVENTSTREAM_CONNECTION_STRING', 'EVENTSTREAM_NAME', 'KUSTO_URI',
  'KUSTO_DATABASE', 'TELEMETRY_TABLE', 'KUSTO_TENANT_ID',
];
const scenarioIds = ['factory', 'farm', 'energy', 'mining', 'pharma'];

test('all five scenarios use the legacy shared Fabric configuration when no override is present', () => {
  const keys = scenarioIds.flatMap((id) => suffixes.map((suffix) => `FABRIC_${id.toUpperCase()}_${suffix}`));
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const id of scenarioIds) {
      const config = fabric.fabricConfig(id);
      assert.equal(config.scenarioSpecific, false);
      assert.equal(config.connectionString, 'fake-shared-connection');
      assert.equal(config.eventHubName, 'shared-stream');
      assert.equal(config.kustoUri, 'https://shared.kusto.test');
      assert.equal(config.database, 'SharedDb');
      assert.equal(config.telemetryTable, 'SharedTelemetry');
      assert.equal(config.tenantId, 'shared-tenant');
      assert.equal(fabric.canPublish(config), true);
      assert.equal(fabric.canQuery(config), true);
    }
    assert.equal(fabric.fabricConfig().scenario, 'factory');
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('scenario overrides are isolated, inherit only tuning, and reject invalid scenarios', () => {
  const factory = fabric.fabricConfig('factory');
  const farm = fabric.fabricConfig('farm');
  const mining = fabric.fabricConfig('mining');
  assert.equal(factory.connectionString, 'fake-factory-connection');
  assert.equal(factory.database, 'FactoryDb');
  assert.equal(factory.telemetryTable, 'FactoryTelemetry');
  assert.equal(factory.tenantId, 'factory-tenant');
  assert.equal(farm.connectionString, 'Endpoint=sb://farm.test;EntityPath=farm-stream');
  assert.equal(farm.eventHubName, undefined);
  assert.equal(fabric.canPublish(farm), true);
  assert.equal(farm.tenantId, undefined);
  assert.equal(farm.scope, 'test-scope');
  assert.equal(farm.pollMs, 1000);
  assert.equal(farm.staleSec, 60);
  assert.equal(mining.scenarioSpecific, false);
  assert.equal(mining.tenantId, 'shared-tenant');
  for (const id of ['', 'FACTORY', 'unknown', null, ['farm']]) {
    assert.throws(() => fabric.fabricConfig(id), (error) => error.status === 400);
  }
});

test('blank overrides preserve shared defaults, including the legacy table default', () => {
  const table = process.env.FABRIC_TELEMETRY_TABLE;
  const name = process.env.FABRIC_EVENTSTREAM_NAME;
  const blank = process.env.FABRIC_MINING_KUSTO_URI;
  try {
    delete process.env.FABRIC_TELEMETRY_TABLE;
    delete process.env.FABRIC_EVENTSTREAM_NAME;
    process.env.FABRIC_MINING_KUSTO_URI = '  ';
    const config = fabric.fabricConfig('mining');
    assert.equal(config.scenarioSpecific, false);
    assert.equal(config.telemetryTable, 'MachineTelemetry');
    assert.equal(config.database, 'SharedDb');
    assert.equal(fabric.canPublish(config), true);
  } finally {
    for (const [key, value] of [
      ['FABRIC_TELEMETRY_TABLE', table], ['FABRIC_EVENTSTREAM_NAME', name], ['FABRIC_MINING_KUSTO_URI', blank],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('all five scenario prefixes accept independent complete destinations', () => {
  const keys = scenarioIds.flatMap((id) => suffixes.map((suffix) => `FABRIC_${id.toUpperCase()}_${suffix}`));
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const id of scenarioIds) {
      const prefix = `FABRIC_${id.toUpperCase()}`;
      Object.assign(process.env, {
        [`${prefix}_EVENTSTREAM_CONNECTION_STRING`]: `fake-${id}`,
        [`${prefix}_EVENTSTREAM_NAME`]: `${id}-stream`,
        [`${prefix}_KUSTO_URI`]: `https://${id}.kusto.test/`,
        [`${prefix}_KUSTO_DATABASE`]: `${id}Db`,
        [`${prefix}_TELEMETRY_TABLE`]: `${id}Telemetry`,
        [`${prefix}_KUSTO_TENANT_ID`]: `${id}-tenant`,
      });
    }
    for (const id of scenarioIds) {
      const config = fabric.fabricConfig(id);
      assert.equal(config.connectionString, `fake-${id}`);
      assert.equal(config.eventHubName, `${id}-stream`);
      assert.equal(config.kustoUri, `https://${id}.kusto.test`);
      assert.equal(config.database, `${id}Db`);
      assert.equal(config.telemetryTable, `${id}Telemetry`);
      assert.equal(config.tenantId, `${id}-tenant`);
      assert.equal(fabric.canPublish(config), true);
      assert.equal(fabric.canQuery(config), true);
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('partial explicit targets never borrow shared fields and fail the affected operation', async () => {
  const fields = {
    EVENTSTREAM_CONNECTION_STRING: ['connectionString', 'Endpoint=sb://mine.test;EntityPath=mine'],
    EVENTSTREAM_NAME: ['eventHubName', 'mine'],
    KUSTO_URI: ['kustoUri', 'https://mine.kusto.test'],
    KUSTO_DATABASE: ['database', 'MineDb'],
    TELEMETRY_TABLE: ['telemetryTable', 'MineTelemetry'],
    KUSTO_TENANT_ID: ['tenantId', 'mine-tenant'],
  };
  const keys = suffixes.map((suffix) => `FABRIC_MINING_${suffix}`);
  try {
    for (const [suffix, [property, value]] of Object.entries(fields)) {
      for (const key of keys) delete process.env[key];
      process.env[`FABRIC_MINING_${suffix}`] = value;
      const config = fabric.fabricConfig('mining');
      assert.equal(config.scenarioSpecific, true, suffix);
      for (const [otherProperty] of Object.values(fields)) {
        assert.equal(config[otherProperty], otherProperty === property ? value : undefined, `${suffix}.${otherProperty}`);
      }
      assert.equal(fabric.canQuery(config), false, suffix);
      assert.equal(fabric.canPublish(config), suffix === 'EVENTSTREAM_CONNECTION_STRING', suffix);
    }
    for (const key of keys) delete process.env[key];
    process.env.FABRIC_MINING_KUSTO_URI = 'https://mine.kusto.test';
    process.env.FABRIC_MINING_KUSTO_DATABASE = 'MineDb';
    let config = fabric.fabricConfig('mining');
    assert.equal(config.telemetryTable, undefined);
    assert.equal(fabric.canQuery(config), false);
    await assert.rejects(fabric.latestTelemetry(config), (error) => error.status === 503 && /FABRIC_MINING_TELEMETRY_TABLE/.test(error.message));
    await assert.rejects(fabric.publish([{ eventType: 'telemetry', machineId: 'test' }], config), (error) => error.status === 503);
    process.env.FABRIC_MINING_TELEMETRY_TABLE = 'MineTelemetry';
    config = fabric.fabricConfig('mining');
    assert.equal(fabric.canQuery(config), true);
    assert.equal(config.tenantId, undefined);

    for (const key of keys) delete process.env[key];
    process.env.FABRIC_MINING_EVENTSTREAM_CONNECTION_STRING = 'Endpoint=sb://mine.test;SharedAccessKeyName=fake;SharedAccessKey=fake';
    assert.equal(fabric.canPublish(fabric.fabricConfig('mining')), false);
    process.env.FABRIC_MINING_EVENTSTREAM_NAME = 'mine-stream';
    assert.equal(fabric.canPublish(fabric.fabricConfig('mining')), true);
  } finally {
    for (const key of keys) delete process.env[key];
  }
});

test('producer cache keys include both connection and Event Hub and close all targets', async () => {
  await fabric.closeFabric();
  const first = producers.length;
  const event = [{ eventType: 'telemetry', machineId: 'test' }];
  const factory = fabric.fabricConfig('factory');
  const farm = fabric.fabricConfig('farm');
  await fabric.publish(event, factory);
  await fabric.publish(event, farm);
  await fabric.publish(event, factory);
  await fabric.publish(event, { ...factory, eventHubName: 'another-stream' });
  const created = producers.slice(first);
  assert.equal(created.length, 3);
  assert.deepEqual(created.map((producer) => producer.args), [
    ['fake-factory-connection', 'factory-stream'],
    ['Endpoint=sb://farm.test;EntityPath=farm-stream'],
    ['fake-factory-connection', 'another-stream'],
  ]);
  assert.deepEqual(created.map((producer) => producer.batches.length), [2, 1, 1]);
  await fabric.closeFabric();
  assert.deepEqual(created.map((producer) => producer.closes), [1, 1, 1]);
  await fabric.publish(event, factory);
  assert.notEqual(producers.at(-1), created[0]);
  await fabric.closeFabric();
});

test('closing one failing producer still closes every other cached producer', async () => {
  const first = producers.length;
  const event = [{ eventType: 'telemetry', machineId: 'test' }];
  await fabric.publish(event, fabric.fabricConfig('factory'));
  await fabric.publish(event, fabric.fabricConfig('farm'));
  const created = producers.slice(first);
  created[0].failClose = true;
  await assert.rejects(fabric.closeFabric(), AggregateError);
  assert.deepEqual(created.map((producer) => producer.closes), [1, 1]);
  await fabric.publish(event, fabric.fabricConfig('factory'));
  assert.notEqual(producers.at(-1), created[0]);
  await fabric.closeFabric();
});

async function readSse(scenario, eventName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(`${base}/api/telemetry/stream?scenario=${scenario}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pattern = new RegExp(`event: ${eventName}\\ndata: (.+)\\n`);
    while (!pattern.test(text)) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(pattern.exec(text)[1]);
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
}

test('proxy health reports each resolved target without exposing configuration secrets', async () => {
  const response = await fetch(`${base}/api/health?scenario=farm`);
  const health = await response.json();
  assert.deepEqual(health.fabric, health.scenarios.farm.fabric);
  assert.equal(health.fabric.scenarioSpecific, true);
  assert.equal(health.fabric.eventstream, true);
  assert.equal(health.fabric.eventhouse, true);
  assert.equal(health.foundry.configured, true);
  assert.equal(health.scenarios.mining.fabric.scenarioSpecific, false);
  assert.equal(health.scenarios.pharma.fabric.eventstream, false);
  assert.equal(health.scenarios.pharma.fabric.eventhouse, false);
  assert.equal(health.scenarios.pharma.fabric.loopbackActive, false);
  const serialized = JSON.stringify(health);
  assert.ok(!serialized.includes('fake-shared-connection'));
  assert.ok(!serialized.includes('factory-tenant'));
  assert.ok(!serialized.includes('https://factory.kusto.test'));

  const factory = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(factory.fabric, factory.scenarios.factory.fabric);
});

test('proxy SSE polls the selected scenario URI, database, table and credential', async () => {
  queries.length = 0;
  tokenRequests.length = 0;
  for (const [id, expectedTemp] of [['factory', 11], ['farm', 22], ['energy', 33], ['mining', 44]]) {
    const { items } = await readSse(id, 'telemetry');
    const first = DEVICE_CATALOGS[id].createAssets()[0].id;
    assert.equal(items.find((item) => item.machineId === first).temp, expectedTemp, id);
    assert.ok(!items.some((item) => item.temp === 999), id);
  }
  assert.deepEqual(queries.map(({ host, body }) => [host, body.db, body.csl.split('\n')[0]]), [
    ['factory.kusto.test', 'FactoryDb', 'FactoryTelemetry'],
    ['farm.kusto.test', 'FarmDb', 'FarmTelemetry'],
    ['energy.kusto.test', 'EnergyDb', 'EnergyTelemetry'],
    ['shared.kusto.test', 'SharedDb', 'SharedTelemetry'],
  ]);
  assert.deepEqual(queries.map((query) => query.authorization), [
    'Bearer fake-factory-tenant', 'Bearer fake-default', 'Bearer fake-energy-tenant', 'Bearer fake-shared-tenant',
  ]);
  assert.ok(tokenRequests.every((request) => request.scope === 'test-scope'));
});

test('partial explicit config remains an SSE error even with loopback enabled', async () => {
  const before = queries.length;
  const status = await readSse('pharma', 'status');
  assert.equal(status.status, 'error');
  assert.match(status.detail, /FABRIC_PHARMA_KUSTO_DATABASE/);
  assert.match(status.detail, /FABRIC_PHARMA_TELEMETRY_TABLE/);
  assert.equal(queries.length, before);
});

test('mining and pharma SSE use their own Kusto targets when explicitly completed', async () => {
  const values = {
    FABRIC_MINING_KUSTO_URI: 'https://mining.kusto.test',
    FABRIC_MINING_KUSTO_DATABASE: 'MiningDb',
    FABRIC_MINING_TELEMETRY_TABLE: 'MiningTelemetry',
    FABRIC_PHARMA_KUSTO_DATABASE: 'PharmaDb',
    FABRIC_PHARMA_TELEMETRY_TABLE: 'PharmaTelemetry',
  };
  const saved = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    for (const [id, expected] of [['mining', 55], ['pharma', 66]]) {
      const { items } = await readSse(id, 'telemetry');
      const first = DEVICE_CATALOGS[id].createAssets()[0].id;
      assert.equal(items.find((item) => item.machineId === first).temp, expected);
      const query = queries.findLast((entry) => entry.host === `${id}.kusto.test`);
      assert.equal(query.body.db, `${id[0].toUpperCase()}${id.slice(1)}Db`);
      assert.equal(query.body.csl.split('\n')[0], `${id[0].toUpperCase()}${id.slice(1)}Telemetry`);
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('HTTP proxy routes agent by context and never carries an ID into another scenario', async () => {
  foundryCalls.length = 0;
  const post = (body) => fetch(`${base}/api/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const farm = await (await post({ message: 'factory', context: { scenario: 'farm' } })).json();
  assert.ok(foundryCalls[0].path.includes('/agents/farm-agent/'));
  assert.ok(foundryCalls[1].body.input.includes('Cenário: farm'));
  await post({ message: 'energy', conversationId: farm.conversationId, context: { scenario: 'energy' } });
  assert.ok(foundryCalls[2].path.includes('/agents/energy-agent/'));
  assert.deepEqual(foundryCalls[2].body, {});
  assert.notEqual(foundryCalls[3].body.conversation, farm.conversationId);
});

test('explicit invalid scenarios return 400 on health, control, SSE and agent routes', async () => {
  for (const path of ['/api/health?scenario=bad', '/api/devices/control?scenario=bad', '/api/telemetry/stream?scenario=bad']) {
    assert.equal((await fetch(`${base}${path}`)).status, 400, path);
  }
  for (const [path, body] of [
    ['/api/commands', { scenario: 'bad', machineId: 'CNC-001', command: 'PAUSE' }],
    ['/api/agent/chat', { message: 'test', context: { scenario: 'bad' } }],
    ['/api/agent/chat', { message: 'test', scenario: 'bad' }],
    ['/api/agent/chat', { message: 'test', scenario: 'farm' }],
  ]) {
    assert.equal((await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).status, 400, path);
  }
});

test('simulator selects scenario-specific and shared producers and rejects partial or invalid targets', async (t) => {
  const saved = {
    scenario: process.env.SCENARIO,
    interval: process.env.DEVICE_INTERVAL_MS,
    control: process.env.DEVICE_CONTROL_URL,
    pharmaConnection: process.env.FABRIC_PHARMA_EVENTSTREAM_CONNECTION_STRING,
    pharmaName: process.env.FABRIC_PHARMA_EVENTSTREAM_NAME,
  };
  const oldListeners = new Set(process.listeners('SIGINT'));
  const originalSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 1234567 && callback.name === 'run') { scheduled.push(callback); return 0; }
    return originalSetTimeout(callback, delay, ...args);
  });
  t.mock.method(console, 'log', () => {});
  const errors = [];
  t.mock.method(console, 'error', (message) => errors.push(message));
  t.mock.method(process, 'exit', (code) => { throw Object.assign(new Error('simulator exit'), { exitCode: code }); });
  try {
    await fabric.closeFabric();
    const first = producers.length;
    controlRequests.length = 0;
    process.env.DEVICE_INTERVAL_MS = '1234567';
    process.env.DEVICE_CONTROL_URL = base;
    process.env.FABRIC_PHARMA_EVENTSTREAM_CONNECTION_STRING = 'fake-pharma-connection';
    process.env.FABRIC_PHARMA_EVENTSTREAM_NAME = 'pharma-stream';
    for (const id of ['factory', 'farm', 'energy', 'mining', 'pharma']) {
      process.env.SCENARIO = id;
      await import(`../server/deviceSimulator.js?scenario-test=${id}`);
    }
    delete process.env.SCENARIO;
    await import('../server/deviceSimulator.js?scenario-test=default');
    const created = producers.slice(first);
    assert.deepEqual(created.map((producer) => producer.args), [
      ['fake-factory-connection', 'factory-stream'],
      ['Endpoint=sb://farm.test;EntityPath=farm-stream'],
      ['fake-energy-connection', 'energy-stream'],
      ['fake-shared-connection', 'shared-stream'],
      ['fake-pharma-connection', 'pharma-stream'],
    ]);
    assert.deepEqual(controlRequests, ['factory', 'farm', 'energy', 'mining', 'pharma', 'factory']);
    assert.deepEqual(created.map((producer) => producer.batches.length), [2, 1, 1, 1, 1]);
    for (const [producer, id] of created.map((producer, index) => [producer, scenarioIds[index]])) {
      const expectedIds = new Set(DEVICE_CATALOGS[id].createAssets().map((asset) => asset.id));
      assert.ok(producer.batches[0].length > 0);
      assert.ok(producer.batches[0].every(({ body }) =>
        body !== null && typeof body === 'object' && body.eventType === 'telemetry'
        && body.scenario === id && expectedIds.has(body.machineId)));
    }
    assert.equal(scheduled.length, 6);

    delete process.env.FABRIC_PHARMA_EVENTSTREAM_CONNECTION_STRING;
    delete process.env.FABRIC_PHARMA_EVENTSTREAM_NAME;
    process.env.SCENARIO = 'pharma';
    await assert.rejects(import('../server/deviceSimulator.js?scenario-test=partial'), (error) => error.exitCode === 1);
    assert.ok(errors.some((message) => message.includes('FABRIC_PHARMA_EVENTSTREAM_CONNECTION_STRING')));
    process.env.SCENARIO = 'invalid';
    await assert.rejects(import('../server/deviceSimulator.js?scenario-test=invalid'), (error) => error.status === 400);
    assert.equal(producers.length, first + 5);
    assert.equal(controlRequests.length, 6);
  } finally {
    await fabric.closeFabric();
    for (const listener of process.listeners('SIGINT')) {
      if (!oldListeners.has(listener)) process.removeListener('SIGINT', listener);
    }
    for (const [key, value] of [
      ['SCENARIO', saved.scenario], ['DEVICE_INTERVAL_MS', saved.interval], ['DEVICE_CONTROL_URL', saved.control],
      ['FABRIC_PHARMA_EVENTSTREAM_CONNECTION_STRING', saved.pharmaConnection], ['FABRIC_PHARMA_EVENTSTREAM_NAME', saved.pharmaName],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
