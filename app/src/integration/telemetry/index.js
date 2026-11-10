// Fábrica da fonte de telemetria: 'mock' (padrão) ou 'fabric'.
import { createMockSource } from './mock.js';
import { createFabricSource } from './fabric.js';

export function createTelemetrySource(mode, machines, scenario, createSimulation) {
  if (mode === 'fabric') return createFabricSource({ apiBase: import.meta.env.VITE_API_BASE || '', scenario });
  return createMockSource(machines, { createSimulation });
}
