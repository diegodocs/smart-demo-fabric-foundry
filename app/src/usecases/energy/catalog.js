// Catálogo, parâmetros e comandos do Smart Energy (Estação de Energia): fazenda solar,
// hidrelétrica e postos de recarga de carros/caminhões, no mesmo padrão da Smart Farm. Suporta
// mock e conexão real (Fabric/Foundry) — ver server/catalogs.js.
import { MODE_FIELD } from '../../domain/paramSchema.js';
import { runningState } from '../../domain/simulation.js';
import { routePose } from '../../domain/routes.js';
import { SOLAR_POSITIONS, HOUSE_POSITIONS, TURBINE_POSITIONS, CHARGER_POSITIONS,
  CIRCUITS, VEHICLE_IDS, INITIAL_DISTANCES, CITY_ROUTE } from './layout.js';

export const ENERGY_TYPE_LABEL = {
  'solar-array': 'Array solar fotovoltaico',
  'solar-inverter': 'Inversor solar',
  'hydro-turbine': 'Turbina hidrelétrica',
  'hydro-gate': 'Comporta de vertedouro',
  'ev-charger-car': 'Posto de recarga · carros',
  'ev-charger-truck': 'Posto de recarga · caminhões',
  house: 'Casa · medidor inteligente',
  'electric-car': 'Carro elétrico',
  'electric-truck': 'Caminhão elétrico',
  'power-circuit': 'Circuito de distribuição',
};

// Métricas por tipo. fuel/humidity/activity/outside são canais genéricos do motor de regras
// (domain/rules.js) reaproveitados aqui com outro significado físico — o rótulo declarado abaixo
// é o que aparece na interface e nos alertas (ver metricMeta() em domain/rules.js).
const solarArrayMetrics = [
  { key: 'temp', label: 'Temperatura do painel', unit: '°C', digits: 0, limit: 'tempLimit' },
  { key: 'usage', label: 'Potência de saída', unit: '%', digits: 0, scale: 100 },
  { key: 'humidity', label: 'Sujidade do painel', unit: '%', digits: 0, limit: 'humidityLimit', scale: 100 },
];
const solarInverterMetrics = [
  { key: 'temp', label: 'Temperatura do inversor', unit: '°C', digits: 0, limit: 'tempLimit' },
  { key: 'usage', label: 'Eficiência de conversão', unit: '%', digits: 0, scale: 100 },
  { key: 'fuel', label: 'Fator de potência', unit: '%', digits: 0, limit: 'fuelMin', invert: true, scale: 100 },
];
const hydroTurbineMetrics = [
  { key: 'temp', label: 'Temperatura do mancal', unit: '°C', digits: 0, limit: 'tempLimit' },
  { key: 'vib', label: 'Vibração', unit: 'mm/s', digits: 2, limit: 'vibLimit' },
  { key: 'usage', label: 'Potência gerada', unit: '%', digits: 0, scale: 100 },
];
const hydroGateMetrics = [
  { key: 'temp', label: 'Temperatura do motor', unit: '°C', digits: 0, limit: 'tempLimit' },
  { key: 'usage', label: 'Abertura da comporta', unit: '%', digits: 0, scale: 100 },
  { key: 'fuel', label: 'Nível do reservatório', unit: '%', digits: 0, limit: 'fuelMin', invert: true, scale: 100 },
];
const evChargerMetrics = [
  { key: 'temp', label: 'Temperatura do conector', unit: '°C', digits: 0, limit: 'tempLimit' },
  { key: 'activity', label: 'Corrente de carga', unit: '%', digits: 0, limit: 'activityLimit', scale: 100 },
  { key: 'outside', label: 'Fila de veículos', unit: 'veíc.', digits: 0, limit: 'outsideLimit', scale: 8 },
];

const solarArraySchema = {
  mode: MODE_FIELD,
  speed: { label: 'Potência alvo', unit: '%', min: 0, max: 130, step: 5 },
  targetTemp: { label: 'Temperatura alvo do painel', unit: '°C', min: 20, max: 70, step: 1 },
  tempLimit: { label: 'Limite de alarme · temperatura', unit: '°C', min: 45, max: 85, step: 1 },
  humidityLimit: { label: 'Limite de sujidade do painel', unit: '%', min: 10, max: 60, step: 1 },
};
const solarInverterSchema = {
  mode: MODE_FIELD,
  speed: { label: 'Carga alvo do inversor', unit: '%', min: 0, max: 130, step: 5 },
  targetTemp: { label: 'Temperatura alvo', unit: '°C', min: 25, max: 55, step: 1 },
  tempLimit: { label: 'Limite de alarme · temperatura', unit: '°C', min: 45, max: 75, step: 1 },
  fuelMin: { label: 'Fator de potência mínimo', unit: '%', min: 80, max: 98, step: 1 },
};
const hydroTurbineSchema = {
  mode: MODE_FIELD,
  speed: { label: 'Potência alvo (abertura do distribuidor)', unit: '%', min: 0, max: 130, step: 5 },
  targetTemp: { label: 'Temperatura alvo do mancal', unit: '°C', min: 35, max: 70, step: 1 },
  tempLimit: { label: 'Limite de alarme · temperatura', unit: '°C', min: 55, max: 90, step: 1 },
  vibLimit: { label: 'Limite de alarme · vibração', unit: 'mm/s', min: 0.3, max: 3, step: 0.1 },
};
const hydroGateSchema = {
  mode: MODE_FIELD,
  speed: { label: 'Abertura alvo da comporta', unit: '%', min: 0, max: 100, step: 5 },
  targetTemp: { label: 'Temperatura alvo do motor', unit: '°C', min: 25, max: 60, step: 1 },
  tempLimit: { label: 'Limite de alarme · temperatura', unit: '°C', min: 45, max: 80, step: 1 },
  fuelMin: { label: 'Nível mínimo do reservatório', unit: '%', min: 20, max: 60, step: 1 },
};
const evChargerSchema = {
  mode: MODE_FIELD,
  speed: { label: 'Potência de carga alvo', unit: '%', min: 0, max: 130, step: 5 },
  targetTemp: { label: 'Temperatura alvo do conector', unit: '°C', min: 25, max: 55, step: 1 },
  tempLimit: { label: 'Limite de alarme · temperatura', unit: '°C', min: 45, max: 75, step: 1 },
  activityLimit: { label: 'Limite de corrente de carga', unit: '%', min: 70, max: 100, step: 1 },
  outsideLimit: { label: 'Fila máxima de veículos', unit: 'veíc.', min: 0, max: 10, step: 1 },
};

const SCHEMA = {
  'solar-array': solarArraySchema,
  'solar-inverter': solarInverterSchema,
  'hydro-turbine': hydroTurbineSchema,
  'hydro-gate': hydroGateSchema,
  'ev-charger-car': evChargerSchema,
  'ev-charger-truck': evChargerSchema,
  house: {
    mode: MODE_FIELD,
    speed: { label: 'Demanda residencial', unit: '%', min: 0, max: 130, step: 5 },
    supplyMin: { label: 'Atendimento mínimo', unit: '%', min: 0, max: 100, step: 1 },
  },
  'electric-car': {
    mode: MODE_FIELD,
    speed: { label: 'Velocidade alvo', unit: '%', min: 0, max: 130, step: 5 },
    batteryMin: { label: 'Alerta de bateria', unit: '%', min: 5, max: 30, step: 1 },
  },
  'power-circuit': {
    mode: MODE_FIELD,
    speed: { label: 'Capacidade disponível', unit: '%', min: 0, max: 100, step: 5 },
    loadLimit: { label: 'Limite de carregamento', unit: '%', min: 20, max: 100, step: 1 },
  },
};
SCHEMA['electric-truck'] = SCHEMA['electric-car'];

export function energyParamSchema(type) {
  return SCHEMA[type] || solarArraySchema;
}

export const COMMANDS = {
  solar: [
    { id: 'EMERGENCY_STOP', label: '🛑 Desligamento de emergência', confirm: true },
    { id: 'PAUSE', label: '⏸️ Pausar geração' },
    { id: 'RESUME', label: '▶️ Retomar geração' },
    { id: 'SPEED_UP', label: '⚡ Aumentar limite de potência' },
    { id: 'SLOW_DOWN', label: '🔅 Reduzir limite de potência (curtailment)' },
    { id: 'CALIBRATE', label: '🔧 Calibrar / limpar string' },
    { id: 'CYCLE_START', label: '🔄 Reiniciar ciclo MPPT' },
  ],
  hydro: [
    { id: 'EMERGENCY_STOP', label: '🛑 Parada de emergência da turbina', confirm: true },
    { id: 'PAUSE', label: '⏸️ Pausar geração' },
    { id: 'RESUME', label: '▶️ Retomar geração' },
    { id: 'SPEED_UP', label: '⚡ Abrir mais o distribuidor' },
    { id: 'SLOW_DOWN', label: '🐢 Fechar o distribuidor' },
    { id: 'CALIBRATE', label: '🔧 Calibrar instrumentação' },
    { id: 'CYCLE_START', label: '🔄 Reiniciar ciclo de partida' },
  ],
  charging: [
    { id: 'EMERGENCY_STOP', label: '🛑 Bloquear conector (emergência)', confirm: true },
    { id: 'PAUSE', label: '⏸️ Suspender carregamento' },
    { id: 'RESUME', label: '▶️ Retomar carregamento' },
    { id: 'SPEED_UP', label: '⚡ Aumentar potência de carga' },
    { id: 'SLOW_DOWN', label: '🐢 Reduzir potência de carga' },
    { id: 'CALIBRATE', label: '🔧 Calibrar medidor' },
    { id: 'CYCLE_START', label: '🔄 Iniciar nova sessão' },
  ],
};

function asset(row) {
  const [id, name, type, family, pos, temp, extra = {}] = row;
  const defaults = { mode: 'auto', speed: 100, targetTemp: temp, ...(extra.params || {}) };
  const params = { ...defaults, ...(extra.override || {}) };
  const m = {
    id, name, type, family, pos, moving: false,
    typeLabel: ENERGY_TYPE_LABEL[type],
    metrics: extra.metrics,
    base: {
      temp, vib: extra.vib ?? 0.2, usage: extra.usage ?? 60, targetTemp: temp,
      humidity: extra.humidity, fuel: extra.fuel, activity: extra.activity,
    },
    params, defaults, commLost: false,
    temp: extra.temp ?? temp,
    vib: extra.vib ?? 0.2,
    usage: extra.usage ?? 60,
    fuel: extra.fuel,
    humidity: extra.humidity,
    activity: extra.activity,
    outside: extra.outside,
    headcount: extra.headcount,
    status: 'online',
    reasons: [],
    lastSeen: Date.now(),
  };
  m.isRunning = runningState(m);
  return m;
}

// Zoneamento da cena: fazenda solar a oeste, casa de força/comporta ao norte,
// praça de recarga a leste — usado por usecases/energy/scene.js.
const RAW = [
  ['SOL-ARR-001', 'Array Solar 1', 'solar-array', 'solar', [-13, 0, -6], 42, { usage: 78, humidity: 18, params: { tempLimit: 65, humidityLimit: 35 }, metrics: solarArrayMetrics }],
  ['SOL-ARR-002', 'Array Solar 2', 'solar-array', 'solar', [-9, 0, -6], 45, { usage: 81, humidity: 22, params: { tempLimit: 65, humidityLimit: 35 }, metrics: solarArrayMetrics }],
  ['SOL-ARR-003', 'Array Solar 3', 'solar-array', 'solar', [-5, 0, -6], 58, { usage: 74, humidity: 38, params: { tempLimit: 65, humidityLimit: 35 }, metrics: solarArrayMetrics }],
  ['SOL-INV-001', 'Inversor Central 1', 'solar-inverter', 'solar', [-13, 0, -2], 41, { usage: 96, fuel: 94, params: { tempLimit: 60, fuelMin: 90 }, metrics: solarInverterMetrics }],
  ['SOL-INV-002', 'Inversor Central 2', 'solar-inverter', 'solar', [-5, 0, -2], 52, { usage: 89, fuel: 86, params: { tempLimit: 60, fuelMin: 90 }, metrics: solarInverterMetrics }],
  ['HID-TUR-001', 'Turbina 1', 'hydro-turbine', 'hydro', [0, 0, -9], 48, { vib: 0.9, usage: 88, params: { tempLimit: 75, vibLimit: 1.2 }, metrics: hydroTurbineMetrics }],
  ['HID-TUR-002', 'Turbina 2', 'hydro-turbine', 'hydro', [3, 0, -9], 51, { vib: 1.6, usage: 91, params: { tempLimit: 75, vibLimit: 1.2 }, metrics: hydroTurbineMetrics }],
  ['HID-TUR-003', 'Turbina 3', 'hydro-turbine', 'hydro', [6, 0, -9], 28, { vib: 0, usage: 0, temp: 28, params: { tempLimit: 75, vibLimit: 1.2 }, override: { mode: 'off', speed: 0 }, metrics: hydroTurbineMetrics }],
  ['HID-COM-001', 'Comporta do Vertedouro', 'hydro-gate', 'hydro', [9, 0, -9], 36, { usage: 55, fuel: 52, params: { tempLimit: 60, fuelMin: 35 }, metrics: hydroGateMetrics }],
  ['EVC-CAR-001', 'Posto Carros 1', 'ev-charger-car', 'charging', [9, 0, 2], 32, { usage: 62, activity: 55, outside: 1, headcount: 6, params: { tempLimit: 55, activityLimit: 90, outsideLimit: 4 }, metrics: evChargerMetrics }],
  ['EVC-CAR-002', 'Posto Carros 2', 'ev-charger-car', 'charging', [12, 0, 2], 34, { usage: 70, activity: 61, outside: 2, headcount: 6, params: { tempLimit: 55, activityLimit: 90, outsideLimit: 4 }, metrics: evChargerMetrics }],
  ['EVC-CAR-003', 'Posto Carros 3', 'ev-charger-car', 'charging', [15, 0, 2], 26, { usage: 0, activity: 0, outside: 5, headcount: 6, temp: 26, params: { tempLimit: 55, activityLimit: 90, outsideLimit: 4 }, override: { mode: 'off', speed: 0 }, metrics: evChargerMetrics }],
  ['EVC-TRK-001', 'Posto Caminhões 1', 'ev-charger-truck', 'charging', [10, 0, 6], 37, { usage: 85, activity: 92, outside: 2, headcount: 4, params: { tempLimit: 60, activityLimit: 88, outsideLimit: 3 }, metrics: evChargerMetrics }],
  ['EVC-TRK-002', 'Posto Caminhões 2', 'ev-charger-truck', 'charging', [14, 0, 6], 39, { usage: 77, activity: 70, outside: 1, headcount: 4, params: { tempLimit: 60, activityLimit: 88, outsideLimit: 3 }, metrics: evChargerMetrics }],
];

export function createEnergyAssets() {
  const assets = RAW.map(asset);
  for (let n = 4; n <= 10; n++) {
    assets.push(asset([`SOL-ARR-${String(n).padStart(3, '0')}`, `Painel Solar ${n}`,
      'solar-array', 'solar', SOLAR_POSITIONS[n - 1], 42,
      { usage: 78, humidity: 12, params: { tempLimit: 65, humidityLimit: 35 }, metrics: solarArrayMetrics }]));
  }
  for (const m of assets) {
    if (m.type === 'solar-array') {
      const n = Number(m.id.slice(-3)) - 1;
      m.pos = SOLAR_POSITIONS[n];
      m.name = `Painel Solar ${n + 1}`;
      m.ratedKw = 0.55;
      m.metrics = [solarArrayMetrics[0], { key: 'powerKw', label: 'Geração solar', unit: 'kW', digits: 2, scale: 0.55 }, solarArrayMetrics[2]];
    } else if (m.type === 'solar-inverter') {
      m.pos = [m.id.endsWith('001') ? -29 : -16, 0, -1.5];
      m.ratedKw = 3;
    } else if (m.type === 'hydro-turbine') {
      m.pos = TURBINE_POSITIONS[Number(m.id.slice(-3)) - 1];
      m.ratedKw = 45;
      m.metrics = [hydroTurbineMetrics[1],
        { key: 'flowM3s', label: 'Vazão na turbina', unit: 'm³/s', digits: 2, scale: 1.5 },
        { key: 'powerKw', label: 'Geração hídrica', unit: 'kW', digits: 1, scale: 45 }];
    } else if (m.type === 'hydro-gate') {
      m.pos = [17, 0, -23];
      m.metrics = [hydroGateMetrics[1],
        { key: 'levelM', label: 'Nível do reservatório', unit: 'm', digits: 2, scale: 4 },
        { key: 'spillM3s', label: 'Vazão do vertedouro', unit: 'm³/s', digits: 2, scale: 0.5 }];
    } else {
      const n = m.type === 'ev-charger-car' ? Number(m.id.slice(-3)) - 1 : Number(m.id.slice(-3)) + 2;
      m.pos = CHARGER_POSITIONS[n];
      m.ratedKw = m.type === 'ev-charger-car' ? 7.4 : 30;
    }
    m.energyKwh = 0;
  }
  HOUSE_POSITIONS.forEach((pos, n) => {
    const m = asset([`CAS-${String(n + 1).padStart(3, '0')}`, `Casa ${n + 1}`, 'house', 'residential', pos, 25,
      { params: { supplyMin: 95 }, metrics: [
        { key: 'servedKw', label: 'Consumo atendido', unit: 'kW', digits: 2, scale: 4 },
        { key: 'supplyPct', label: 'Atendimento', unit: '%', digits: 0, scale: 100, limit: 'supplyMin', invert: true },
        { key: 'energyKwh', label: 'Energia consumida', unit: 'kWh', digits: 3, scale: 10 },
      ] }]);
    m.ratedKw = 1.6 + (n % 4) * 0.55;
    m.energyKwh = 0;
    assets.push(m);
  });
  VEHICLE_IDS.forEach((id, n) => {
    const truck = n >= 4;
    const pose = routePose(CITY_ROUTE, INITIAL_DISTANCES[n]);
    const m = asset([id, `${truck ? 'Caminhão' : 'Carro'} ${truck ? n - 3 : n + 1}`,
      truck ? 'electric-truck' : 'electric-car', 'mobility', [pose.x, 0, pose.z], 30,
      { params: { batteryMin: 15 }, metrics: [
        { key: 'batteryPct', label: 'Bateria', unit: '%', digits: 1, scale: 100, limit: 'batteryMin', invert: true },
        { key: 'speedKmh', label: 'Velocidade', unit: 'km/h', digits: 1, scale: 30 },
        { key: 'chargeKw', label: 'Potência de recarga', unit: 'kW', digits: 1, scale: truck ? 30 : 7.4 },
      ] }]);
    Object.assign(m, { moving: true, batteryPct: n === 1 || n === 4 ? 19 : 48 + n * 5,
      batteryKwh: truck ? 90 : 28, routeDistance: INITIAL_DISTANCES[n],
      positionX: pose.x, positionZ: pose.z, heading: pose.heading, vehicleState: 'driving',
      chargerId: '', chargeKw: 0, speedKmh: 0 });
    assets.push(m);
  });
  for (const c of CIRCUITS) {
    const m = asset([c.id, c.name, 'power-circuit', 'grid', c.pos, 25,
      { params: { loadLimit: 90 }, metrics: [
        { key: 'powerKw', label: 'Potência transportada', unit: 'kW', digits: 1, scale: c.capacityKw },
        { key: 'loadPct', label: 'Carregamento', unit: '%', digits: 0, scale: 100, limit: 'loadLimit' },
        { key: 'voltageV', label: 'Tensão', unit: 'V', digits: 0, scale: 400 },
      ] }]);
    m.ratedKw = c.capacityKw;
    assets.push(m);
  }
  for (const m of assets) m.speedMax = SCHEMA[m.type].speed.max;
  return assets;
}

const switchingCommands = [
  { id: 'PAUSE', label: '⏸️ Suspender atendimento' },
  { id: 'RESUME', label: '▶️ Restabelecer atendimento' },
  { id: 'EMERGENCY_STOP', label: '🛑 Isolar alimentação', confirm: true },
];
COMMANDS.residential = switchingCommands;
COMMANDS.grid = switchingCommands;
COMMANDS.mobility = [
  { id: 'PAUSE', label: '⏸️ Parar veículo' },
  { id: 'RESUME', label: '▶️ Retomar percurso' },
  { id: 'EMERGENCY_STOP', label: '🛑 Imobilizar veículo', confirm: true },
  { id: 'SPEED_UP', label: '⬆️ Aumentar velocidade alvo' },
  { id: 'SLOW_DOWN', label: '⬇️ Reduzir velocidade alvo' },
];

export const energyKb = {
  house: {
    how: 'Casa com medidor inteligente: mostra potência atendida, percentual de atendimento e energia acumulada. Solar e hidrelétrica alimentam a mesma rede; déficit reduz proporcionalmente o fornecimento residencial e a recarga. O medidor continua comunicando mesmo sem energia na carga.',
    causes: ['geração insuficiente', 'circuito urbano isolado', 'fornecimento suspenso pelo operador'],
    maint: ['verificar o circuito RED-CID-001', 'comparar demanda e geração disponíveis'],
  },
  'electric-car': {
    how: 'Carro elétrico monitorado: circula na cidade, procura recarga com bateria em 20% ou menos e sai do posto ao atingir 80%. O posto precisa estar disponível e alimentado. Bateria esgotada ou comando de parada impede movimento.',
    causes: ['bateria baixa', 'fila de recarga', 'circuito sem fornecimento'],
    maint: ['verificar bateria e posto reservado', 'acompanhar a potência de recarga efetivamente recebida'],
  },
  'electric-truck': {
    how: 'Caminhão elétrico da frota demonstrativa: segue as ruas, respeita distância dos outros veículos e reserva uma vaga de caminhões. Busca recarga em 20% de bateria e volta ao trajeto em 80%.',
    causes: ['bateria baixa', 'postos de caminhões ocupados', 'déficit de geração na rede'],
    maint: ['acompanhar a fila e a bateria', 'verificar potência efetiva do posto de caminhões'],
  },
  'power-circuit': {
    how: 'Circuito monitorado por um conjunto de postes e fios: solar e hidrelétrica convergem na distribuição urbana, que atende casas e carregadores. Isolar uma fonte remove somente essa geração; isolar a distribuição urbana corta o atendimento. Perdas ilustrativas de 2% são consideradas.',
    causes: ['circuito isolado', 'sobrecarga', 'geração menor que a demanda'],
    maint: ['comparar potência, tensão e carregamento', 'verificar estados das fontes e consumidores'],
  },
  'solar-array': {
    how: 'Array fotovoltaico: strings de painéis conectados em série/paralelo convertem irradiância solar em corrente contínua. A telemetria traz temperatura do painel, potência de saída e sujidade — a sujidade acumulada reduz a geração mesmo com sol forte.',
    causes: ['acúmulo de poeira ou fuligem sobre os módulos', 'sombreamento parcial por vegetação ou estrutura vizinha', 'conector solto elevando a temperatura local', 'degradação de células em um ponto do string'],
    maint: ['agendar limpeza dos módulos quando a sujidade se aproximar do limite', 'inspecionar conectores MC4 e caixas de junção', 'verificar sombreamento ao longo do dia', 'termografar o array periodicamente'],
  },
  'solar-inverter': {
    how: 'Inversor solar: converte a corrente contínua dos arrays em corrente alternada sincronizada com a rede, seguindo o ponto de máxima potência (MPPT). Temperatura, eficiência de conversão e fator de potência indicam a saúde do equipamento.',
    causes: ['ventilação do gabinete obstruída elevando a temperatura', 'fator de potência baixo por desequilíbrio de carga na rede', 'firmware desatualizado afetando o MPPT', 'umidade no gabinete por vedação comprometida'],
    maint: ['limpar filtros de ventilação do gabinete', 'verificar aterramento e proteções CA/CC', 'atualizar firmware conforme boletim do fabricante', 'inspecionar vedação do invólucro'],
  },
  'hydro-turbine': {
    how: 'Turbina hidrelétrica: a água represada aciona as pás da turbina, que gira o gerador acoplado. A abertura do distribuidor controla a vazão e, portanto, a potência gerada; mancais monitoram temperatura e vibração.',
    causes: ['desgaste ou desalinhamento dos mancais (vibração)', 'cavitação nas pás por operação fora da faixa recomendada', 'resfriamento do gerador insuficiente', 'detritos parcialmente obstruindo a grade de entrada'],
    maint: ['monitorar tendência de vibração dos mancais', 'inspecionar grade de entrada e limpar detritos', 'verificar sistema de resfriamento do gerador', 'realizar parada programada para inspeção das pás'],
  },
  'hydro-gate': {
    how: 'Comporta do vertedouro: regula o nível do reservatório e o alívio de vazão excedente. A abertura é controlada por motor elétrico; o nível do reservatório é o principal indicador operacional.',
    causes: ['nível do reservatório caindo por vazão de geração acima do afluxo', 'motor da comporta sobreaquecendo em acionamentos frequentes', 'sensor de nível descalibrado', 'detritos emperrando o mecanismo de abertura'],
    maint: ['acompanhar a curva de afluxo x nível do reservatório', 'lubrificar e inspecionar o mecanismo de acionamento', 'calibrar o sensor de nível', 'remover detritos da grade do vertedouro'],
  },
  'ev-charger-car': {
    how: 'Posto de recarga para carros: entrega potência CC/CA ao veículo conectado, monitorando corrente de carga, temperatura do conector e a fila de veículos aguardando a vaga.',
    causes: ['corrente de carga sustentada no limite do conector', 'conector com contato degradado elevando a temperatura', 'fila longa por sessões de carga mais demoradas que o previsto', 'medidor de energia descalibrado'],
    maint: ['inspecionar e limpar contatos do conector', 'verificar ventilação do posto', 'calibrar o medidor de energia', 'revisar política de tempo máximo de sessão em horário de pico'],
  },
  'ev-charger-truck': {
    how: 'Posto de recarga para caminhões: opera em potências mais altas que os postos de carros, com os mesmos indicadores de corrente, temperatura do conector e fila — dimensionado para veículos pesados.',
    causes: ['potência sustentada próxima do limite térmico do conector', 'cabo de alta potência com desgaste pelo manuseio', 'fila por concentração de chegadas em janelas de frota', 'ventilação do posto insuficiente para a potência entregue'],
    maint: ['inspecionar cabo e conector de alta potência', 'verificar ventilação/arrefecimento ativo do posto', 'calibrar o medidor de energia', 'coordenar com a frota horários de chegada para reduzir fila'],
  },
};
