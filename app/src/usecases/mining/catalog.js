import { MODE_FIELD } from '../../domain/paramSchema.js';
import { runningState } from '../../domain/simulation.js';
import { MINING_POSITIONS as POS, MINING_HAUL_ROUTES } from './layout.js';

const SCHEMA = {
  mode: MODE_FIELD,
  speed: { label: 'Ritmo operacional', unit: '%', min: 0, max: 130, step: 5 },
  targetTemp: { label: 'Temperatura alvo', unit: '°C', min: 20, max: 95, step: 1 },
  tempLimit: { label: 'Limite de temperatura', unit: '°C', min: 40, max: 120, step: 1 },
  vibLimit: { label: 'Limite de vibração', unit: 'mm/s', min: 0.3, max: 3, step: 0.1 },
};

export function miningParamSchema() {
  return SCHEMA;
}

const throughput = { key: 'throughputTph', label: 'Vazão', unit: 't/h', digits: 0, scale: 7200 };
const inventory = (label, scale) => ({ key: 'inventoryT', label, unit: 't', digits: 1, scale });
const temperature = { key: 'temp', label: 'Temperatura', unit: '°C', digits: 0, limit: 'tempLimit' };
const vibration = { key: 'vib', label: 'Vibração', unit: 'mm/s', digits: 1, limit: 'vibLimit' };
const payload = (scale) => ({ key: 'payloadT', label: 'Carga transportada', unit: 't', digits: 1, scale });
const vehicleSpeed = { key: 'speedKmh', label: 'Velocidade', unit: 'km/h', digits: 1, scale: 25 };

const DEFINITIONS = [
  {
    id: 'MIN-EXC-001', name: 'Escavadeira da cava', type: 'excavator', family: 'extraction',
    typeLabel: 'Escavadeira', pos: POS.excavator, location: 'Cava · frente de extração',
    metrics: [throughput, inventory('Minério na cava', 60), { key: 'extractedT', label: 'Extraído acumulado', unit: 't', digits: 1, scale: 200 }],
    inventoryT: 12, extractedT: 31, capacityT: 60, ratedTps: 1.2,
  },
  {
    id: 'MIN-HAU-001', name: 'Caminhão fora de estrada', type: 'haul-truck', family: 'transport',
    typeLabel: 'Caminhão de mina', pos: POS.haulStart, location: 'Circuito cava → britador',
    metrics: [payload(15), vehicleSpeed, temperature], payloadT: 0, capacityT: 15, moving: true,
    vehicleState: 'loading', positionX: POS.haulStart[0], positionZ: POS.haulStart[2], heading: 0, speedKmh: 0,
  },
  {
    id: 'MIN-BRI-001', name: 'Britador primário', type: 'crusher', family: 'processing',
    typeLabel: 'Britador primário', pos: POS.crusher, location: 'Pátio de britagem',
    metrics: [throughput, inventory('Minério aguardando britagem', 40), vibration],
    inventoryT: 6, capacityT: 40, ratedTps: 1.5, vib: 1.4, vibLimit: 1.2,
  },
  {
    id: 'MIN-CNV-001', name: 'Correia transportadora', type: 'mine-conveyor', family: 'processing',
    typeLabel: 'Correia de minério', pos: POS.conveyor, location: 'Britagem → beneficiamento',
    metrics: [throughput, inventory('Minério na correia', 8), temperature],
    inventoryT: 3, capacityT: 8, ratedTps: 1.5,
  },
  {
    id: 'MIN-PRC-001', name: 'Usina de beneficiamento', type: 'ore-processor', family: 'processing',
    typeLabel: 'Usina de beneficiamento', pos: POS.processor, location: 'Usina · alimentação',
    metrics: [throughput, inventory('Minério em alimentação', 30), { key: 'tailingsT', label: 'Rejeitos acumulados', unit: 't', digits: 1, scale: 50 }],
    inventoryT: 2, tailingsT: 0, capacityT: 30, ratedTps: 1.2,
  },
  {
    id: 'MIN-SIL-001', name: 'Silo de produto', type: 'product-silo', family: 'storage',
    typeLabel: 'Silo de produto', pos: POS.silo, location: 'Pátio · armazenamento',
    metrics: [inventory('Produto armazenado', 50), { key: 'usage', label: 'Ocupação', unit: '%', digits: 0, scale: 100 },
      { ...throughput, label: 'Movimentação no silo' }],
    inventoryT: 8, capacityT: 50,
  },
  {
    id: 'MIN-TRK-001', name: 'Caminhão de entrega', type: 'delivery-truck', family: 'transport',
    typeLabel: 'Caminhão de entrega', pos: POS.deliveryStart, location: 'Circuito silos → centros de distribuição',
    metrics: [payload(10), vehicleSpeed, temperature], payloadT: 0, capacityT: 10, moving: true,
    vehicleState: 'loading', positionX: POS.deliveryStart[0], positionZ: POS.deliveryStart[2], heading: 0, speedKmh: 0,
  },
  {
    id: 'MIN-TER-001', name: 'Terminal de entrega', type: 'delivery-terminal', family: 'delivery',
    typeLabel: 'Terminal de entrega', pos: POS.terminal, location: 'Terminal · controle de expedição',
    metrics: [{ key: 'deliveredT', label: 'Produto entregue', unit: 't', digits: 1, scale: 200 }, throughput, temperature],
    deliveredT: 0,
  },
  ...[1, 2, 3].map((index) => ({
    id: `MIN-HAU-${String(index + 1).padStart(3, '0')}`, name: `Caminhão fora de estrada ${index + 1}`,
    type: 'haul-truck', family: 'transport', typeLabel: 'Caminhão de mina',
    pos: POS.haulStarts[index], location: `Circuito cava → britagem · faixa ${index + 1}`,
    metrics: [payload(15), vehicleSpeed, temperature], payloadT: 0, capacityT: 15, moving: true,
    vehicleState: 'loading', positionX: POS.haulStarts[index][0], positionZ: POS.haulStarts[index][2],
    heading: 0, speedKmh: 0,
  })),
  ...[1, 2].map((index) => ({
    id: `MIN-BRI-${String(index + 1).padStart(3, '0')}`, name: `Britador ${index + 1}`,
    type: 'crusher', family: 'processing', typeLabel: 'Britador',
    pos: POS.crushers[index], location: `Pátio de britagem · linha ${index + 1}`,
    metrics: [throughput, inventory('Minério aguardando britagem', 40), vibration],
    inventoryT: 0, capacityT: 40, ratedTps: 1.5,
    ...(index === 1 ? { vib: 1.9, baseVib: 0.45, vibLimit: 1.2, sensorBias: { vib: 1.6 } } : {}),
  })),
  ...[1, 2, 3, 4, 5].map((index) => ({
    id: `MIN-SIL-${String(index + 1).padStart(3, '0')}`, name: `Silo de produto ${index + 1}`,
    type: 'product-silo', family: 'storage', typeLabel: 'Silo de produto',
    pos: POS.silos[index], location: `Pátio de armazenamento · silo ${index + 1}`,
    metrics: [inventory('Produto armazenado', 50), temperature, { ...throughput, label: 'Movimentação no silo' }],
    inventoryT: 0, capacityT: 50,
    ...(index === 4 ? { temp: 78, tempLimit: 65, sensorBias: { temp: 40 } } : {}),
  })),
  ...POS.distribution.map((pos, index) => ({
    id: `MIN-DIS-${String(index + 1).padStart(3, '0')}`, name: `Centro de distribuição ${index + 1}`,
    type: 'distribution-center', family: 'distribution', typeLabel: 'Centro de distribuição',
    pos, location: `Expedição · centro de distribuição ${index + 1}`,
    metrics: [{ key: 'deliveredT', label: 'Produto recebido', unit: 't', digits: 1, scale: 200 }, throughput, temperature],
    deliveredT: 0,
    ...(index === 1 ? { temp: 78, tempLimit: 65, sensorBias: { temp: 40 } } : {}),
  })),
];

export function createMiningAssets() {
  return DEFINITIONS.map((definition) => {
    const defaults = {
      mode: 'auto', speed: 100, targetTemp: 60, tempLimit: definition.tempLimit ?? 90,
      vibLimit: definition.vibLimit ?? 1.5,
    };
    const vib = definition.vib ?? 0.45;
    const asset = {
      ...definition,
      ...(MINING_HAUL_ROUTES[definition.id] ? { crusherId: MINING_HAUL_ROUTES[definition.id].crusherId } : {}),
      pos: [...definition.pos],
      metrics: definition.metrics.map((metric) => ({ ...metric })),
      params: { ...defaults },
      defaults,
      base: { temp: 60, vib: definition.baseVib ?? vib, usage: 60, targetTemp: 60 },
      temp: definition.temp ?? 60, vib, usage: 0, throughputTph: 0,
      speedMax: SCHEMA.speed.max,
      commLost: false, status: 'online', reasons: [], lastSeen: Date.now(),
    };
    asset.isRunning = runningState(asset);
    return asset;
  });
}

export const MINING_COMMANDS = [
  { id: 'EMERGENCY_STOP', label: '🛑 Parada de emergência', confirm: true },
  { id: 'PAUSE', label: '⏸️ Pausar etapa' },
  { id: 'RESUME', label: '▶️ Retomar etapa' },
  { id: 'SPEED_UP', label: '⚡ Aumentar ritmo' },
  { id: 'SLOW_DOWN', label: '🐢 Reduzir ritmo' },
  { id: 'CALIBRATE', label: '🔧 Calibrar sensores' },
  { id: 'CYCLE_START', label: '🔄 Reiniciar ciclo' },
];

export const miningKb = {
  excavator: {
    how: 'A escavadeira alimenta o estoque da cava. Quatro caminhões de mina levam o minério até três britadores, em faixas independentes; a extração para quando o estoque disponível atinge a capacidade simulada.',
    causes: ['ritmo elevado', 'estoque da cava cheio', 'sensor de temperatura ou vibração em alerta'],
    maint: ['acompanhar a tendência dos sensores', 'programar inspeção do conjunto de escavação', 'verificar os registros da operação'],
  },
  'haul-truck': {
    how: 'Cada um dos quatro caminhões carrega minério na cava, segue pela sua faixa até o britador designado, descarrega e retorna. A carga e a posição são calculadas pelo simulador.',
    causes: ['equipamento pausado', 'estoque da cava insuficiente', 'britador indisponível'],
    maint: ['acompanhar carga e posição', 'programar inspeção de pneus e freios', 'verificar os registros do veículo'],
  },
  crusher: {
    how: 'O britador recebe o minério bruto do caminhão e o transfere à correia após a britagem. A vazão depende do estoque e da disponibilidade das duas etapas.',
    causes: ['vibração elevada', 'ausência de minério', 'correia indisponível ou cheia'],
    maint: ['acompanhar a tendência de vibração', 'programar inspeção mecânica', 'verificar os registros de britagem'],
  },
  'mine-conveyor': {
    how: 'A correia recebe o material britado e alimenta o estoque da usina de beneficiamento. Uma correia pausada interrompe essa transferência.',
    causes: ['correia pausada', 'alimentação insuficiente', 'estoque da usina cheio'],
    maint: ['acompanhar a vazão', 'programar inspeção da correia e dos roletes', 'verificar os registros de manutenção'],
  },
  'ore-processor': {
    how: 'A usina transforma o minério britado em produto e rejeitos. Nesta demonstração, 90% da massa vira produto e 10% é contabilizada como rejeito.',
    causes: ['alimentação insuficiente', 'silo indisponível ou cheio', 'parâmetros de operação fora da faixa'],
    maint: ['acompanhar alimentação e rejeitos', 'programar inspeção da usina', 'verificar os registros do processo'],
  },
  'product-silo': {
    how: 'Seis silos compartilham o produto beneficiado e abastecem o caminhão de entrega em rodízio. Silos pausados ou cheios deixam de receber material; os demais continuam disponíveis.',
    causes: ['estoque próximo da capacidade', 'caminhão de entrega indisponível', 'silo pausado'],
    maint: ['acompanhar o nível de estoque', 'programar inspeção dos sensores', 'verificar os registros de expedição'],
  },
  'delivery-truck': {
    how: 'O caminhão recebe produto de um dos seis silos, segue para um dos três centros de distribuição e retorna ao próximo silo. O rodízio evita instalações indisponíveis; a entrega é contabilizada na descarga autorizada pelo terminal.',
    causes: ['produto insuficiente', 'terminal indisponível', 'equipamento pausado'],
    maint: ['acompanhar carga e posição', 'programar inspeção do veículo', 'verificar os registros de entrega'],
  },
  'delivery-terminal': {
    how: 'O terminal autoriza as descargas e agrega o produto recebido pelos três centros de distribuição. Seu contador é o total dos centros, não um estoque adicional. Pausar o terminal mantém a carga no veículo até a retomada.',
    causes: ['terminal pausado', 'veículo ainda em trânsito', 'sensor de descarga indisponível'],
    maint: ['acompanhar a massa entregue', 'programar inspeção dos sensores', 'verificar os registros de recebimento'],
  },
  'distribution-center': {
    how: 'Cada um dos três centros recebe o produto do caminhão de entrega. O simulador alterna os destinos disponíveis; a entrega só é registrada durante a descarga e também compõe o total do terminal.',
    causes: ['centro pausado', 'veículo ainda em trânsito', 'sensor de temperatura em alerta'],
    maint: ['acompanhar a massa recebida', 'verificar os registros dos sensores', 'programar inspeção do centro'],
  },
};
