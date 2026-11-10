// Regras de status: derivam online / alerta / offline a partir da telemetria x setpoints.
// Os canais fuel/humidity/activity/outside são genéricos (reaproveitados por farm e energy com
// significados físicos diferentes); o texto do alerta usa o rótulo declarado no catálogo do
// ativo (metricsOf) em vez de um substantivo fixo, para não vazar vocabulário de um caso de uso
// específico para os demais.
import { metricsOf } from './metrics.js';

const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmt = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Rótulo/unidade de reserva, usados apenas se o ativo não declarar a métrica correspondente.
const FALLBACK = {
  fuel: { label: 'Combustível', unit: '%' },
  humidity: { label: 'Umidade', unit: '%' },
  activity: { label: 'Atividade', unit: '%' },
  outside: { label: 'Fora da cerca', unit: 'cab' },
};

function metricMeta(asset, key) {
  const metric = metricsOf(asset).find((x) => x.key === key);
  return { label: metric?.label || FALLBACK[key].label, unit: metric?.unit || FALLBACK[key].unit };
}

export function evaluate(m) {
  const reasons = [];
  if (m.commLost) {
    reasons.push({ level: 'offline', text: `Sem comunicação desde ${hhmm(m.lastSeen)} — verificar gateway/sensor.` });
    return { status: 'offline', reasons };
  }
  if (m.params.mode === 'off') {
    reasons.push({ level: 'offline', text: 'Desligada pelo operador (modo Desligado).' });
    return { status: 'offline', reasons };
  }
  const { tempLimit, vibLimit } = m.params;
  if (Number.isFinite(m.params.tempMin) && m.temp < m.params.tempMin) {
    reasons.push({ level: 'warn', text: `Temperatura baixa ${fmt(m.temp, 1)} °C — mínimo ${fmt(m.params.tempMin, 1)} °C.` });
  }
  if (Number.isFinite(m.quarantinedUnits) && m.quarantinedUnits > 0) {
    reasons.push({ level: 'warn', text: `${fmt(m.quarantinedUnits)} unidades bloqueadas na simulação; não disponíveis para entrega.` });
  }
  if (m.temp >= tempLimit) {
    const critical = m.temp >= tempLimit * 1.05;
    reasons.push({
      level: critical ? 'critical' : 'warn',
      text: `Temperatura ${critical ? 'crítica' : 'elevada'} ${fmt(m.temp)} °C — acima do limite de ${fmt(tempLimit)} °C.`,
    });
  }
  if (m.vib >= vibLimit) {
    reasons.push({ level: 'warn', text: `Vibração elevada ${fmt(m.vib, 1)} mm/s — limite ${fmt(vibLimit, 1)} mm/s.` });
  }
  if (Number.isFinite(m.fuel) && Number.isFinite(m.params.fuelMin) && m.fuel <= m.params.fuelMin) {
    const critical = m.fuel <= m.params.fuelMin * 0.6;
    const { label, unit } = metricMeta(m, 'fuel');
    reasons.push({
      level: critical ? 'critical' : 'warn',
      text: `${label} ${critical ? 'crítico' : 'baixo'} ${fmt(m.fuel)} ${unit} — mínimo operacional ${fmt(m.params.fuelMin)} ${unit}.`,
    });
  }
  if (Number.isFinite(m.humidity) && Number.isFinite(m.params.humidityLimit) && m.humidity >= m.params.humidityLimit) {
    const { label, unit } = metricMeta(m, 'humidity');
    reasons.push({ level: 'warn', text: `${label} elevada ${fmt(m.humidity)} ${unit} — limite ${fmt(m.params.humidityLimit)} ${unit}.` });
  }
  if (Number.isFinite(m.nh3) && Number.isFinite(m.params.nh3Limit) && m.nh3 >= m.params.nh3Limit) {
    const critical = m.nh3 >= m.params.nh3Limit * 1.15;
    reasons.push({
      level: critical ? 'critical' : 'warn',
      text: `Amônia ${critical ? 'crítica' : 'elevada'} ${fmt(m.nh3)} ppm — limite ${fmt(m.params.nh3Limit)} ppm.`,
    });
  }
  if (Number.isFinite(m.activity) && Number.isFinite(m.params.activityLimit) && m.activity >= m.params.activityLimit) {
    const { label, unit } = metricMeta(m, 'activity');
    reasons.push({ level: 'warn', text: `${label} elevada ${fmt(m.activity)} ${unit} — limite ${fmt(m.params.activityLimit)} ${unit}.` });
  }
  if (Number.isFinite(m.outside) && Number.isFinite(m.params.outsideLimit) && m.outside > m.params.outsideLimit) {
    const { label, unit } = metricMeta(m, 'outside');
    reasons.push({ level: 'warn', text: `${label} acima do limite: ${fmt(m.outside)} ${unit} — máximo ${fmt(m.params.outsideLimit)} ${unit}.` });
  }
  if (m.params.mode === 'paused') reasons.push({ level: 'warn', text: 'Operação pausada pelo operador.' });
  for (const metric of metricsOf(m)) {
    if (!['supplyPct', 'batteryPct', 'loadPct'].includes(metric.key)) continue;
    const value = m[metric.key], limit = m.params[metric.limit];
    if (Number.isFinite(value) && Number.isFinite(limit) && (metric.invert ? value < limit : value >= limit)) {
      reasons.push({ level: 'warn', text: `${metric.label} ${fmt(value, metric.digits || 0)} ${metric.unit} — limite ${fmt(limit)} ${metric.unit}.` });
    }
  }
  if (Number.isFinite(m.unservedKw) && m.unservedKw > 0.01) {
    reasons.push({ level: 'warn', text: `Déficit de fornecimento: ${fmt(m.unservedKw, 2)} kW não atendidos.` });
  }
  return { status: reasons.length ? 'alert' : 'online', reasons };
}

export const STATUS_LABEL = { online: 'Online', alert: 'Alerta', offline: 'Offline' };
