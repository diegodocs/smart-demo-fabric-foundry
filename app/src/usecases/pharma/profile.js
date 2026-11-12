import { createPharmaAssets, pharmaId, pharmaKb, pharmaParamSchema, PHARMA_ASSET_DEFINITIONS, PHARMA_COMMANDS } from './catalog.js';
import { createPharmaSimulation } from './simulation.js';

const fmt = (value) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const safety = 'Demonstração: lotes bloqueados não são liberados por comandos, calibração ou ajuste de limites. Em operação real, siga os procedimentos aprovados e a equipe de qualidade.';
const pharmacyIds = PHARMA_ASSET_DEFINITIONS.filter((stage) => stage.type === 'pharma-pharmacy')
  .map((stage) => pharmaId(stage.code, stage.number));

export const pharmaProfile = {
  id: 'pharma', forceMock: false,
  documentTitle: 'Smart Pharma — Cadeia produtiva farmacêutica',
  plant: 'Unidade Pharma · Matéria-prima ao consumidor · Demonstração',
  operator: { login: 'joao.silva', name: 'Joao da Silva', avatar: 'JS', meta: 'Operação demonstrativa' },
  initialKpis: { pieces: 0, commands: 0, paramChanges: 0, unplanned: 0 },
  createAssets: createPharmaAssets, createSimulation: createPharmaSimulation,
  kb: pharmaKb, paramSchema: pharmaParamSchema, commandsFor: () => PHARMA_COMMANDS,
  publishNote: 'Ajustes aplicados somente ao simulador local. Não representam parâmetros aprovados de fabricação.',
  previewNote: '<span class="preview-tag">PRÉ-VISUALIZAÇÃO</span> Ajustes demonstrativos; a faixa de bloqueio da cadeia fria permanece em 2 a 8 °C.',
  envBadge(telemetry, agent) {
    return [telemetry === 'fabric' ? 'Telemetria: Fabric RTI' : 'Telemetria simulada',
      agent === 'foundry' ? 'Agente: Foundry' : 'Agente mock'].join(' · ');
  },
  kpiRows(state) {
    const quality = state.byId['PHA-QUA-001'];
    const approved = quality && !quality.commLost && Number.isFinite(quality.processedBatches) && Number.isFinite(quality.quarantinedUnits)
      ? fmt(quality.processedBatches - quality.quarantinedUnits / 100) : '—';
    const sum = (key) => state.machines.every((asset) => !asset.commLost && Number.isFinite(asset[key]))
      ? fmt(state.machines.reduce((total, asset) => total + asset[key], 0)) : '—';
    const read = (id, key) => {
      const asset = state.byId[id];
      return asset && !asset.commLost && Number.isFinite(asset[key]) ? fmt(asset[key]) : '—';
    };
    const pharmacies = pharmacyIds.map((id) => state.byId[id]);
    const delivered = pharmacies.every((asset) => asset && !asset.commLost && Number.isFinite(asset.deliveredUnits))
      ? fmt(pharmacies.reduce((total, asset) => total + asset.deliveredUnits, 0)) : '—';
    return [
      { label: 'Unidades recebidas', value: read('PHA-REC-001', 'receivedUnits') },
      { label: 'Unidades em processo', value: sum('inventoryUnits') },
      { label: 'Lotes aprovados (simulação)', value: approved },
      { label: 'Unidades bloqueadas', value: sum('quarantinedUnits'), color: 'var(--yellow)' },
      { label: 'Entregues ao consumidor', value: delivered },
      { label: 'Comandos enviados', value: String(state.kpis.commands) },
    ];
  },
  chrome: {
    wordmark: 'Smart <b>Pharma</b>',
    title: 'Central de Monitoramento — Smart Pharma',
    subtitle: 'Cadeia farmacêutica · matéria-prima · produção · qualidade · entrega',
    hud: 'Smart Pharma <small>lotes · qualidade · cadeia fria</small>',
    assetsTitle: 'Ativos da cadeia farmacêutica',
    howtoTitle: 'Como explorar a cadeia',
    howto: [
      '<b>Siga as etapas 1 a 7</b> na faixa do mapa. Clique em uma etapa, no edifício ou na lista para consultar lote, estoque e temperatura.',
      '<b>Acompanhe o fluxo</b>: fábrica → caminhões → centro de distribuição → caminhões → duas farmácias.',
      '<b>Explore bloqueios</b>: cada quinto lote falha em um teste fictício; excursões fora de 2 a 8 °C bloqueiam os lotes na etapa refrigerada.',
      '<b>Pause ou retome</b> uma etapa para observar filas e estoques limitados.',
      '<b>Escolha a fonte</b>: Simulação local funciona sem Fabric; Fabric RTI exige conexão real e simulador Node publicando. A troca reinicia a demonstração local.',
    ],
    procTitle: 'Ao investigar um alerta',
    proc: ['Confira lote, temperatura e comunicação.', 'Observe os bloqueios acumulados e as etapas adjacentes.',
      'Não altere limites para justificar a liberação de medicamentos; esta tela é apenas uma demonstração.'],
    callout: `<b>Sem uso operacional:</b> unidades equivalentes, ritmos, testes e faixa térmica são fictícios. Não certifica BPF/GMP, rastreabilidade regulatória ou segurança de medicamentos. ${safety}`,
    contactsTitle: 'Equipes demonstrativas',
    contacts: [['Qualidade', 'Canal simulado'], ['Logística', 'Canal simulado'], ['Suporte IoT', 'Canal simulado']],
    session: [['Usuário', 'joao.silva'], ['Perfil', 'Demonstração'], ['Login em', 'Sessão simulada'], ['Permissão de comando', 'Somente simulador']],
    kpiTitle: 'Indicadores da cadeia farmacêutica',
    syncTitle: 'Sincronização da telemetria', syncSource: 'Simulador local · Smart Pharma',
    gateway: 'Gateway Pharma', footer: 'Smart Pharma · Real-Time Intelligence + Foundry Agents · Demonstração',
    contextAll: 'cadeia farmacêutica inteira', summaryChip: 'Resumo da cadeia farmacêutica',
    askPlaceholder: 'Pergunte sobre lotes, qualidade ou cadeia fria…',
  },
  assistant: {
    intro: `Olá! Acompanho os ${PHARMA_ASSET_DEFINITIONS.length} ativos da Smart Pharma, da matéria-prima às duas farmácias. ${safety}`,
    empty: `Selecione uma etapa ou cite PHA-QUA-001. Use “Resumo” para acompanhar a cadeia. ${safety}`,
    commands: `PAUSE/RESUME pausam e retomam etapas; SPEED_UP/SLOW_DOWN ajustam ritmos; EMERGENCY_STOP desliga somente o simulador. ${safety}`,
    status(asset) {
      if (asset.commLost) return `${asset.id} · Sem comunicação; lote e qualidade indisponíveis. ${safety}`;
      return `${asset.id} · ${asset.name}: ${asset.statusLabel}.\n${asset.reasons.join('\n')}\nLote: ${asset.telemetry.batchId || 'nenhum'}; ${asset.telemetry.batchStatus || 'sem leitura'}.\n${safety}`;
    },
    summary(context) {
      const values = context.machines.map((asset) => asset.telemetry);
      if (values.some((reading) => !reading || !Number.isFinite(reading.inventoryUnits)
        || !Number.isFinite(reading.quarantinedUnits))) return `Cadeia farmacêutica com leituras incompletas. ${safety}`;
      const deliveries = pharmacyIds.map((id) =>
        context.machines.find((asset) => asset.id === id)?.telemetry?.deliveredUnits);
      const delivered = deliveries.every(Number.isFinite) ? deliveries.reduce((sum, value) => sum + value, 0) : null;
      return `Cadeia farmacêutica: ${fmt(values.reduce((sum, reading) => sum + reading.inventoryUnits, 0))} unidades em processo; ${
        fmt(values.reduce((sum, reading) => sum + reading.quarantinedUnits, 0))} bloqueadas; ${
        Number.isFinite(delivered) ? fmt(delivered) : 'sem leitura completa'} entregues ao consumidor. ${safety}`;
    },
  },
};
