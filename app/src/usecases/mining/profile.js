import { createMiningAssets, miningKb, miningParamSchema, MINING_COMMANDS } from './catalog.js';
import { createMiningSimulation } from './simulation.js';

const fmt = (value, digits = 1) => Number(value).toLocaleString('pt-BR', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});

export const miningProfile = {
  id: 'mining',
  forceMock: false,
  documentTitle: 'Smart Mining — Central de Monitoramento IoT',
  plant: 'Mina Serra Clara · Extração, beneficiamento e entrega',
  operator: { login: 'r.costa', name: 'Rafaela Costa', avatar: 'RC', meta: 'Matrícula 41032 · Gestão de operações' },
  initialKpis: { pieces: 0, commands: 0, paramChanges: 0, unplanned: 0 },
  kb: miningKb,
  createAssets: createMiningAssets,
  createSimulation: createMiningSimulation,
  paramSchema: miningParamSchema,
  commandsFor: () => MINING_COMMANDS,
  publishNote: 'Alterações são pré-visualizadas ao vivo. <b>Aplicar</b> sincroniza com o controle HTTP local do simulador.',
  previewNote: '<span class="preview-tag">PRÉ-VISUALIZAÇÃO</span> Os limites já refletem o ajuste. <b>Aplicar</b> atualiza o dispositivo simulado.',
  envBadge(telemetryMode, agentMode) {
    return [
      telemetryMode === 'fabric' ? 'Telemetria: Fabric RTI' : 'Telemetria simulada',
      agentMode === 'foundry' ? 'Agente: Foundry' : 'Agente mock',
    ].join(' · ');
  },
  kpiRows(state) {
    const read = (id, key, unit, digits = 1) => {
      const asset = state.byId[id];
      return asset && !asset.commLost && Number.isFinite(asset[key]) ? `${fmt(asset[key], digits)} ${unit}` : '—';
    };
    const available = state.machines.filter((asset) => asset.status !== 'offline').length;
    const silos = state.machines.filter((asset) => asset.type === 'product-silo');
    const stock = silos.every((asset) => !asset.commLost && Number.isFinite(asset.inventoryT))
      ? `${fmt(silos.reduce((sum, asset) => sum + asset.inventoryT, 0))} t` : '—';
    return [
      { label: 'Ativos disponíveis', value: `${available}/${state.machines.length}` },
      { label: 'Minério extraído', value: read('MIN-EXC-001', 'extractedT', 't') },
      { label: 'Vazão de beneficiamento', value: read('MIN-PRC-001', 'throughputTph', 't/h', 0) },
      { label: 'Produto nos silos', value: stock },
      { label: 'Produto entregue', value: read('MIN-TER-001', 'deliveredT', 't') },
      { label: 'Rejeitos acumulados', value: read('MIN-PRC-001', 'tailingsT', 't') },
      { label: 'Comandos enviados', value: String(state.kpis.commands) },
      { label: 'Ajustes de parâmetros', value: String(state.kpis.paramChanges) },
    ];
  },
  chrome: {
    wordmark: 'Smart <b>Mining</b>',
    title: 'Central de Monitoramento IoT — Smart Mining',
    subtitle: 'Mina Serra Clara · 4 caminhões de mina · 3 britagens · 6 silos · 3 centros de distribuição',
    hud: '⛏️ Smart Mining <small>extração · beneficiamento · entrega</small>',
    assetsTitle: 'Ativos da mineração',
    howtoTitle: 'Como explorar o fluxo',
    howto: [
      '<b>Selecione um dos 21 ativos</b> na cena ou na lista: cava, quatro caminhões de mina, três britadores, correia, usina, seis silos, caminhão de entrega, terminal e três centros de distribuição.',
      '<b>Acompanhe os estoques e as vazões</b> — os caminhões abastecem as britagens por faixas independentes; a expedição alterna silos e centros de distribuição disponíveis.',
      '<b>Explore os alertas demonstrativos</b> — vibração no britador 2 e temperatura no silo 5 e no centro de distribuição 2 permanecem visíveis na simulação.',
      '<b>Pause ou retome uma etapa</b> — ela interrompe sua atividade; outras etapas podem continuar enquanto houver estoque.',
      '<b>Pergunte ao assistente</b> sobre equipamentos, alertas, beneficiamento e entrega.',
    ],
    procTitle: 'Ao investigar um alerta',
    proc: [
      'Confira os dados e os limites no painel do ativo selecionado.',
      'Observe o estoque anterior e a disponibilidade da etapa seguinte.',
      'Use pausa e retomada para explorar o efeito no fluxo simulado.',
    ],
    callout: '<b>Demonstração:</b> use telemetria local ou Microsoft Fabric e assistente local ou Microsoft Foundry. Dados e taxas simulados são ilustrativos; o controle HTTP não opera equipamentos reais nem substitui procedimentos operacionais.',
    contactsTitle: 'Contatos demonstrativos',
    contacts: [['Centro de operação', 'Ramal 6102'], ['Manutenção', 'Ramal 6177'], ['Suporte IoT', 'Ramal 6008']],
    session: [['Usuário', 'r.costa'], ['Perfil de acesso', 'Operação · demonstração'], ['Login em', '07:00'], ['Permissão de comando', 'Simulada']],
    kpiTitle: 'Indicadores da mina',
    syncTitle: 'Sincronização da telemetria',
    syncSource: 'Simulador local · mina',
    gateway: 'Gateway da mina',
    footer: 'Smart Mining · Real-Time Intelligence + Foundry Agents · v1.0.0',
    contextAll: 'mina inteira',
    summaryChip: 'Resumo da mina',
    askPlaceholder: 'Pergunte sobre extração, beneficiamento ou entrega…',
  },
  assistant: {
    intro: 'Olá! Sou o assistente da Smart Mining. Acompanho 21 ativos, incluindo quatro caminhões de mina, três britagens, seis silos e três centros de distribuição. A simulação inclui alertas demonstrativos e não controla equipamentos reais.',
    empty: 'Posso explicar a cadeia da mina e seus ativos. Selecione um equipamento ou cite um código, como MIN-BRI-001.',
    commands: 'Comandos da simulação: PAUSE e RESUME interrompem ou retomam uma etapa; SPEED_UP e SLOW_DOWN alteram o ritmo; CALIBRATE atua no sensor simulado; EMERGENCY_STOP desliga o ativo.',
    summary(context) {
      const readings = Object.fromEntries(context.machines.map((machine) => [machine.id, machine.telemetry]));
      const value = (id, key, unit) => Number.isFinite(readings[id]?.[key]) ? `${fmt(readings[id][key])} ${unit}` : 'sem leitura';
      const silos = context.machines.filter((machine) => machine.type === 'product-silo');
      const stock = silos.every((machine) => Number.isFinite(machine.telemetry?.inventoryT))
        ? `${fmt(silos.reduce((sum, machine) => sum + machine.telemetry.inventoryT, 0))} t` : 'sem leitura';
      return `Fluxo simulado: ${value('MIN-EXC-001', 'extractedT', 't')} extraídas; ${stock} nos seis silos; ${value('MIN-TER-001', 'deliveredT', 't')} entregues aos três centros de distribuição; ${value('MIN-PRC-001', 'tailingsT', 't')} de rejeitos.`;
    },
  },
};
