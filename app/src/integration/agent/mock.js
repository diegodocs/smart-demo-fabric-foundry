// Agente mock: responde com base em uma base de conhecimento local + estado ao vivo.
// Mesmo contrato do adaptador Foundry: send(text, context) → { text, source }.

const KB = {
  cnc: {
    how: 'Centro de usinagem CNC: o spindle gira a ferramenta enquanto os eixos X/Y/Z deslocam a mesa conforme o programa G-code. O fluido de corte refrigera ferramenta e peça; a IHM mostra temperatura do cabeçote, vibração do spindle e utilização.',
    causes: ['ferramenta desgastada ou quebrada', 'fluido de corte baixo ou concentração incorreta', 'avanço/rotação acima do recomendado para o material', 'rolamentos do spindle com folga (vibração)'],
    maint: ['verificar nível e concentração do fluido de corte a cada turno', 'inspecionar desgaste de ferramentas (vida útil no CNC)', 'limpar cavacos da mesa e dos barramentos', 'lubrificar guias conforme plano preventivo'],
  },
  robot: {
    how: 'Robô industrial de 6 eixos: cada junta tem servomotor com encoder; o controlador interpola trajetórias pick & place. A garra pneumática abre/fecha no ciclo programado e a célula é protegida por intertravamentos.',
    causes: ['carga acima do payload ou mal centrada', 'redutores com folga (vibração)', 'cabo/encoder com falha (perda de comunicação)', 'ciclo muito curto aquecendo os servos'],
    maint: ['verificar cabos e conectores do braço (dress pack)', 'checar pressão de ar da garra', 'backup do programa do controlador', 'trocar graxa dos redutores conforme horas de operação'],
  },
  conveyor: {
    how: 'Esteira transportadora: motor elétrico com redutor aciona o tambor de tração; a correia leva os volumes entre estações. Um sensor fotoelétrico detecta passagem e a IHM local mostra a utilização.',
    causes: ['correia desalinhada ou com tensão incorreta', 'rolamentos dos roletes gastos', 'sobrecarga de volumes', 'acoplamento motor-redutor desalinhado'],
    maint: ['ajustar tensão e alinhamento da correia', 'lubrificar mancais', 'limpar sensores fotoelétricos', 'inspecionar emendas da correia'],
  },
  forklift: {
    how: 'Empilhadeira elétrica: motor de tração e bomba hidráulica alimentados por bateria; o garfo é elevado pelo mastro hidráulico. A telemetria traz temperatura do motor/controlador, vibração e utilização da frota.',
    causes: ['bateria com baixa carga exigindo mais corrente', 'pneus gastos ou piso irregular (vibração)', 'operação contínua sem pausa para resfriamento', 'óleo hidráulico baixo'],
    maint: ['checklist diário (freios, buzina, giroflex, garfos)', 'recarga/equalização da bateria', 'verificar desgaste dos pneus', 'nível de óleo hidráulico'],
  },
  injector: {
    how: 'Injetora de plástico: o canhão aquecido por resistências plastifica o material; a rosca injeta no molde fechado pela unidade de fechamento (toggle). Após resfriamento o molde abre e a peça é extraída.',
    causes: ['resistência ou termopar do canhão com falha', 'setpoint de temperatura acima do especificado para o polímero', 'refrigeração do molde insuficiente', 'ciclo curto demais'],
    maint: ['aferir termopares das zonas de aquecimento', 'verificar circuito de água do molde', 'limpar funil e desumidificador', 'inspecionar bico e anel de bloqueio'],
  },
  press: {
    how: 'Prensa hidráulica de 4 colunas: a bomba pressuriza o cilindro principal que desce o martelo (slide) sobre a matriz. A cortina de luz de segurança interrompe o ciclo se alguém entrar na área.',
    causes: ['cadência acima do recomendado', 'folga nas buchas das colunas (vibração)', 'óleo hidráulico quente/contaminado', 'matriz mal fixada'],
    maint: ['testar a cortina de luz no início do turno', 'verificar temperatura e nível do óleo', 'reapertar fixação da matriz', 'checar vazamentos nas mangueiras'],
  },
  welder: {
    how: 'Célula de solda robotizada: robô com tocha MIG/MAG percorre o cordão programado; a fonte controla corrente/tensão do arco. Cortinas de proteção bloqueiam a radiação e as faíscas.',
    causes: ['bico de contato gasto', 'vazão de gás de proteção inadequada', 'velocidade de soldagem alta gerando instabilidade', 'cabo terra com mau contato'],
    maint: ['trocar bico de contato e limpar bocal', 'verificar vazão de gás', 'calibrar TCP da tocha', 'inspecionar cortinas de proteção'],
  },
};

const fmt = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// fuel/humidity/activity/outside são canais genéricos reaproveitados por outros casos de uso
// (farm, energy) com significados físicos diferentes; o rótulo vem do catálogo do ativo
// (m.metrics), caindo para o nome histórico da fábrica/fazenda quando o ativo não o declara.
function limitLabel(m, limitKey, fallbackLabel) {
  const metric = m.metrics?.find((x) => x.limit === limitKey);
  return { label: (metric?.label || fallbackLabel).toLowerCase(), unit: metric?.unit || '' };
}

function describeParams(m) {
  const p = m.params;
  const bits = [`Modo ${p.modeLabel || p.mode}`, `velocidade ${p.speed}%`];
  if (p.targetTemp != null) bits.push(`temperatura alvo ${fmt(p.targetTemp)} °C`);
  if (p.tempLimit != null) bits.push(`limite de temperatura ${fmt(p.tempLimit)} °C`);
  if (p.vibLimit != null) bits.push(`limite de vibração ${fmt(p.vibLimit, 1)} mm/s`);
  if (p.fuelMin != null) { const { label, unit } = limitLabel(m, 'fuelMin', 'combustível'); bits.push(`${label} mínimo ${fmt(p.fuelMin)} ${unit || '%'}`); }
  if (p.humidityLimit != null) { const { label, unit } = limitLabel(m, 'humidityLimit', 'umidade'); bits.push(`limite de ${label} ${fmt(p.humidityLimit)} ${unit || '%'}`); }
  if (p.nh3Limit != null) bits.push(`limite de amônia ${fmt(p.nh3Limit)} ppm`);
  if (p.activityLimit != null) { const { label, unit } = limitLabel(m, 'activityLimit', 'atividade'); bits.push(`limite de ${label} ${fmt(p.activityLimit)} ${unit || '%'}`); }
  if (p.outsideLimit != null) { const { label, unit } = limitLabel(m, 'outsideLimit', 'fora da cerca'); bits.push(`${label} máximo ${fmt(p.outsideLimit)} ${unit}`.trim()); }
  if (p.cycleTime != null) bits.push(`ciclo ${p.cycleTime} s`);
  return `${bits.join(', ')}.`;
}

function readingLine(m) {
  const t = m.telemetry || {};
  if (m.metrics?.length) {
    return m.metrics.map((metric) => {
      const value = t[metric.key];
      return `${metric.label.toLowerCase()} ${Number.isFinite(value) ? fmt(value, metric.digits || 0) : '—'} ${metric.unit}`;
    }).join(', ');
  }
  return `${fmt(t.temp)} °C, ${fmt(t.vib, 1)} mm/s, uso ${t.usage}%`;
}

function explainStatus(m, table = KB) {
  const t = m.telemetry;
  const head = `${m.id} · ${m.name} está **${m.statusLabel}** (${readingLine(m)}).`;
  if (m.status === 'online') return `${head}\nTodos os sensores dentro dos limites configurados.\nParâmetros: ${describeParams(m)}`;
  const kb = table[m.type];
  const lines = [head, '', 'Motivo:', ...m.reasons.map((r) => `• ${r}`), '', 'O que fazer:'];
  if (m.commLost) {
    lines.push('• Verifique alimentação e cabo de rede do gateway da máquina.', '• Envie RESUME para tentar reconectar o dispositivo.', '• Persistindo, acione Suporte TI / IoT (ramal 4008).');
  } else if (m.params.mode === 'off') {
    lines.push('• A máquina foi desligada pelo operador. Para retomar, envie RESUME ou mude o modo para Automático.');
  } else {
    const tempHigh = t.temp >= m.params.tempLimit;
    const vibHigh = t.vib >= m.params.vibLimit;
    if (tempHigh) lines.push(`• Reduza a velocidade (SLOW_DOWN) ou a temperatura alvo — hoje ${fmt(m.params.targetTemp)} °C; algo abaixo de ${fmt(m.params.tempLimit * 0.95)} °C deve normalizar.`);
    if (vibHigh) lines.push(`• Reduza a velocidade para ~${Math.max(50, m.params.speed - 20)}% ou aplique PAUSE e solicite inspeção mecânica.`);
    if (Number.isFinite(t.fuel) && Number.isFinite(m.params.fuelMin) && t.fuel <= m.params.fuelMin) {
      const { label } = limitLabel(m, 'fuelMin', 'combustível');
      lines.push(`• ${label[0].toUpperCase()}${label.slice(1)} abaixo do mínimo: reduza a carga e normalize a condição antes de continuar.`);
    }
    if (Number.isFinite(t.nh3) && Number.isFinite(m.params.nh3Limit) && t.nh3 >= m.params.nh3Limit) {
      lines.push('• Amônia elevada: aumente a ventilação e verifique cama ou aeração.');
    }
    if (Number.isFinite(t.outside) && Number.isFinite(m.params.outsideLimit) && t.outside > m.params.outsideLimit) {
      const { label } = limitLabel(m, 'outsideLimit', 'fora da cerca');
      lines.push(`• ${label[0].toUpperCase()}${label.slice(1)} acima do limite: verifique e normalize a condição.`);
    }
    if (m.params.mode === 'paused') lines.push('• Operação pausada: envie RESUME quando a condição for liberada.');
    if (t.unservedKw > 0.01) lines.push('• Há déficit na rede: verifique geração solar/hídrica e os três circuitos. O atendimento é repartido proporcionalmente entre casas e recarga.');
    if (t.batteryPct <= 20) lines.push('• O veículo procura um posto compatível com bateria em 20% ou menos; a recarga termina em 80%. Sem fornecimento elétrico a bateria não recarrega.');
    if (kb?.causes?.length) lines.push('', `Causas comuns em ${(m.typeLabel || m.type).toLowerCase()}:`, ...kb.causes.slice(0, 3).map((c) => `• ${c}`));
  }
  return lines.join('\n');
}

function plantSummary(ctx) {
  const s = ctx.summary;
  const lines = [`${ctx.plant || 'Planta'}: ${s.online} online, ${s.alert} em alerta, ${s.offline} offline (de ${s.total}).`];
  if (ctx.alerts.length) {
    lines.push('', 'Pontos de atenção:');
    ctx.alerts.forEach((a) => lines.push(`• ${a.id} · ${a.name}: ${a.reasons[0] || a.status}`));
  } else lines.push('Nenhum alerta ativo. 👍');
  return lines.join('\n');
}

function findMachine(text, ctx) {
  const energyId = text.toUpperCase().match(/\b[A-Z]{3}-[A-Z]{3}-\d{3}\b/);
  if (energyId) {
    const item = ctx.machines.find((m) => m.id === energyId[0]);
    if (item) return ctx.selected?.id === item.id ? ctx.selected : { ...item, partial: true };
  }
  const id = text.toUpperCase().match(/\b([A-Z]{3})-?(\d{3})\b/);
  if (id) {
    const key = `${id[1]}-${id[2]}`;
    if (ctx.selected?.id === key) return ctx.selected;
    const a = ctx.machines.find((m) => m.id === key);
    if (a) return { ...a, partial: true };
  }
  const lower = text.toLowerCase();
  const byName = ctx.machines.find((m) => lower.includes(m.name.toLowerCase()));
  if (byName) return ctx.selected?.id === byName.id ? ctx.selected : { ...byName, partial: true };
  return ctx.selected;
}

export function answer(text, ctx, snapshotOf, pack = null) {
  const table = pack?.kb || KB;
  const q = text.toLowerCase();
  let m = findMachine(text, ctx);
  if (m?.partial && snapshotOf) m = snapshotOf(m.id);
  const kb = m ? table[m.type] : null;
  const commandRequest = /comando|emergenc|parar|pausar|retomar|conter|exaust/.test(q);
  const commands = () => pack?.commands || 'Comandos disponíveis:\n• EMERGENCY_STOP — desliga imediatamente (modo Desligado)\n• PAUSE / RESUME — pausa e retoma o ciclo\n• SPEED_UP / SLOW_DOWN — ±10% de velocidade\n• CALIBRATE — recalibra sensores de vibração\n• CYCLE_START — inicia ciclo em modo Automático';

  if (/resumo|planta|fazenda|rebanho|talh[aã]o|geral|todas|quais.*(alerta|máquinas)|status da linha/.test(q) || (!m && /alerta|alarme|status/.test(q))) {
    return [plantSummary(ctx), pack?.summary?.(ctx)].filter(Boolean).join('\n\n');
  }
  if (!m) {
    if (commandRequest) return commands();
    return pack?.empty || 'Posso explicar o funcionamento, alarmes, parâmetros e manutenção de qualquer máquina da linha.\nSelecione um ativo na cena ou cite o código (ex.: "Por que a INJ-002 está em alerta?").';
  }
  if (/funciona|o que (é|faz)|como opera|princípio/.test(q)) {
    return `${m.id} · ${m.name} (${m.typeLabel})\n\n${kb.how}\n\nParâmetros atuais: ${describeParams(m)}`;
  }
  if (/manuten|preventiv|inspe|checklist/.test(q)) {
    return `Manutenção recomendada — ${m.typeLabel}:\n${kb.maint.map((x) => `• ${x}`).join('\n')}`;
  }
  if (/parâmetr|parametr|ajust|setpoint|velocidade|limite|ciclo|configur/.test(q)) {
    const standard = describeParams({ params: { ...m.defaults, modeLabel: m.defaults.mode } });
    return `Parâmetros de ${m.id}: ${describeParams(m)}\n\nPadrão do ativo: ${standard}\n\nDica: use "⚙️ Ajustar parâmetros" — a pré-visualização mostra o efeito antes de aplicar.`;
  }
  if (commandRequest) return commands();
  if (/causa|por que|porque|alerta|alarme|problema|status|está/.test(q)) return pack?.status?.(m) || explainStatus(m, table);
  return pack?.status?.(m) || explainStatus(m, table);
}

export function createMockAgent({ snapshotOf, kb, assistant } = {}) {
  const pack = kb ? { kb, empty: assistant?.empty, commands: assistant?.commands, summary: assistant?.summary, status: assistant?.status } : null;
  return {
    mode: 'mock',
    label: 'Agente local (mock)',
    intro: assistant?.intro || 'Olá! Sou o assistente da Linha A. Posso explicar como cada máquina funciona, por que um ativo está em alerta, quais parâmetros ajustar e a manutenção recomendada.\nSelecione uma máquina na cena ou pergunte direto.',
    summaryChip: assistant?.summaryChip,
    placeholder: assistant?.placeholder,
    async send(text, context) {
      await new Promise((r) => setTimeout(r, 450 + Math.random() * 500));
      return { text: answer(text, context, snapshotOf, pack), source: 'Base de conhecimento local · estado ao vivo' };
    },
    reset() {},
  };
}
