import { MODE_FIELD } from '../../domain/paramSchema.js';
import { PHARMA_LAYOUT, PHARMA_TRUCK_DISTANCE_PER_CYCLE } from './layout.js';

export const PHARMA_STAGES = [
  { code: 'REC', name: 'Recebimento de matéria-prima', type: 'pharma-receiving', pos: PHARMA_LAYOUT.factory.REC, cycle: 6 },
  { code: 'PRD', name: 'Formulação e produção', type: 'pharma-production', pos: PHARMA_LAYOUT.factory.PRD, cycle: 10 },
  { code: 'QUA', name: 'Controle de qualidade', type: 'pharma-quality', pos: PHARMA_LAYOUT.factory.QUA, cycle: 8 },
  { code: 'EMB', name: 'Embalagem e serialização', type: 'pharma-packaging', pos: PHARMA_LAYOUT.factory.EMB, cycle: 6 },
  { code: 'ARM', name: 'Armazém refrigerado', type: 'pharma-storage', pos: PHARMA_LAYOUT.factory.ARM, cycle: 6, cold: true },
  { code: 'TRK', name: 'Caminhão refrigerado 1', type: 'pharma-truck', pos: PHARMA_LAYOUT.truckStarts[0], cycle: 12, cold: true },
  { code: 'DIS', name: 'Centro de distribuição 1', type: 'pharma-distribution', pos: PHARMA_LAYOUT.centers[0], cycle: 6, cold: true },
  { code: 'FAR', name: 'Farmácia 1', type: 'pharma-pharmacy', pos: PHARMA_LAYOUT.pharmacies[0], cycle: 5, cold: true },
];

export const pharmaId = (code, number = 1) => `PHA-${code}-${String(number).padStart(3, '0')}`;
export const PHARMA_ASSET_DEFINITIONS = [
  ...PHARMA_STAGES,
  ...PHARMA_LAYOUT.truckStarts.slice(1).map((pos, index) => ({
    code: 'TRK', number: index + 2, name: `Caminhão refrigerado ${index + 2}`,
    type: 'pharma-truck', pos, cycle: 12, cold: true,
  })),
  ...PHARMA_LAYOUT.pharmacies.slice(1).map((pos, index) => ({
    code: 'FAR', number: index + 2, name: `Farmácia ${index + 2}`,
    type: 'pharma-pharmacy', pos, cycle: 5, cold: true,
  })),
];

export function pharmaParamSchema(type) {
  const cold = PHARMA_STAGES.find((stage) => stage.type === type)?.cold;
  return {
    mode: MODE_FIELD,
    speed: { label: 'Ritmo simulado', unit: '%', min: 0, max: 130, step: 5 },
    targetTemp: { label: 'Temperatura alvo', unit: '°C', min: cold ? 2 : 15, max: cold ? 8 : 35, step: 0.5 },
    ...(cold ? { tempMin: { label: 'Temperatura mínima', unit: '°C', min: 2, max: 4, step: 0.5 } } : {}),
    tempLimit: { label: 'Temperatura máxima', unit: '°C', min: cold ? 6 : 25, max: cold ? 8 : 45, step: 0.5 },
    vibLimit: { label: 'Limite de vibração', unit: 'mm/s', min: 0.5, max: 3, step: 0.1 },
    cycleTime: { label: 'Tempo por lote', unit: 's', min: 2, max: 60, step: 1 },
  };
}

export const PHARMA_COMMANDS = [
  { id: 'EMERGENCY_STOP', label: 'Parada de emergência (simulada)', confirm: true },
  { id: 'PAUSE', label: 'Pausar etapa' },
  { id: 'RESUME', label: 'Retomar etapa' },
  { id: 'SPEED_UP', label: 'Aumentar ritmo' },
  { id: 'SLOW_DOWN', label: 'Reduzir ritmo' },
  { id: 'CALIBRATE', label: 'Calibrar sensor simulado' },
  { id: 'CYCLE_START', label: 'Iniciar etapa' },
];

export function createPharmaAssets() {
  return PHARMA_ASSET_DEFINITIONS.map((stage) => {
    const moving = stage.code === 'TRK' && (stage.number ?? 1) <= 2;
    const defaults = {
      mode: 'auto', speed: 100, targetTemp: stage.cold ? 5 : 22,
      tempLimit: stage.cold ? 8 : 35, vibLimit: 1.5, cycleTime: stage.cycle,
      ...(stage.cold ? { tempMin: 2 } : {}),
    };
    return {
      id: pharmaId(stage.code, stage.number), name: stage.name, type: stage.type, typeLabel: stage.name,
      family: 'pharma', location: stage.name, pos: [...stage.pos],
      cold: !!stage.cold, capacityUnits: stage.code === 'TRK' ? 100 : 300,
      inventoryUnits: 0, receivedUnits: 0, deliveredUnits: 0, quarantinedUnits: 0,
      processedBatches: 0, batchId: '', batchStatus: 'Aguardando lote',
      metrics: [
        { key: 'inventoryUnits', label: 'Unidades em processo', unit: 'un', scale: stage.code === 'TRK' ? 100 : 300 },
        { key: 'temp', label: 'Temperatura', unit: '°C', digits: 1, limit: 'tempLimit', minLimit: stage.cold ? 'tempMin' : undefined },
        { key: 'quarantinedUnits', label: 'Unidades bloqueadas', unit: 'un', scale: 500 },
      ],
      params: { ...defaults, ...(stage.code === 'TRK' && !moving ? { speed: 0 } : {}) }, defaults,
      base: { temp: defaults.targetTemp, vib: 0.2, usage: 50 },
      temp: defaults.targetTemp, vib: 0.2, usage: 0, speedMax: 130,
      isRunning: moving, commLost: false, status: 'online', reasons: [], lastSeen: Date.now(),
      ...(stage.code === 'TRK' ? {
        positionX: stage.pos[0], positionZ: stage.pos[2],
        heading: moving ? Math.PI : 0, vehicleState: moving ? 'returning' : 'stopped',
        speedKmh: moving ? PHARMA_TRUCK_DISTANCE_PER_CYCLE / defaults.cycleTime * 3.6 : 0,
      } : {}),
    };
  });
}

export const pharmaKb = Object.fromEntries(PHARMA_STAGES.map((stage) => [stage.type, {
  how: `${stage.name}: ativo da cadeia farmacêutica simulada. Cada lote possui 100 unidades equivalentes e mantém o identificador até a entrega. ${
    stage.code === 'QUA' ? 'Cada quinto lote é bloqueado por um resultado fictício de qualidade.' :
      stage.cold ? 'A faixa ilustrativa de conservação é de 2 a 8 °C; uma excursão bloqueia o lote definitivamente nesta execução.' :
        'O lote segue para a próxima etapa somente quando houver capacidade e disponibilidade.'
  } Não representa formulação, validação sanitária ou liberação real de medicamentos.`,
  causes: ['etapa pausada ou sem comunicação', 'estoque seguinte cheio', 'bloqueio demonstrativo de qualidade ou conservação'],
  maint: ['conferir o identificador do lote e os alertas simulados', 'consultar os procedimentos aprovados e a equipe de qualidade em uma operação real'],
}]));
