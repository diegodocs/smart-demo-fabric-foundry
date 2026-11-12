// Proxy de integração: mantém credenciais no servidor e expõe uma API simples para a SPA.
//   GET  /api/health              → estado das integrações
//   GET  /api/telemetry/stream    → SSE com a última telemetria do Eventhouse (Fabric RTI)
//   POST /api/params              → atualiza controle local do simulador
//   POST /api/commands            → aplica comandos no controle local
//   GET  /api/devices/control     → estado desejado para o simulador
//   POST /api/agent/chat          → conversa com o agente do Azure AI Foundry
//
// Todas as rotas de dispositivo aceitam um parâmetro `scenario` (query string em GET, corpo em
// POST); por padrão é `factory`, preservando o comportamento anterior para quem não o envia.
// Cada cenário registrado em server/catalogs.js tem seu próprio device control, clientes SSE,
// loop de polling e configuração Fabric; sem overrides usa o destino compartilhado.
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PARAM_KEYS, MODES } from '../app/src/domain/paramSchema.js';
import { step, telemetrySnapshot } from '../app/src/domain/simulation.js';
import { measuredTelemetry, extraTelemetry } from '../app/src/domain/telemetry.js';
import { fabricConfig, canPublish, canQuery, latestTelemetry } from './fabric.js';
import { createDeviceControl, COMMANDS } from './deviceControl.js';
import { chat, foundryConfigured } from './foundry.js';
import { DEVICE_CATALOGS, resolveScenario } from './catalogs.js';

const PORT = Number(process.env.API_PORT || 8787);
const HOST = process.env.API_HOST || undefined;
// LOOPBACK: sem Fabric configurado, o servidor emula Eventstream+Eventhouse em memória
// (útil para testar o caminho VITE_TELEMETRY_MODE=fabric de ponta a ponta).
const LOOPBACK = process.env.FABRIC_LOOPBACK === 'true';

// Estado por cenário: catálogo conhecido, device control próprio e clientes SSE próprios.
const scenarios = Object.fromEntries(Object.entries(DEVICE_CATALOGS).map(([id, catalog]) => [id, {
  ...catalog,
  knownIds: new Set(catalog.createAssets().map((m) => m.id)),
  control: createDeviceControl(catalog.createAssets),
  clients: new Set(),
  pollTimer: null,
  initialLoopSample: true,
}]));
const scenarioOf = (id) => scenarios[resolveScenario(id)];

const app = express();
app.use(express.json({ limit: '256kb' }));

const useLoopback = (c) => LOOPBACK && !canQuery(c) && !c.scenarioSpecific;
const fabricHealth = (id) => {
  const c = fabricConfig(id);
  return {
    eventstream: canPublish(c), eventhouse: canQuery(c), loopback: LOOPBACK,
    loopbackActive: useLoopback(c), pollMs: c.pollMs, scenarioSpecific: !!c.scenarioSpecific,
  };
};

app.get('/api/health', (req, res) => {
  const id = resolveScenario(req.query.scenario);
  const status = Object.fromEntries(Object.entries(scenarios).map(([scenario, sc]) => [scenario, {
    sseClients: sc.clients.size,
    fabric: fabricHealth(scenario),
    foundry: { configured: foundryConfigured(scenario) },
  }]));
  res.json({
    ok: true,
    fabric: status[id].fabric,
    foundry: status[id].foundry,
    sseClients: Object.values(scenarios).reduce((sum, sc) => sum + sc.clients.size, 0),
    scenarios: status,
  });
});

// ─── Telemetria: um poller por cenário ativo, distribuído via SSE ────────────
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (sc, event, data) => sc.clients.forEach((res) => sse(res, event, data));

app.get('/api/devices/control', (req, res) => {
  res.set('Cache-Control', 'no-store').json(scenarioOf(req.query.scenario).control.snapshot());
});

async function pollOnce(sc) {
  const c = fabricConfig(sc.id);
  if (useLoopback(c)) {
    sc.simulation ??= sc.createSimulation?.(Object.values(sc.control.devices));
    const readings = sc.simulation && new Map((sc.initialLoopSample ? sc.simulation.snapshot() : sc.simulation.step(c.pollMs / 1000))
      .map((t) => [t.machineId, t]));
    const items = Object.values(sc.control.devices).map((d) => {
      const t = sc.simulation ? readings.get(d.id) : sc.initialLoopSample ? telemetrySnapshot(d) : step(d, c.pollMs / 1000);
      if (!t) return { machineId: d.id, commLost: true };
      Object.assign(d, measuredTelemetry(t));
      return { ...t, commLost: false };
    });
    sc.initialLoopSample = false;
    broadcast(sc, 'telemetry', { items, latencyMs: Math.round(40 + Math.random() * 60) });
    return;
  }
  const t0 = Date.now();
  const rows = await latestTelemetry(c);
  const queryMs = Date.now() - t0;
  const seen = new Set();
  const lags = [];
  const items = rows.filter((r) => sc.knownIds.has(r.machineId)).map((r) => {
    seen.add(r.machineId);
    const ts = new Date(r.ts).getTime();
    const stale = Date.now() - ts > c.staleSec * 1000;
    if (r.ingestedAt) lags.push(Math.max(0, new Date(r.ingestedAt).getTime() - ts));
    return stale
      ? { machineId: r.machineId, ts: r.ts, commLost: true }
      : { machineId: r.machineId, ts: r.ts, temp: r.temp, vib: r.vib, usage: r.usage, mode: r.mode, speed: r.speed, isRunning: r.isRunning, status: r.status, ...extraTelemetry(r), commLost: false };
  });
  // máquinas sem nenhuma leitura recente = perda de comunicação
  sc.knownIds.forEach((id) => { if (!seen.has(id)) items.push({ machineId: id, commLost: true }); });
  const ingestLag = lags.length ? lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)] : 0;
  broadcast(sc, 'telemetry', { items, latencyMs: ingestLag + queryMs });
}

function ensurePolling(sc) {
  if (sc.pollTimer || !sc.clients.size) return;
  const c = fabricConfig(sc.id);
  const tick = async () => {
    try { await pollOnce(sc); } catch (e) {
      console.error(`[fabric][${sc.id}] poll:`, e.message);
      broadcast(sc, 'status', { status: 'error', detail: `Eventhouse: ${e.message}` });
    }
  };
  tick();
  sc.pollTimer = setInterval(tick, c.pollMs);
}

app.get('/api/telemetry/stream', (req, res) => {
  const sc = scenarioOf(req.query.scenario);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const c = fabricConfig(sc.id);
  const configured = canQuery(c);
  const loopback = useLoopback(c);
  if (!configured && !loopback) {
    const prefix = c.scenarioSpecific ? `FABRIC_${sc.id.toUpperCase()}` : 'FABRIC';
    const table = c.scenarioSpecific ? `/${prefix}_TELEMETRY_TABLE` : '';
    sse(res, 'status', { status: 'error', detail: `Fabric não configurado no proxy — defina ${prefix}_KUSTO_URI/${prefix}_KUSTO_DATABASE${table}.` });
  } else {
    sse(res, 'status', {
      status: 'connected',
      detail: loopback ? 'Proxy em modo loopback (Eventstream/Eventhouse emulados)' : `Eventhouse ${c.database} · ${c.telemetryTable}`,
    });
  }
  sc.clients.add(res);
  if (configured || loopback) ensurePolling(sc);
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ka);
    sc.clients.delete(res);
    if (!sc.clients.size) { clearInterval(sc.pollTimer); sc.pollTimer = null; }
  });
});

// Controle HTTP local; somente o estado medido segue como telemetria ao Fabric.
function validateParams(p, schema) {
  if (!p || typeof p !== 'object') return 'params obrigatório';
  for (const k of schema ? Object.keys(schema) : PARAM_KEYS) {
    if (!(k in p)) return `params.${k} ausente`;
    if (k === 'mode' ? !Object.hasOwn(MODES, p[k]) : !Number.isFinite(p[k])) return `params.${k} inválido`;
    const field = schema?.[k];
    if (field && k !== 'mode' && (p[k] < field.min || p[k] > field.max)) return `params.${k} fora dos limites`;
  }
  return null;
}

const send = (fn) => async (req, res) => {
  try { res.json(await fn(req.body || {})); } catch (e) {
    console.error(`[api] ${req.path}:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

app.post('/api/params', send(async ({ machineId, params, scenario }) => {
  const sc = scenarioOf(scenario);
  if (!sc.knownIds.has(machineId)) throw bad('machineId desconhecido');
  const schema = sc.paramSchema?.(sc.control.devices[machineId].type);
  const err = validateParams(params, schema);
  if (err) throw bad(err);
  sc.control.setParams(machineId, Object.fromEntries((schema ? Object.keys(schema) : PARAM_KEYS).map((k) => [k, params[k]])));
  return { ack: true, delivery: 'local-control' };
}));

app.post('/api/commands', send(async ({ machineId, command, scenario }) => {
  const sc = scenarioOf(scenario);
  if (!sc.knownIds.has(machineId)) throw bad('machineId desconhecido');
  if (!COMMANDS.has(command)) throw bad('comando inválido');
  if (sc.commandsFor && !sc.commandsFor(sc.control.devices[machineId]).some((c) => c.id === command)) throw bad('comando indisponível para este ativo');
  sc.control.command(machineId, command);
  return { ack: true, delivery: 'local-control' };
}));

// ─── Agente Foundry ──────────────────────────────────────────────────────────
app.post('/api/agent/chat', send(async (body) => {
  const { message, conversationId, threadId, context } = body;
  if (Object.hasOwn(body, 'scenario')) throw bad('Use context.scenario para selecionar o cenário do agente.');
  if (typeof message !== 'string' || !message.trim()) throw bad('message obrigatório');
  if (message.length > 4000) throw bad('mensagem muito longa');
  return chat({
    message,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    threadId: typeof threadId === 'string' ? threadId : undefined,
    context: context && typeof context === 'object' ? context : undefined,
  });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'rota não encontrada' }));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'JSON inválido' : err.message }));

// Em produção (npm run build), o mesmo servidor entrega a SPA.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) app.use(express.static(dist));

export const server = app.listen(PORT, HOST, () => {
  console.log(`🔌 IoT proxy em http://localhost:${PORT}`);
  console.log(`   Cenários com catálogo registrado: ${Object.keys(scenarios).join(', ')}`);
  for (const id of Object.keys(scenarios)) {
    const c = fabricConfig(id);
    console.log(`   ${id}: Eventstream ${canPublish(c) ? 'ok' : '—'} · Eventhouse ${canQuery(c) ? 'ok' : '—'}${useLoopback(c) ? ' · loopback ATIVO' : ''} · Foundry ${foundryConfigured(id) ? 'ok' : '—'}`);
  }
});
