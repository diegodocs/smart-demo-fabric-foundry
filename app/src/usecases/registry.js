// Registro de cenários disponíveis na SPA. Cada caso de uso contribui seu catálogo de ativos,
// perfil de interface/KPIs e função de inicialização da cena 3D (bootScene) — adicionar um novo
// caso de uso é registrar uma entrada aqui, sem tocar em main.js.
import { createMachines } from './factory/catalog.js';
import { factoryProfile } from './factory/profile.js';
import { initScene } from './factory/scene.js';
import { farmProfile } from './farm/profile.js';
import { initFarmScene } from './farm/scene.js';
import { energyProfile } from './energy/profile.js';
import { initEnergyScene } from './energy/scene.js';
import { miningProfile } from './mining/profile.js';
import { initMiningScene } from './mining/scene.js';
import { pharmaProfile } from './pharma/profile.js';
import { initPharmaScene } from './pharma/scene.js';

const KEY = 'iot-scenario';

const profiles = {
  factory: { ...factoryProfile, createAssets: createMachines, bootScene: initScene },
  farm: { ...farmProfile, bootScene: initFarmScene },
  energy: { ...energyProfile, bootScene: initEnergyScene },
  mining: { ...miningProfile, bootScene: initMiningScene },
  pharma: { ...pharmaProfile, bootScene: initPharmaScene },
};

const DEFAULT_SCENARIO = 'factory';
const isValidId = (id) => Object.hasOwn(profiles, id);

export function readScenarioId(configuredDefault = import.meta.env?.VITE_DEFAULT_SCENARIO) {
  const fallback = isValidId(configuredDefault) ? configuredDefault : DEFAULT_SCENARIO;
  if (configuredDefault && !isValidId(configuredDefault)) {
    console.warn(`[scenario] VITE_DEFAULT_SCENARIO inválido: ${configuredDefault}; usando factory sem uma seleção salva válida.`);
  }
  try {
    const id = localStorage.getItem(KEY);
    return isValidId(id) ? id : fallback;
  } catch (error) {
    console.warn('[scenario] Não foi possível ler o cenário salvo; usando o padrão configurado.', error);
    return fallback;
  }
}

export function saveScenarioId(id) {
  try { localStorage.setItem(KEY, isValidId(id) ? id : DEFAULT_SCENARIO); } catch { /* demonstração sem storage */ }
}

let activeId = DEFAULT_SCENARIO;

export function setActiveScenario(id) {
  activeId = isValidId(id) ? id : DEFAULT_SCENARIO;
  return profiles[activeId];
}

export function activeScenario() {
  return profiles[activeId] || profiles[DEFAULT_SCENARIO];
}

export function getScenario(id) {
  return profiles[id] || profiles[DEFAULT_SCENARIO];
}
