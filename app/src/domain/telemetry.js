export const EXTRA_NUMBERS = [
  'fuel', 'humidity', 'nh3', 'activity', 'outside', 'speedKmh', 'headcount',
  'powerKw', 'demandKw', 'servedKw', 'unservedKw', 'energyKwh', 'voltageV',
  'loadPct', 'batteryPct', 'flowM3s', 'levelM', 'spillM3s', 'supplyPct',
  'irradiance', 'routeDistance', 'positionX', 'positionZ', 'heading', 'chargeKw',
  'throughputTph', 'inventoryT', 'payloadT', 'extractedT', 'tailingsT', 'deliveredT',
  'inventoryUnits', 'receivedUnits', 'deliveredUnits', 'quarantinedUnits', 'processedBatches',
];
export const EXTRA_STRINGS = ['vehicleState', 'chargerId', 'batchId', 'batchStatus'];
export const VEHICLE_STATE_LABELS = {
  driving: 'Circulando', seeking: 'Buscando recarga', approaching: 'Indo ao posto',
  charging: 'Recarregando', leaving: 'Saindo do posto', stopped: 'Parado',
  loading: 'Carregando', hauling: 'Transportando minério', delivering: 'Em entrega',
  unloading: 'Descarregando', returning: 'Retornando',
};
const STATES = new Set(Object.keys(VEHICLE_STATE_LABELS));

export function extraTelemetry(reading) {
  const result = {};
  for (const key of EXTRA_NUMBERS) {
    if (Number.isFinite(reading[key])) result[key] = reading[key];
  }
  if (STATES.has(reading.vehicleState)) result.vehicleState = reading.vehicleState;
  if (typeof reading.chargerId === 'string') result.chargerId = reading.chargerId;
  for (const key of ['batchId', 'batchStatus']) {
    if (typeof reading[key] === 'string') result[key] = reading[key];
  }
  return result;
}

export function measuredTelemetry(reading) {
  const result = extraTelemetry(reading);
  for (const key of ['temp', 'vib', 'usage', 'speed']) {
    if (Number.isFinite(reading[key])) result[key] = reading[key];
  }
  if (typeof reading.isRunning === 'boolean') result.isRunning = reading.isRunning;
  return result;
}
