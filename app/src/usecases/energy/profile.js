// Perfil do cenário Smart Energy: textos, KPIs e catálogo da estação de energia.
import { energyKb, createEnergyAssets, energyParamSchema, COMMANDS } from './catalog.js';
import { createEnergySimulation } from './simulation.js';

const fmt = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const energyProfile = {
  id: 'energy',
  forceMock: false,
  documentTitle: 'Smart Energy — Central de Monitoramento',
  plant: 'Estação de Energia Vale do Rio Verde · Solar + Hidrelétrica + Recarga',
  operator: { login: 'c.andrade', name: 'Camila Andrade', avatar: 'CA', meta: 'Matrícula 30512 · Engenheira de operação' },
  initialKpis: { commands: 4, paramChanges: 0, unplanned: 1 },
  kb: energyKb,
  createAssets: createEnergyAssets,
  createSimulation: createEnergySimulation,
  paramSchema: energyParamSchema,
  commandsFor: (asset) => COMMANDS[asset?.family] || COMMANDS.solar,
  publishNote: 'Alterações são pré-visualizadas ao vivo. <b>Aplicar</b> sincroniza com o controle HTTP local do simulador.',
  previewNote: '<span class="preview-tag">PRÉ-VISUALIZAÇÃO</span> Status e limites já refletem o ajuste. <b>Aplicar</b> sincroniza com o simulador e a telemetria converge.',
  envBadge(telemetryMode, agentMode) {
    return [
      telemetryMode === 'fabric' ? 'Telemetria: Fabric RTI' : 'Telemetria simulada',
      agentMode === 'foundry' ? 'Agente: Foundry' : 'Agente mock',
    ].join(' · ');
  },
  kpiRows(s) {
    const running = s.machines.filter((m) => m.status !== 'offline');
    const avail = s.machines.length ? running.length / s.machines.length : 0;
    const read = (id, key) => {
      const d = s.byId[id];
      return d && !d.commLost && Number.isFinite(d[key]) ? `${fmt(d[key], 1)} kW` : '—';
    };
    const queue = s.machines.filter((m) => m.vehicleState === 'seeking').length;
    const color = avail >= 0.9 ? 'var(--green)' : avail >= 0.75 ? 'var(--yellow)' : 'var(--red)';
    return [
      { label: 'Disponibilidade', value: `${fmt(avail * 100, 1)} %`, color },
      { label: 'Solar entregue à rede', value: read('RED-SOL-001', 'powerKw') },
      { label: 'Hidrelétrica entregue à rede', value: read('RED-HID-001', 'powerKw') },
      { label: 'Demanda da cidade', value: read('RED-CID-001', 'demandKw') },
      { label: 'Déficit de fornecimento', value: read('RED-CID-001', 'unservedKw'), color: s.byId['RED-CID-001']?.unservedKw > 0.01 ? 'var(--yellow)' : '' },
      { label: 'Veículos na fila de recarga', value: String(queue), color: queue > 6 ? 'var(--yellow)' : '' },
      { label: 'Comandos enviados', value: String(s.kpis.commands) },
      { label: 'Ajustes de parâmetros', value: String(s.kpis.paramChanges) },
    ];
  },
  chrome: {
    wordmark: 'Smart <b>Energy</b>',
    title: 'Central de Monitoramento — Estação de Energia',
    subtitle: 'Estação de Energia Vale do Rio Verde · Solar + Hidrelétrica + Recarga',
    hud: '⚡ Smart Energy <small>SPA · reativa · Fabric RTI</small>',
    assetsTitle: 'Ativos da estação',
    howtoTitle: 'Como operar o painel',
    howto: [
      '<b>Selecione um dos 40 ativos</b> — painel, inversor, turbina, casa, veículo, circuito ou posto de recarga.',
      '<b>Ajuste parâmetros</b> — use <b>⚙️ Ajustar parâmetros</b>: cada alteração já reflete na cena e nos alertas (pré-visualização). <b>Aplicar</b> sincroniza com o dispositivo.',
      '<b>Envie um comando</b> — escolha a ação e confirme em <b>Enviar</b>; o efeito aparece imediatamente.',
      '<b>Tire dúvidas</b> — o <b>Assistente IA</b> (botão 🤖) explica alarmes e o funcionamento de cada ativo.',
    ],
    procTitle: 'Procedimento em caso de alerta',
    proc: [
      'Confirme a leitura do sensor no painel do ativo antes de qualquer ação.',
      'Sujidade do painel ou fator de potência fora da faixa: agende limpeza/manutenção e, se necessário, aplique <b>SLOW_DOWN</b> para reduzir a carga.',
      'Vibração da turbina acima do limite: aplique <b>PAUSE</b> e solicite inspeção mecânica dos mancais.',
      'Nível do reservatório baixo ou fila de veículos acima do limite: avalie reduzir a geração ou a potência de carga; risco confirmado exige <b>EMERGENCY_STOP</b> e aviso ao supervisor.',
    ],
    callout: '<b>Atenção:</b> comandos de parada afetam a geração ou a disponibilidade dos postos de recarga. Use <kbd>EMERGENCY_STOP</kbd> apenas em situação de risco confirmado.',
    contactsTitle: 'Contatos da operação',
    contacts: [
      ['Centro de operação', 'Ramal 5102'],
      ['Manutenção elétrica', 'Ramal 5177'],
      ['Segurança / SESMT', 'Ramal 5190'],
      ['Suporte TI / IoT', 'Ramal 5008'],
    ],
    session: [
      ['Usuário', 'c.andrade'],
      ['Perfil de acesso', 'Operação · Nível 2'],
      ['Login em', '08:02'],
      ['Permissão de comando', 'Liberada'],
    ],
    kpiTitle: 'Indicadores da estação',
    syncTitle: 'Sincronização Fabric RTI',
    syncSource: 'Fabric Eventhouse',
    gateway: 'Gateway de borda',
    footer: 'Smart Energy · Real-Time Intelligence + Foundry Agents · v1.0.0',
    contextAll: 'estação inteira',
    summaryChip: 'Resumo da estação',
    askPlaceholder: 'Pergunte sobre geração, casas, veículos ou circuitos…',
  },
  assistant: {
    intro: 'Olá! Sou o assistente da Smart Energy. Monitoro geração solar e hídrica, dez casas, seis veículos, recarga e três circuitos. A simulação é didática: déficit reduz proporcionalmente o atendimento; veículos buscam recarga com 20% de bateria e saem com 80%.',
    empty: 'Posso explicar ativos solares, hidrelétricos e postos de recarga.\nSelecione um ativo na cena ou cite o código (ex.: "Por que o SOL-INV-002 está em alerta?").',
    commands: 'Comandos neste cenário (mesmo canal da fábrica):\n• Parada de emergência / bloqueio — modo Desligado\n• Pausar / retomar — interrompe e devolve a geração ou o carregamento\n• Acelerar / reduzir — ±10% de potência, abertura ou carga\n• Calibrar — recalibra sensores e medidores\n• Reiniciar ciclo — volta ao modo Automático',
  },
};
