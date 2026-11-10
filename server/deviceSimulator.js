// Simulador de dispositivos IoT → Fabric Eventstream.
// Controle: SPA → proxy HTTP → simulador. Estado: simulador → Eventstream → Eventhouse.
//
//   npm run simulate:devices
//   SCENARIO=energy npm run simulate:devices   (usa o catálogo e destino desse cenário)
import { DEVICE_CATALOGS, resolveScenario } from './catalogs.js';
import { step, telemetrySnapshot } from '../app/src/domain/simulation.js';
import { fabricConfig, canPublish, publish, closeFabric } from './fabric.js';
import { applyControlSnapshot } from './deviceControl.js';
import { measuredTelemetry } from '../app/src/domain/telemetry.js';

const SCENARIO = resolveScenario(process.env.SCENARIO);
const c = fabricConfig(SCENARIO);
if (!canPublish(c)) {
  const prefix = c.scenarioSpecific ? `FABRIC_${SCENARIO.toUpperCase()}` : 'FABRIC';
  console.error(`Configure ${prefix}_EVENTSTREAM_CONNECTION_STRING e, se necessário, ${prefix}_EVENTSTREAM_NAME para o cenário ${SCENARIO}.`);
  process.exit(1);
}

const INTERVAL_MS = Number(process.env.DEVICE_INTERVAL_MS || 2000);
const devices = DEVICE_CATALOGS[SCENARIO].createAssets();
const simulation = DEVICE_CATALOGS[SCENARIO].createSimulation?.(devices);
const lastApplied = new Map();
let loggedPayload = false;
let initialSample = true;
const controlUrl = `${(process.env.DEVICE_CONTROL_URL || `http://localhost:${process.env.API_PORT || 8787}`).replace(/\/$/, '')}/api/devices/control?scenario=${SCENARIO}`;

async function syncParams() {
  try {
    const res = await fetch(controlUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyControlSnapshot(devices, await res.json(), lastApplied);
  } catch (e) { console.warn('[control] Falha ao buscar controle; mantendo ultimo estado:', e.message); }
}

async function tick() {
  await syncParams();
  const readings = simulation
    ? initialSample ? simulation.snapshot() : simulation.step(INTERVAL_MS / 1000)
    : devices.map((d) => initialSample ? telemetrySnapshot(d) : step(d, INTERVAL_MS / 1000)).filter(Boolean);
  const events = readings.map((t) => {
    const d = devices.find((x) => x.id === t.machineId);
    Object.assign(d, measuredTelemetry(t));
    return { eventType: 'telemetry', scenario: SCENARIO, ...t };
  });
  initialSample = false;
  try {
    await publish(events, c);
    if (!loggedPayload && events.length) {
      console.log('[telemetry] Exemplo de payload aceito pelo endpoint:', JSON.stringify(events[0]));
      loggedPayload = true;
    }
    process.stdout.write(`\r📡 ${new Date().toLocaleTimeString('pt-BR')} · ${SCENARIO} · ${events.length} leituras enviadas   `);
  } catch (e) { console.error('\n[telemetry]', e.message); }
}

console.log(`Simulando ${devices.length} dispositivos (${SCENARIO}) a cada ${INTERVAL_MS} ms → Eventstream; controle HTTP: ${controlUrl}`);
let stopping = false;
let timer;
async function run() {
  await tick();
  if (!stopping) timer = setTimeout(run, INTERVAL_MS);
}
await run();
process.on('SIGINT', async () => { stopping = true; clearTimeout(timer); await closeFabric(); process.exit(0); });
