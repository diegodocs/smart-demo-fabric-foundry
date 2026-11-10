// Adaptador Fabric Real-Time Intelligence (via proxy em /api).
//   Leitura : Eventhouse (KQL) → proxy → Server-Sent Events  (/api/telemetry/stream)
//   Controle: UI → proxy HTTP → simulador (/api/params, /api/commands)
// As credenciais (SAS / Entra ID) ficam apenas no servidor.

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function createFabricSource({ apiBase = '', scenario = 'factory' } = {}) {
  let es = null;
  let handlers = {};
  let lastTs = 0;
  let status = 'connecting';
  const qs = `?scenario=${encodeURIComponent(scenario)}`;
  const notifyStatus = (patch) => {
    status = patch.status;
    handlers.onStatus?.(patch);
  };

  return {
    mode: 'fabric',
    describe() { return 'Fabric RTI · Eventhouse (KQL) via proxy'; },
    start(h) {
      handlers = h;
      notifyStatus({ status: 'connecting', detail: 'Conectando ao proxy do Fabric…' });
      es = new EventSource(`${apiBase}/api/telemetry/stream${qs}`);
      es.onopen = () => notifyStatus({ status: 'connected', detail: this.describe() });
      es.onerror = () => notifyStatus({
        status: 'error',
        detail: 'Sem conexão com o proxy /api (npm run server) — tentando reconectar…',
      });
      es.addEventListener('telemetry', (ev) => {
        const msg = JSON.parse(ev.data);
        if (status === 'error') notifyStatus({ status: 'connected', detail: this.describe() });
        const now = Date.now();
        const dtSec = lastTs ? (now - lastTs) / 1000 : 1;
        lastTs = now;
        handlers.onTelemetry?.(msg.items || [], { latencyMs: msg.latencyMs, dtSec });
      });
      es.addEventListener('status', (ev) => notifyStatus(JSON.parse(ev.data)));
    },
    stop() { es?.close(); },
    publishParams(machineId, params) {
      return post(`${apiBase}/api/params`, { machineId, params, scenario });
    },
    sendCommand(machineId, command) {
      return post(`${apiBase}/api/commands`, { machineId, command, scenario });
    },
  };
}
