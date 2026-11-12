// Painel da máquina selecionada (métricas ao vivo, setpoints, comandos).
import { $, el, setText, fmt, hms, toast } from './dom.js';
import { store, selectMachine, openEditor, sendCommand } from '../core/state.js';
import { MODES } from '../domain/paramSchema.js';
import { STATUS_LABEL } from '../domain/rules.js';
import { activeScenario } from '../usecases/registry.js';
import { metricsOf, metricOver, metricRatio } from '../domain/metrics.js';
import { VEHICLE_STATE_LABELS } from '../domain/telemetry.js';

export function mountInfoPanel({ onAsk, agentMode }) {
  const panel = $('#info-panel');
  const prevStatus = {};

  $('#panel-close').addEventListener('click', () => selectMachine(null));
  $('#btn-params').addEventListener('click', () => store.state.selectedId && openEditor(store.state.selectedId));
  $('#btn-ask').addEventListener('click', () => {
    const m = store.state.byId[store.state.selectedId];
    if (!m) return;
    onAsk(m.status === 'online' ? `Como funciona a ${m.id}?` : `Por que a ${m.id} está em ${STATUS_LABEL[m.status].toLowerCase()}?`);
  });

  $('#cmd-send').addEventListener('click', async () => {
    const sel = $('#cmd-select');
    const cmd = sel.value;
    const m = store.state.byId[store.state.selectedId];
    if (!cmd || !m) return;
    if (m.commLost && cmd !== 'RESUME' && cmd !== 'CYCLE_START') {
      toast(`⚠️ ${m.id} está sem telemetria. Use Retomar etapa para tentar reconectar antes de enviar outros comandos.`, 'err');
      return;
    }
    const spec = activeScenario().commandsFor(m).find((c) => c.id === cmd);
    if (spec?.confirm && !confirm(`Confirmar ${spec.label} em ${m.id} — ${m.name}?`)) return;
    sel.value = '';
    try {
      await sendCommand(m.id, cmd);
      toast(`✅ Comando "${cmd}" enviado para ${m.id} — ${m.name}`);
    } catch (e) {
      toast(`⚠️ Falha ao enviar ${cmd}: ${e.message}`, 'err');
    }
  });

  function bar(id, ratio, over) {
    const i = $(id);
    i.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
    i.style.background = over ? 'var(--red)' : ratio > 0.9 ? 'var(--yellow)' : '#2dd4bf';
  }

  store.subscribe(['selection', 'machines'], (s) => {
    const m = s.selectedId ? s.byId[s.selectedId] : null;
    if (!m) { panel.classList.remove('visible'); return; }
    panel.classList.add('visible');
    setText($('#panel-name'), `${m.id} — ${m.name}`);
    setText($('#panel-type'), m.typeLabel || m.type);
    const sel = $('#cmd-select');
    const available = activeScenario().commandsFor(m);
    const cmds = m.commLost
      ? available.filter((command) => ['RESUME', 'CYCLE_START'].includes(command.id))
      : available;
    const commandKey = `${store.state.scenario}:${m.family || 'factory'}:${m.commLost ? 'offline' : 'online'}`;
    if (sel.dataset.family !== commandKey) {
      sel.dataset.family = commandKey;
      sel.replaceChildren(
        el('option', { value: '' }, m.commLost ? '— Reconectar / retomar —' : '— Enviar comando —'),
        ...cmds.map((c) => el('option', { value: c.id }, c.label)),
      );
    }
    const badge = $('#panel-status');
    setText(badge, STATUS_LABEL[m.status]);
    badge.className = 'status-badge ' + m.status;
    if (prevStatus[m.id] && prevStatus[m.id] !== m.status) {
      panel.querySelectorAll('.metric').forEach((x) => { x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash'); });
    }
    prevStatus[m.id] = m.status;

    const reasons = $('#panel-reasons');
    reasons.replaceChildren(...m.reasons.map((r) => el('div', { class: r.level }, '⚠ ', r.text)));

    const p = m.params;
    const off = m.commLost;
    const metrics = metricsOf(m);
    const slots = panel.querySelectorAll('.metric');
    metrics.forEach((metric, i) => {
      const slot = slots[i];
      if (!slot) return;
      const over = !off && metricOver(m, metric);
      const value = m[metric.key];
      slot.querySelector('.m-label').textContent = metric.label;
      const shown = off || !Number.isFinite(value) ? '—' : `${fmt(value, metric.digits || 0)} ${metric.unit}`;
      const val = slot.querySelector('.m-value');
      setText(val, shown);
      val.classList.toggle('over', over);
      bar(`#${slot.querySelector('.bar i').id}`, off ? 0 : metricRatio(m, metric), over);
    });

    const schema = activeScenario().paramSchema(m.type);
    const sum = $('#panel-params');
    const items = [
      ['Operação (telemetria)', m.isRunning ? 'Em funcionamento' : 'Parado'],
      ...(s.scenario === 'pharma' ? [
        ['Lote em atendimento', off ? '—' : m.batchId || 'Nenhum'],
        ['Qualidade do lote', off ? '—' : m.batchStatus || 'Sem leitura'],
      ] : []),
      ...(m.vehicleState ? [
        ['Mobilidade', VEHICLE_STATE_LABELS[m.vehicleState] || '—'],
        ...(s.scenario === 'energy' ? [['Posto reservado', m.chargerId || 'Nenhum']] : []),
      ] : []),
      ...(Number.isFinite(m.supplyPct) ? [['Atendimento elétrico', `${fmt(m.supplyPct, 0)} %`]] : []),
      ...(m.location ? [['Localização', m.location]] : []),
      ...Object.keys(schema).map((k) => {
        const spec = schema[k];
        const v = p[k];
        const shown = k === 'mode' ? (MODES[v] || v) : `${fmt(v, String(spec.step || 1).includes('.') ? 1 : 0)} ${spec.unit || ''}`.trim();
        return [spec.label, shown];
      }),
    ];
    if (sum.children.length !== items.length) sum.replaceChildren(...items.map(([k]) => el('div', {}, `${k}: `, el('b'))));
    items.forEach(([k, v], i) => {
      sum.children[i].firstChild.textContent = `${k}: `;
      setText(sum.children[i].querySelector('b'), v);
    });

    const who = s.operator?.login || 'm.silveira';
    const via = s.connection.mode === 'fabric' ? 'Fabric RTI' : s.scenario === 'farm' ? 'simulador da fazenda' : 'simulador';
    setText($('#panel-hint'), off
      ? s.connection.mode === 'fabric'
        ? `Sem leitura do Fabric. Verifique a conexão, o Eventhouse e o simulador; RESUME não corrige falhas de rede (${who}).`
        : `Sem leitura desde ${hms(new Date(m.lastSeen))} · envie RESUME para tentar reconectar antes de outros comandos (${who}).`
      : `Leitura ${hms(new Date(m.lastSeen))} via ${via} · comandos executados como ${who} e registrados no log.`);
  });
}
