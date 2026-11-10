import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

const context = { summary: { online: 1, alert: 0, offline: 0, total: 1 }, alerts: [], machines: [], selected: null };
let nodes;
let subscriptions;
let contextReads;

function node() {
  return {
    children: [], style: {}, dataset: {}, listeners: {}, value: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    focus() {},
    remove() { for (const n of nodes.values()) n.children = n.children.filter((child) => child !== this); },
  };
}
const getNode = (id) => {
  if (!nodes.has(id)) nodes.set(id, node());
  return nodes.get(id);
};

mock.module('../server/fabric.js', {
  exports: { getCredential: () => ({ getToken: async () => ({ token: 'test-token' }) }) },
});
mock.module('../app/src/core/state.js', {
  exports: { store: { state: {}, subscribe: (...args) => subscriptions.push(args) } },
});
mock.module('../app/src/integration/agent/context.js', {
  exports: { buildContext: () => { contextReads++; return context; } },
});
mock.module('../app/src/ui/dom.js', {
  exports: {
    $: getNode,
    el: (_tag, attrs = {}, text = '') => Object.assign(node(), { className: attrs.class, textContent: text }),
    esc: (text) => String(text),
    setText: (n, text) => { n.textContent = text; },
  },
});

const { chat, withContext, foundryConfigured } = await import('../server/foundry.js');
const { createFoundryAgent } = await import('../app/src/integration/agent/foundry.js');
const { createAgent } = await import('../app/src/integration/agent/index.js');
const { answer } = await import('../app/src/integration/agent/mock.js');
const { mountAssistant } = await import('../app/src/ui/assistant.js');
let previousEnv;

beforeEach(() => {
  previousEnv = { ...process.env };
  process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://foundry.test';
  process.env.FOUNDRY_AGENT_NAME = 'test-agent';
  process.env.FOUNDRY_DEBUG = 'false';
  delete process.env.FOUNDRY_AGENT_ID;
  delete process.env.FOUNDRY_API_VERSION;
  for (const id of ['FACTORY', 'FARM', 'ENERGY', 'MINING', 'PHARMA']) {
    delete process.env[`FOUNDRY_${id}_AGENT_NAME`];
  }
  nodes = new Map();
  subscriptions = [];
  contextReads = 0;
});
afterEach(() => {
  mock.restoreAll();
  process.env = previousEnv;
});

test('Foundry forwards only the exact user message and preserves remote conversation and reply', async () => {
  const bodies = [];
  const urls = [];
  const reply = '  Resposta do agente 【1:fonte】\n';
  mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(String(url));
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify(bodies.length === 1
      ? { id: 'conv_test' }
      : { id: 'resp_test', status: 'completed', output_text: reply }));
  });
  const message = '  teste\n';
  const result = await chat({ message });
  assert.deepEqual(bodies, [{}, { conversation: 'conv_test', input: message }]);
  assert.ok(urls.every((url) => url.endsWith('api-version=2025-11-15-preview')));
  assert.equal(result.text, reply);
  await chat({ message: 'segunda mensagem', conversationId: result.conversationId });
  assert.deepEqual(bodies[2], { conversation: 'conv_test', input: 'segunda mensagem' });
});

test('legacy requests without a scenario can continue an existing unscoped conversation', async () => {
  const requests = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    return Response.json({ id: 'response', status: 'completed', output_text: 'ok' });
  });
  await chat({ message: 'resume', conversationId: 'legacy_external_conversation' });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].path.endsWith('/responses'));
  assert.equal(requests[0].body.conversation, 'legacy_external_conversation');
});

test('classic Foundry uses no additional instructions and preserves citations', async () => {
  delete process.env.FOUNDRY_AGENT_NAME;
  process.env.FOUNDRY_AGENT_ID = 'asst_test';
  const requests = [];
  mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.body) {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: 'run_test', thread_id: 'thread_test', status: 'completed' }));
    }
    return new Response(JSON.stringify({ data: [
      { role: 'assistant', run_id: 'run_test', content: [{ type: 'text', text: { value: 'Resposta 【1:fonte】' } }] },
    ] }));
  });
  const result = await chat({ message: 'teste' });
  assert.deepEqual(requests, [{ assistant_id: 'asst_test', thread: { messages: [{ role: 'user', content: 'teste' }] } }]);
  assert.equal(result.text, 'Resposta 【1:fonte】');
});

test('Foundry selects each scenario agent from context and falls back to the shared agent', async () => {
  const expected = {
    factory: 'factory agent', farm: 'farm-agent', energy: 'energy-agent',
    mining: 'mining-agent', pharma: 'pharma-agent',
  };
  for (const [scenario, name] of Object.entries(expected)) {
    process.env[`FOUNDRY_${scenario.toUpperCase()}_AGENT_NAME`] = name;
  }
  const requests = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json(String(url).includes('/conversations')
      ? { id: `agent-conversation-${requests.length}` }
      : { id: 'response', status: 'completed', output_text: 'ok' });
  });
  for (const [scenario, name] of Object.entries(expected)) {
    assert.equal(foundryConfigured(scenario), true);
    await chat({ message: 'scenario: factory', context: { scenario } });
    assert.ok(requests.at(-2).url.includes(`/agents/${encodeURIComponent(name)}/`), scenario);
    assert.ok(requests.at(-1).body.input.includes(`Cenário: ${scenario}`));
  }
  delete process.env.FOUNDRY_FARM_AGENT_NAME;
  await chat({ message: 'teste', context: { scenario: 'farm' } });
  assert.ok(requests.at(-2).url.includes('/agents/test-agent/'));
  await chat({ message: 'teste' });
  assert.ok(requests.at(-2).url.includes('/agents/test-agent/'));
  delete process.env.FOUNDRY_AGENT_NAME;
  assert.equal(foundryConfigured('farm'), false);
  assert.equal(foundryConfigured('factory'), true);
});

test('scenario Foundry names override a classic ID only for the selected scenario', async () => {
  delete process.env.FOUNDRY_AGENT_NAME;
  process.env.FOUNDRY_AGENT_ID = 'asst_legacy';
  process.env.FOUNDRY_FARM_AGENT_NAME = 'farm-current';
  const requests = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: options.body && JSON.parse(options.body) });
    if (path.endsWith('/conversations')) return Response.json({ id: 'conv_farm_override' });
    if (path.endsWith('/responses')) return Response.json({ id: 'response', status: 'completed', output_text: 'farm' });
    if (path === '/threads/runs') return Response.json({ id: 'run_legacy', thread_id: 'thread_legacy', status: 'completed' });
    return Response.json({ data: [{ role: 'assistant', run_id: 'run_legacy', content: [{ type: 'text', text: { value: 'legacy' } }] }] });
  });
  assert.equal((await chat({ message: 'farm', context: { scenario: 'farm' } })).text, 'farm');
  assert.ok(requests[0].path.includes('/agents/farm-current/'));
  assert.equal((await chat({ message: 'energy', context: { scenario: 'energy' } })).text, 'legacy');
  assert.equal(requests[2].body.assistant_id, 'asst_legacy');
});

test('Foundry rejects explicitly invalid scenario contexts without making a request', async () => {
  const fetch = mock.method(globalThis, 'fetch', () => { throw new Error('must not call Foundry'); });
  for (const scenario of ['unknown', '', 'FACTORY', null, ['farm']]) {
    await assert.rejects(chat({ message: 'teste', context: { scenario } }), (error) => error.status === 400);
    assert.throws(() => foundryConfigured(scenario), (error) => error.status === 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('server binds conversation and thread IDs to the scenario and resolved agent', async () => {
  const requests = [];
  let nextId = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(options.body);
    requests.push({ path, body });
    return Response.json(path.endsWith('/conversations')
      ? { id: `isolated_${++nextId}` }
      : { id: 'response', status: 'completed', output_text: 'ok' });
  });
  const factory = await chat({ message: 'one', context: { scenario: 'factory' } });
  await chat({ message: 'two', context: { scenario: 'factory' }, conversationId: factory.conversationId });
  assert.equal(requests.at(-1).body.conversation, factory.conversationId);

  const farm = await chat({ message: 'farm', context: { scenario: 'farm' }, threadId: factory.conversationId });
  assert.notEqual(farm.conversationId, factory.conversationId);
  assert.deepEqual(requests.at(-2).body, {});
  assert.equal(requests.at(-1).body.conversation, farm.conversationId);

  await chat({ message: 'unknown', context: { scenario: 'energy' }, conversationId: 'not-issued-by-proxy' });
  assert.deepEqual(requests.at(-2).body, {});
  await chat({ message: 'no scenario', conversationId: farm.conversationId });
  assert.deepEqual(requests.at(-2).body, {});

  process.env.FOUNDRY_FACTORY_AGENT_NAME = 'replacement-agent';
  await chat({ message: 'changed agent', context: { scenario: 'factory' }, conversationId: factory.conversationId });
  assert.deepEqual(requests.at(-2).body, {});
  assert.ok(requests.at(-2).path.includes('/agents/replacement-agent/'));
});

test('classic shared agent also starts a new thread when the scenario changes', async () => {
  delete process.env.FOUNDRY_AGENT_NAME;
  process.env.FOUNDRY_AGENT_ID = 'asst_scenario_legacy';
  const requests = [];
  let nextThread = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    requests.push({ path, body });
    if (path === '/threads/runs') {
      return Response.json({ id: 'legacy_run', thread_id: `isolated_thread_${++nextThread}`, status: 'completed' });
    }
    if (path.endsWith('/runs')) return Response.json({ id: 'legacy_run', status: 'completed' });
    if (options.method === 'POST') return Response.json({});
    return Response.json({ data: [{ role: 'assistant', run_id: 'legacy_run', content: [{ type: 'text', text: { value: 'ok' } }] }] });
  });
  const factory = await chat({ message: 'factory', context: { scenario: 'factory' } });
  const farm = await chat({ message: 'farm', threadId: factory.conversationId, context: { scenario: 'farm' } });
  assert.notEqual(farm.conversationId, factory.conversationId);
  assert.equal(requests.filter(({ path }) => path === '/threads/runs').length, 2);
  await chat({ message: 'farm again', threadId: farm.conversationId, context: { scenario: 'farm' } });
  assert.ok(requests.some(({ path }) => path === `/threads/${farm.conversationId}/messages`));
});

test('Foundry rejects failed, incomplete and empty responses instead of substituting text', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 }));
  await assert.rejects(chat({ message: 'teste', conversationId: 'conv_test' }), /Foundry 503/);
  for (const response of [
    { status: 'failed', output_text: 'partial' },
    { status: 'incomplete', output_text: 'partial' },
    { status: 'completed', output_text: '   ' },
  ]) {
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify(response)));
    await assert.rejects(chat({ message: 'teste', conversationId: 'conv_test' }), /não concluiu|não retornou texto/);
  }
});

test('debug logs the exact outgoing payload (with plant context) without credentials', async () => {
  process.env.FOUNDRY_DEBUG = 'true';
  const logs = [];
  const requests = [];
  mock.method(console, 'log', (...args) => logs.push(args));
  mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(options.body);
    return new Response(JSON.stringify({ id: 'resp_test', status: 'completed', output_text: 'Resposta' }));
  });
  await chat({ message: 'teste', conversationId: 'conv_test', context });
  const index = logs.findIndex(([label]) => label.includes('Payload enviado ao Foundry'));
  assert.ok(index >= 0);
  assert.equal(logs[index + 1][0], requests[0]);
  assert.deepEqual(JSON.parse(requests[0]), { conversation: 'conv_test', input: withContext('teste', context) });
  assert.ok(!JSON.stringify(logs).includes('test-token'));
});

test('classic Foundry rejects old replies from a different run', async () => {
  delete process.env.FOUNDRY_AGENT_NAME;
  process.env.FOUNDRY_AGENT_ID = 'asst_test';
  mock.method(globalThis, 'fetch', async (_url, options) => new Response(JSON.stringify(options.body
    ? { id: 'run_new', thread_id: 'thread_test', status: 'completed' }
    : { data: [{ role: 'assistant', run_id: 'run_old', content: [{ type: 'text', text: { value: 'old reply' } }] }] })));
  await assert.rejects(chat({ message: 'teste' }), /não retornou texto/);
});

test('server appends live plant context to the user message', () => {
  const ctx = { summary: { online: 1, alert: 1, offline: 0, total: 2 },
    alerts: [{ id: 'INJ-002', name: 'Injetora', status: 'alert', reasons: ['Temperatura alta'] }], selected: null };
  const out = withContext('por quê?', ctx);
  assert.match(out, /1 em alerta/);
  assert.match(out, /INJ-002 · Injetora: alert — Temperatura alta/);
  assert.ok(out.endsWith('Pergunta do usuário:\npor quê?'));
  assert.equal(withContext('oi'), 'oi');
});

test('Foundry does not receive disconnected seed measurements as selected live telemetry', () => {
  const selected = { id: 'MIN-EXC-001', commLost: true, telemetry: { extractedT: 31 } };
  const input = withContext('Resumo', { scenario: 'mining', selected });
  assert.ok(input.includes('"telemetry":null'));
  assert.ok(!input.includes('extractedT'));
  assert.equal(selected.telemetry.extractedT, 31);
});

test('adapter sends context, logs calls when debug, reuses conversation and resets it', async () => {
  const requests = [];
  mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ text: 'Resposta', conversationId: 'conv_test' }));
  });
  const logs = [];
  mock.method(console, 'log', (...args) => logs.push(args));
  const agent = createFoundryAgent({ debug: true });
  await agent.send('  teste  ', context);
  await agent.send('segunda');
  agent.reset();
  await agent.send('nova');
  assert.deepEqual(requests.map((r) => JSON.parse(JSON.stringify(r))), [
    { message: '  teste  ', conversationId: null, context },
    { message: 'segunda', conversationId: 'conv_test' },
    { message: 'nova', conversationId: null },
  ]);
  assert.ok(logs.some(([tag, label]) => tag === '[foundry]' && /POST \/api\/agent\/chat/.test(label)));
});

test('Foundry adapter starts a new conversation on every scenario switch', async () => {
  const requests = [];
  let nextId = 0;
  mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return Response.json({ text: 'ok', conversationId: body.conversationId || `adapter_${++nextId}` });
  });
  const agent = createFoundryAgent();
  await agent.send('factory', { scenario: 'factory' });
  await agent.send('factory again', { scenario: 'factory' });
  await agent.send('farm', { scenario: 'farm' });
  await agent.send('factory again', { scenario: 'factory' });
  assert.deepEqual(requests.map((request) => request.conversationId), [null, 'adapter_1', null, null]);
});

test('late Foundry replies cannot restore the previous scenario or a reset conversation', async () => {
  const requests = [];
  const pending = new Map();
  mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.message.startsWith('slow')) return new Promise((resolve) => pending.set(body.message, resolve));
    return Response.json({ text: 'ok', conversationId: body.conversationId || 'current_farm' });
  });
  const agent = createFoundryAgent();
  const old = agent.send('slow factory', { scenario: 'factory' });
  await agent.send('farm', { scenario: 'farm' });
  pending.get('slow factory')(Response.json({ text: 'old', conversationId: 'old_factory' }));
  await old;
  await agent.send('farm again', { scenario: 'farm' });
  assert.equal(requests.at(-1).conversationId, 'current_farm');

  const beforeReset = agent.send('slow reset', { scenario: 'farm' });
  agent.reset();
  pending.get('slow reset')(Response.json({ text: 'old', conversationId: 'before_reset' }));
  await beforeReset;
  await agent.send('after reset', { scenario: 'farm' });
  assert.equal(requests.at(-1).conversationId, null);
});

test('Foundry adapter surfaces failures and empty replies without local substitution', async () => {
  const agent = createAgent('foundry');
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Foundry indisponivel' }), { status: 503 }));
  await assert.rejects(agent.send('teste'), /Foundry indisponivel/);
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ text: '', conversationId: 'conv_test' })));
  await assert.rejects(agent.send('teste'), /não retornou uma resposta de texto/);
  assert.throws(() => createAgent('invalid'), /Modo de agente inválido/);
});

test('Foundry UI has no local greeting and sends live plant context with each message', async () => {
  const calls = [];
  const assistant = mountAssistant({ mode: 'foundry', label: 'Foundry', reset() {}, send: async (...args) => {
    calls.push(args);
    return { text: 'Resposta remota' };
  } });
  assistant.open();
  assert.equal(getNode('#as-msgs').children.length, 0);
  await assistant.ask('  mensagem digitada  ');
  assert.deepEqual(calls, [['  mensagem digitada  ', context]]);
  assert.equal(contextReads, 1);
  assert.equal(getNode('#as-msgs').children.at(-1).innerHTML, 'Resposta remota');
  getNode('#as-clear').listeners.click();
  assert.equal(getNode('#as-msgs').children.length, 0);
});

test('a late assistant response from the previous binding is not shown in the new scenario', async () => {
  let resolveOld;
  const assistant = mountAssistant({ mode: 'foundry', label: 'Old', reset() {},
    send: () => new Promise((resolve) => { resolveOld = resolve; }) });
  const old = assistant.ask('old question');
  assistant.bind({ mode: 'foundry', label: 'New', reset() {},
    send: async () => ({ text: 'new answer' }) });
  await assistant.ask('new question');
  resolveOld({ text: 'old answer' });
  await old;
  const content = getNode('#as-msgs').children.map((child) => child.innerHTML);
  assert.ok(content.includes('new answer'));
  assert.ok(!content.includes('old answer'));
  assert.equal(getNode('#as-send').disabled, false);
});

test('mock UI retains greeting, context, suggestions and automatic machine prompt', async () => {
  const calls = [];
  const assistant = mountAssistant({ mode: 'mock', label: 'Mock', reset() {}, send: async (...args) => {
    calls.push(args);
    return { text: 'Resposta local' };
  } });
  assistant.open();
  assert.match(getNode('#as-msgs').children[0].innerHTML, /Olá! Sou o assistente da Linha A/);
  assert.equal(subscriptions.length, 1);
  subscriptions[0][1]({ selectedId: null, machines: [] });
  assert.equal(getNode('#as-chips').children.length, 3);
  assert.notEqual(getNode('#as-ctx').style.display, 'none');
  assistant.open('Resumo da planta');
  await Promise.resolve();
  assert.deepEqual(calls, [['Resumo da planta', context]]);
  assert.equal(contextReads, 1);
  assert.equal(createAgent('mock').mode, 'mock');
  assert.match(answer('Resumo da planta', context), /Planta: 1 online, 0 em alerta, 0 offline/);
  getNode('#as-clear').listeners.click();
  assert.equal(getNode('#as-msgs').children.length, 1);
});
