// Catálogos compartilhados pelo proxy Fabric e pelo simulador de dispositivos.
import { createMachines } from '../app/src/usecases/factory/catalog.js';
import { createFarmAssets, farmParamSchema, COMMANDS as FARM_COMMANDS } from '../app/src/usecases/farm/catalog.js';
import { createEnergyAssets, energyParamSchema, COMMANDS } from '../app/src/usecases/energy/catalog.js';
import { createEnergySimulation } from '../app/src/usecases/energy/simulation.js';
import { createMiningAssets, miningParamSchema, MINING_COMMANDS } from '../app/src/usecases/mining/catalog.js';
import { createMiningSimulation } from '../app/src/usecases/mining/simulation.js';
import { createPharmaAssets, pharmaParamSchema, PHARMA_COMMANDS } from '../app/src/usecases/pharma/catalog.js';
import { createPharmaSimulation } from '../app/src/usecases/pharma/simulation.js';

export const DEVICE_CATALOGS = {
  pharma: {
    id: 'pharma', label: 'Smart Pharma', createAssets: createPharmaAssets,
    createSimulation: createPharmaSimulation, paramSchema: pharmaParamSchema,
    commandsFor: () => PHARMA_COMMANDS,
  },
  factory: { id: 'factory', label: 'Smart Factory', createAssets: createMachines },
  farm: {
    id: 'farm', label: 'Smart Farm', createAssets: createFarmAssets,
    paramSchema: farmParamSchema, commandsFor: (d) => FARM_COMMANDS[d.family],
  },
  energy: {
    id: 'energy', label: 'Smart Energy — Estação de Energia', createAssets: createEnergyAssets,
    createSimulation: createEnergySimulation, paramSchema: energyParamSchema,
    commandsFor: (d) => COMMANDS[d.family],
  },
  mining: {
    id: 'mining', label: 'Smart Mining', createAssets: createMiningAssets,
    createSimulation: createMiningSimulation, paramSchema: miningParamSchema,
    commandsFor: () => MINING_COMMANDS,
  },
};

export const DEFAULT_SCENARIO = 'factory';

export function resolveScenario(id) {
  if (id === undefined) return DEFAULT_SCENARIO;
  if (typeof id === 'string' && Object.hasOwn(DEVICE_CATALOGS, id)) return id;
  throw Object.assign(new Error('Cenário inválido.'), { status: 400 });
}
