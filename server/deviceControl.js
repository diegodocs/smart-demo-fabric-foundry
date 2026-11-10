import { randomUUID } from 'node:crypto';
import { createMachines as createFactoryAssets } from '../app/src/usecases/factory/catalog.js';

export const COMMANDS = new Set(['EMERGENCY_STOP', 'PAUSE', 'RESUME', 'SPEED_UP', 'SLOW_DOWN', 'CALIBRATE', 'CYCLE_START']);

// createAssets é parametrizável por catálogo (fábrica por padrão) para que outros casos de uso
// (ex.: Smart Energy) possam ter seu próprio device control sem duplicar esta lógica.
export function createDeviceControl(createAssets = createFactoryAssets) {
  const session = randomUUID();
  const devices = Object.fromEntries(createAssets().map((d) => [d.id, {
    ...d, revision: 0, calibrations: 0,
  }]));

  return {
    devices,
    snapshot() {
      return { session, items: Object.values(devices).map((d) => ({
        machineId: d.id, params: { ...d.params }, revision: d.revision,
        calibrations: d.calibrations, commLost: d.commLost,
      })) };
    },
    setParams(id, params) {
      devices[id].params = { ...params };
      devices[id].revision++;
    },
    command(id, command) {
      const d = devices[id];
      switch (command) {
        case 'EMERGENCY_STOP': d.params.mode = 'off'; d.params.speed = 0; break;
        case 'PAUSE': d.params.mode = 'paused'; break;
        case 'RESUME':
        case 'CYCLE_START':
          d.params.mode = 'auto';
          if (!d.params.speed) d.params.speed = d.defaults.speed;
          d.commLost = false;
          break;
        case 'SPEED_UP': d.params.speed = Math.min(d.speedMax ?? 130, d.params.speed + 10); break;
        case 'SLOW_DOWN': d.params.speed = Math.max(0, d.params.speed - 10); break;
        case 'CALIBRATE':
          d.vib *= 0.75;
          if (Number.isFinite(d.outside)) d.outside = Math.max(0, d.outside - 1);
          d.calibrations++;
          break;
        default: throw new Error(`Comando desconhecido: ${command}`);
      }
      d.revision++;
    },
  };
}

export function applyControlSnapshot(devices, snapshot, applied) {
  if (!snapshot || typeof snapshot.session !== 'string' || !Array.isArray(snapshot.items)) {
    throw new Error('Resposta de controle invalida.');
  }
  for (const r of snapshot.items) {
    const d = devices.find((item) => item.id === r.machineId);
    if (!d) continue;
    const prev = applied.get(d.id);
    if (prev?.session === snapshot.session && prev.revision === r.revision) continue;
    const previousCalibrations = prev?.session === snapshot.session ? prev.calibrations : 0;
    d.params = { ...r.params };
    d.commLost = r.commLost;
    const calibrations = Math.max(0, r.calibrations - previousCalibrations);
    d.vib *= 0.75 ** calibrations;
    if (Number.isFinite(d.outside)) d.outside = Math.max(0, d.outside - calibrations);
    applied.set(d.id, { session: snapshot.session, revision: r.revision, calibrations: r.calibrations });
  }
}
