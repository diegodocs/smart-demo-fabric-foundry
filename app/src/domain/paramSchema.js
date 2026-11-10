// Vocabulário genérico de parâmetros operacionais, reaproveitado por todos os casos de uso
// (factory, farm, energy, mining). Cada caso de uso define seus próprios rótulos/faixas por tipo de
// ativo e usa buildParamSchema() para combinar uma base comum com overrides por tipo.

export const MODES = {
  auto: 'Automático',
  manual: 'Manual',
  paused: 'Pausado',
  off: 'Desligado',
};

export const PARAM_KEYS = ['mode', 'speed', 'targetTemp', 'tempLimit', 'vibLimit', 'cycleTime'];

export const MODE_FIELD = { label: 'Modo de operação', kind: 'select', options: MODES };

// Combina a base comum de um caso de uso com os overrides específicos do tipo de ativo.
export function buildParamSchema(common, overrides, type) {
  const o = overrides[type] || {};
  const out = {};
  for (const k of PARAM_KEYS) out[k] = { ...common[k], ...(o[k] || {}) };
  return out;
}
