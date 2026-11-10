// Ponto de entrada da SPA: cena 3D + store reativo + integrações (Fabric RTI / Foundry).
import { $, pad, toast } from './ui/dom.js';
import { store, selectMachine, closeEditor, attachTelemetrySource, applyTelemetry, setConnection, resetScenario } from './core/state.js';
import { createTelemetrySource } from './integration/telemetry/index.js';
import { createAgent } from './integration/agent/index.js';
import { machineSnapshot } from './integration/agent/context.js';
import { mountSidePanels, hydrateChrome } from './ui/sidePanels.js';
import { mountInfoPanel } from './ui/infoPanel.js';
import { mountParamsModal } from './ui/paramsModal.js';
import { mountAssistant } from './ui/assistant.js';
import { activeScenario, readScenarioId, saveScenarioId, setActiveScenario } from './usecases/registry.js';

const ENV_TELEMETRY = import.meta.env?.VITE_TELEMETRY_MODE === 'fabric' ? 'fabric' : 'mock';
const ENV_AGENT = import.meta.env?.VITE_AGENT_MODE || 'mock';

// ─── Cabeçalho: relógio, sessão ───────────────────────────────────────────
let sessionSeconds = 4 * 60 * 60;
function tick() {
  const now = new Date();
  $('#clock-time').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  $('#clock-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  if (sessionSeconds > 0) sessionSeconds--;
  const h = Math.floor(sessionSeconds / 3600), m = Math.floor((sessionSeconds % 3600) / 60), s = sessionSeconds % 60;
  $('#session-expire').textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}
tick();
setInterval(tick, 1000);
$('#btn-logout').addEventListener('click', () =>
  alert('Sessão de demonstração — o encerramento de sessão não está habilitado nesta página mock.'));

let scene = null;
let source = null;
let agent = null;
let switching = false;

const assistant = mountAssistant({
  mode: 'mock', label: 'Agente local (mock)', reset() {},
  async send() { return { text: 'Aguarde o cenário carregar.' }; },
});
const panels = mountSidePanels({ source: { mode: 'mock' } });
mountInfoPanel({ onAsk: (q) => assistant.open(q) });
mountParamsModal();
store.subscribe(['selection'], (s) => scene?.select(s.selectedId));

function modesFor(profile) {
  return {
    telemetry: profile.forceMock ? 'mock' : ENV_TELEMETRY,
    agent: profile.forceMock ? 'mock' : ENV_AGENT,
  };
}

async function activate(id, { retryScene = false } = {}) {
  if (switching) return;
  switching = true;
  const select = $('#scenario-select');
  const container = $('#canvas-container');
  select.disabled = true;
  try {
    if (retryScene && id !== store.state.scenario) return;
    if (!retryScene) source?.stop?.();
    scene?.dispose?.();
    scene = null;
    container.replaceChildren();
    let profile;
    if (retryScene) {
      profile = activeScenario();
    } else {
      closeEditor();
      selectMachine(null);
      profile = setActiveScenario(id);
      saveScenarioId(profile.id);
      const modes = modesFor(profile);
      const assets = profile.createAssets();
      if (modes.telemetry === 'fabric') assets.forEach((d) => { d.commLost = true; });
      resetScenario(assets, profile.initialKpis, {
        scenario: profile.id, plant: profile.plant, operator: profile.operator,
      });
      hydrateChrome(profile);
      $('#env-badge').textContent = profile.envBadge(modes.telemetry, modes.agent);
      source = createTelemetrySource(modes.telemetry, store.state.machines, profile.id, profile.createSimulation);
      panels.setSource(source);
      attachTelemetrySource(source);
      setConnection({ mode: source.mode, status: 'connecting', detail: '' });
      agent = createAgent(modes.agent, {
        snapshotOf: (mid) => machineSnapshot(store.state.byId[mid]),
        kb: profile.kb,
        assistant: profile.assistant,
      });
      assistant.bind(agent);
      source.start({ onTelemetry: applyTelemetry, onStatus: setConnection });
      window.iot = { store, get source() { return source; }, get agent() { return agent; }, activate };
    }

    container.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div');
    loading.className = 'scene-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = 'Carregando cenário 3D e recursos locais…';
    container.appendChild(loading);
    try {
      scene = await profile.bootScene(container, store.state.machines, { onPick: selectMachine });
      scene.select(store.state.selectedId);
      if (retryScene) toast('Cena 3D carregada novamente.');
    } catch (error) {
      scene?.dispose?.();
      scene = null;
      console.error(error);
      const message = document.createElement('div');
      message.className = 'scene-error';
      message.setAttribute('role', 'alert');
      const text = document.createElement('p');
      text.textContent = `Não foi possível carregar a cena 3D: ${error.message}`;
      const detail = document.createElement('p');
      detail.textContent = 'A telemetria e os controles continuam disponíveis. Verifique os recursos locais e tente novamente.';
      const summary = document.createElement('span');
      summary.className = 'scene-error-compact';
      summary.setAttribute('aria-hidden', 'true');
      summary.textContent = 'Cena 3D indisponível';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Tentar novamente';
      retry.addEventListener('click', () => activate(profile.id, { retryScene: true }));
      message.append(text, detail, summary, retry);
      container.appendChild(message);
      toast(`Falha ao carregar a cena 3D: ${error.message}`, 'err');
    } finally {
      loading.remove();
      container.setAttribute('aria-busy', 'false');
    }
    const emoji = { factory: '🏭', farm: '🌾', energy: '⚡', mining: '⛏️' }[profile.id] || '🏭';
    console.log(`${emoji} IoT SPA — ${store.state.machines.length} ativos · ${profile.id} · telemetria=${source.mode} · agente=${agent.mode}`);
  } catch (e) {
    console.error(e);
    toast(`Não foi possível trocar a simulação: ${e.message}`, 'err');
  } finally {
    switching = false;
    select.disabled = false;
    select.value = store.state.scenario;
  }
}

$('#scenario-select').addEventListener('change', (e) => {
  if (e.target.value !== store.state.scenario) activate(e.target.value);
});

activate(readScenarioId());
