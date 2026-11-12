// Perfil do cenário Smart Farm: textos de interface, KPIs e vínculo com o catálogo/kb da fazenda.
import { farmKb, createFarmAssets, farmParamSchema, COMMANDS } from './catalog.js';

const fmt = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const farmProfile = {
  id: 'farm',
  forceMock: false,
  documentTitle: 'Smart Farm — Central de Monitoramento',
  plant: 'Fazenda Santa Luzia · Talhão Norte · Turno diurno',
  operator: { login: 'a.ribeiro', name: 'Ana Ribeiro', avatar: 'AR', meta: 'Matrícula 11820 · Gestora da propriedade' },
  initialKpis: { pieces: 0, commands: 3, paramChanges: 0, unplanned: 1 },
  kb: farmKb,
  createAssets: createFarmAssets,
  paramSchema: farmParamSchema,
  commandsFor: (asset) => COMMANDS[asset?.family] || COMMANDS.field,
  publishNote: 'Alterações são pré-visualizadas ao vivo. <b>Aplicar</b> sincroniza com o controle HTTP local do simulador.',
  previewNote: '<span class="preview-tag">PRÉ-VISUALIZAÇÃO</span> Status e limites já refletem o ajuste. <b>Aplicar</b> sincroniza com o gêmeo simulado e a telemetria converge.',
  envBadge(telemetryMode, agentMode) {
    return [
      telemetryMode === 'fabric' ? 'Telemetria: Fabric RTI' : 'Telemetria simulada',
      agentMode === 'foundry' ? 'Agente: Foundry' : 'Agente mock',
    ].join(' · ');
  },
  kpiRows(s) {
    const running = s.machines.filter((m) => m.status !== 'offline');
    const avail = s.machines.length ? running.length / s.machines.length : 0;
    const field = s.machines.filter((m) => !m.commLost && m.family === 'field' && Number.isFinite(m.fuel));
    const fuel = field.length ? field.reduce((a, m) => a + m.fuel, 0) / field.length : 0;
    const herds = s.machines.filter((m) => !m.commLost && m.family === 'herd' && Number.isFinite(m.headcount));
    const animals = herds.reduce((a, m) => a + m.headcount, 0);
    const barnAlert = s.machines.filter((m) => m.family === 'barn' && m.status === 'alert').length;
    const color = avail >= 0.9 ? 'var(--green)' : avail >= 0.75 ? 'var(--yellow)' : 'var(--red)';
    return [
      { label: 'Disponibilidade', value: `${fmt(avail * 100, 1)} %`, color },
      { label: 'Combustível médio', value: field.length ? `${fmt(fuel, 0)} %` : '—', color: field.length && fuel < 30 ? 'var(--yellow)' : 'var(--green)' },
      { label: 'Animais monitorados', value: herds.length ? fmt(animals) : '—' },
      { label: 'Instalações em alerta', value: String(barnAlert), color: barnAlert ? 'var(--yellow)' : 'var(--green)' },
      { label: 'Comandos enviados', value: String(s.kpis.commands) },
      { label: 'Ajustes de parâmetros', value: String(s.kpis.paramChanges) },
    ];
  },
  chrome: {
    wordmark: 'Smart <b>Farm</b>',
    title: 'Central de Monitoramento — Smart Farm',
    subtitle: 'Fazenda Santa Luzia · Talhão Norte · Turno diurno (06:00 – 14:00)',
    hud: '🌾 Smart Farm <small>campo · rebanho · instalações</small>',
    assetsTitle: 'Ativos da propriedade',
    howtoTitle: 'Como operar o painel',
    howto: [
      '<b>Selecione um ativo</b> — máquina de campo, lote ou instalação, na cena 3D ou na lista.',
      '<b>Ajuste parâmetros</b> — velocidade, temperatura, combustível mínimo, cerca ou ventilação. A pré-visualização já muda alertas e ritmo.',
      '<b>Envie um comando</b> — o controle local confirma o recebimento; confira o resultado na telemetria do simulador.',
      '<b>Pergunte ao assistente</b> — use a base local ou o agente Microsoft Foundry configurado, com contexto da fazenda.',
    ],
    procTitle: 'Procedimento em caso de alerta',
    proc: [
      'Confirme a leitura no painel do ativo antes de agir.',
      'Combustível no mínimo: reduza a velocidade e retorne o equipamento para abastecer.',
      'Animal fora da cerca ou febre no lote: use <b>Localizar lote</b> e contenha se o risco persistir.',
      'Amônia ou calor no galpão: aumente a ventilação. Risco ao plantel: <b>Exaustão de emergência</b>.',
    ],
    callout: '<b>Demonstração:</b> use telemetria local ou Microsoft Fabric e assistente local ou Microsoft Foundry. Comandos atuam somente no simulador; a interface não controla equipamentos reais.',
    contactsTitle: 'Contatos da propriedade',
    contacts: [
      ['Capatazia', 'Ramal 2101'],
      ['Veterinária', 'Ramal 2144'],
      ['Manutenção agrícola', 'Ramal 2170'],
      ['Suporte IoT', 'Ramal 2008'],
    ],
    session: [
      ['Usuário', 'a.ribeiro'],
      ['Perfil de acesso', 'Gestão · Nível 2'],
      ['Login em', '06:05'],
      ['Permissão de comando', 'Liberada'],
    ],
    kpiTitle: 'Indicadores da propriedade',
    syncTitle: 'Sincronização da telemetria',
    syncSource: 'Simulador local · gateway da fazenda',
    gateway: 'Gateway da propriedade',
    footer: 'Smart Farm · Real-Time Intelligence + Foundry Agents · v1.0.0',
    contextAll: 'fazenda inteira',
    summaryChip: 'Resumo da fazenda',
    askPlaceholder: 'Pergunte sobre máquinas, rebanhos ou galpões…',
  },
  assistant: {
    intro: 'Olá! Sou o assistente local da Smart Farm. Posso explicar tratores, colheita, coleiras do rebanho e o clima dos galpões com base na telemetria disponível.',
    empty: 'Posso explicar máquinas de campo, rebanhos e instalações.\nSelecione um ativo na cena ou cite o código (ex.: "Por que a SUI-003 está em alerta?").',
    commands: 'Comandos neste cenário (mesmo canal do mock da fábrica):\n• Parada de emergência / conter lote / exaustão — modo Desligado\n• Pausar / retomar — interrompe e devolve o ciclo\n• Acelerar / reduzir — ±10% de velocidade, ventilação ou atividade\n• Calibrar / localizar — recalibra o sensor ou aproxima o lote da cerca\n• Reiniciar ciclo — volta ao modo Automático',
  },
};
