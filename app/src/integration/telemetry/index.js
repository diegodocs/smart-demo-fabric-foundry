// Fábrica da fonte de telemetria: 'mock' (padrão) ou 'fabric'.
import { createMockSource } from './mock.js';
import { createFabricSource } from './fabric.js';

export function readTelemetryMode(scenario, configuredMode) {
  try {
    const saved = localStorage.getItem(`iot-telemetry-${scenario}`);
    return saved === 'mock' || saved === 'fabric' ? saved : configuredMode;
  } catch (error) {
    console.warn('[telemetry] Não foi possível ler a fonte salva; usando a configuração.', error);
    return configuredMode;
  }
}

export function saveTelemetryMode(scenario, mode) {
  if (mode !== 'mock' && mode !== 'fabric') throw new Error('Fonte de telemetria inválida.');
  try {
    localStorage.setItem(`iot-telemetry-${scenario}`, mode);
  } catch (error) {
    console.warn('[telemetry] Não foi possível salvar a fonte escolhida.', error);
  }
}

export function createTelemetrySource(mode, machines, scenario, createSimulation) {
  if (mode === 'fabric') return createFabricSource({ apiBase: import.meta.env.VITE_API_BASE || '', scenario });
  return createMockSource(machines, { createSimulation });
}
