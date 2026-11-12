// Cliente Fabric Real-Time Intelligence.
//   • Escrita: Eventstream (custom endpoint, protocolo Event Hubs) via @azure/event-hubs.
//   • Leitura: Eventhouse / KQL Database via REST (/v1/rest/query) com token Entra ID.
import { EventHubProducerClient } from '@azure/event-hubs';
import { DefaultAzureCredential } from '@azure/identity';
import { EXTRA_NUMBERS, EXTRA_STRINGS } from '../app/src/domain/telemetry.js';
import { resolveScenario } from './catalogs.js';

const env = (k, d) => process.env[k] || d;

const targetKeys = [
  'EVENTSTREAM_CONNECTION_STRING', 'EVENTSTREAM_NAME', 'KUSTO_URI',
  'KUSTO_DATABASE', 'TELEMETRY_TABLE', 'KUSTO_TENANT_ID',
];

export function fabricConfig(scenario) {
  const id = resolveScenario(scenario);
  const prefix = `FABRIC_${id.toUpperCase()}`;
  const scenarioSpecific = targetKeys.some((key) => process.env[`${prefix}_${key}`]?.trim());
  // A partial scenario override must never inherit shared target fields.
  const target = (key) => scenarioSpecific
    ? process.env[`${prefix}_${key}`]?.trim() || undefined
    : env(`FABRIC_${key}`);
  return {
    scenario: id,
    scenarioSpecific,
    connectionString: target('EVENTSTREAM_CONNECTION_STRING'),
    eventHubName: target('EVENTSTREAM_NAME'),
    kustoUri: target('KUSTO_URI')?.replace(/\/$/, ''),
    database: target('KUSTO_DATABASE'),
    scope: env('FABRIC_KUSTO_SCOPE', 'https://kusto.kusto.windows.net/.default'),
    tenantId: target('KUSTO_TENANT_ID'),
    telemetryTable: target('TELEMETRY_TABLE') || (scenarioSpecific ? undefined : 'MachineTelemetry'),
    pollMs: Number(env('FABRIC_POLL_MS', 2000)),
    staleSec: Number(env('FABRIC_STALE_SEC', 15)),
  };
}

export const canPublish = (c = fabricConfig()) => !!(c.connectionString && (
  !c.scenarioSpecific || c.eventHubName || /(?:^|;)\s*EntityPath\s*=\s*[^;\s]+/i.test(c.connectionString)
));
export const canQuery = (c = fabricConfig()) => !!(
  c.kustoUri && c.database && (!c.scenarioSpecific || c.telemetryTable)
);

let credential;
export const getCredential = () => (credential ??= new DefaultAzureCredential());

const fabricCredentials = new Map();
function getFabricCredential(tenantId) {
  if (!tenantId) return getCredential();
  if (!fabricCredentials.has(tenantId)) fabricCredentials.set(tenantId, new DefaultAzureCredential({ tenantId }));
  return fabricCredentials.get(tenantId);
}

const producers = new Map();
function getProducer(c) {
  const key = JSON.stringify([c.connectionString, c.eventHubName || '']);
  if (!producers.has(key)) {
    producers.set(key, c.eventHubName
      ? new EventHubProducerClient(c.connectionString, c.eventHubName)
      : new EventHubProducerClient(c.connectionString)); // EntityPath já vem na connection string
  }
  return producers.get(key);
}

/** Publica somente telemetria no Eventstream. */
export async function publish(events, c = fabricConfig()) {
  if (events.some((e) => e.eventType !== 'telemetry')) throw new Error('O Fabric recebe somente eventos telemetry.');
  if (!events.length) return;
  if (!canPublish(c)) {
    const prefix = c.scenarioSpecific ? `FABRIC_${c.scenario.toUpperCase()}` : 'FABRIC';
    throw Object.assign(new Error(`Eventstream não configurado (${prefix}_EVENTSTREAM_CONNECTION_STRING e, se necessário, ${prefix}_EVENTSTREAM_NAME).`), { status: 503 });
  }
  const p = getProducer(c);
  const batch = await p.createBatch();
  for (const e of events) {
    if (!batch.tryAdd({ body: e, contentType: 'application/json', properties: { eventType: e.eventType, machineId: e.machineId } })) {
      throw new Error('Evento excede o tamanho máximo do lote.');
    }
  }
  await p.sendBatch(batch);
}

/** Executa uma consulta KQL e devolve a primeira tabela como array de objetos. */
export async function kql(csl, c = fabricConfig()) {
  if (!canQuery(c)) {
    const prefix = c.scenarioSpecific ? `FABRIC_${c.scenario.toUpperCase()}` : 'FABRIC';
    const table = c.scenarioSpecific ? ` / ${prefix}_TELEMETRY_TABLE` : '';
    throw Object.assign(new Error(`Eventhouse não configurado (${prefix}_KUSTO_URI / ${prefix}_KUSTO_DATABASE${table}).`), { status: 503 });
  }
  const { token } = await getFabricCredential(c.tenantId).getToken(c.scope);
  let res;
  try {
    res = await fetch(`${c.kustoUri}/v1/rest/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ db: c.database, csl }),
    });
  } catch (error) {
    const prefix = c.scenarioSpecific ? `FABRIC_${c.scenario.toUpperCase()}` : 'FABRIC';
    const code = error.cause?.code;
    throw new Error(`Falha de conexão com o Eventhouse (${code || error.message}). Verifique ${prefix}_KUSTO_URI, DNS e acesso à rede.`, { cause: error });
  }
  if (!res.ok) throw new Error(`KQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const t = data.Tables?.[0];
  if (!t) return [];
  const cols = t.Columns.map((x) => x.ColumnName);
  return t.Rows.map((r) => Object.fromEntries(cols.map((k, i) => [k, r[i]])));
}

/** Última leitura de cada máquina (últimos 10 min) + horário de ingestão para medir latência. */
export function latestTelemetry(c = fabricConfig()) {
  const extraColumns = EXTRA_NUMBERS.map((k) => `${k} = todouble(column_ifexists("${k}", real(null)))`)
    .concat(EXTRA_STRINGS.map((k) => `${k} = tostring(column_ifexists("${k}", ""))`)).join(', ');
  return kql(`${c.telemetryTable}
| where ts > ago(10m)
| extend ingestedAt = ingestion_time(), isRunning = coalesce(tobool(column_ifexists("isRunning", bool(null))), coalesce(mode !in ("off", "paused") and speed > 0, false))
| extend ${extraColumns}
| summarize arg_max(ts, *) by machineId`, c);
}

export async function closeFabric() {
  const closing = [...producers.values()];
  producers.clear();
  const results = await Promise.allSettled(closing.map((producer) => Promise.resolve().then(() => producer.close())));
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Falha ao fechar produtores do Eventstream.');
}
