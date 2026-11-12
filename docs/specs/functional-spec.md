# Especificação Funcional — Dashboard IoT (Smart Factory / Smart Farm / Smart Energy / Smart Mining / Smart Pharma)

Esta SPA (Single Page Application) é um dashboard de monitoramento IoT com cena 3D interativa, telemetria reativa, ajuste de parâmetros, comandos remotos e um assistente virtual, com integrações opcionais ao Microsoft Fabric Real-Time Intelligence (RTI) e ao Microsoft Foundry. A interface é implementada em JavaScript modular (sem framework), com Vite e Three.js.

> **Demonstração:** os dados iniciais, a identificação do operador e as informações de sessão são fictícios. A interface não implementa autenticação. Os valores de temperatura, vibração, utilização, KPIs e estado inicial são demonstrações; não representam uma instalação ou processo industrial real.

A SPA oferece cinco cenários alternáveis em tempo de uso — **Smart Factory** (16 máquinas industriais), **Smart Farm** (máquinas de campo, rebanho e instalações agropecuárias), **Smart Energy** (40 ativos de geração, distribuição, consumo e mobilidade), **Smart Mining** (21 ativos da extração à distribuição) e **Smart Pharma** (11 ativos da matéria-prima às farmácias) — que compartilham estado, regras de status, telemetria, comandos e assistente.

---

## 1. Seleção e persistência de cenário

- **REQ-FUNC-001** — O cabeçalho exibe um seletor "Simulação" com cinco opções: "Smart Factory" (`factory`), "Smart Farm" (`farm`), "Smart Energy" (`energy`), "Smart Mining" (`mining`) e "Smart Pharma" (`pharma`).
- **REQ-FUNC-002** — O cenário ativo é persistido em `localStorage` sob a chave `iot-scenario`. Ao carregar a SPA, uma seleção salva válida tem precedência; se ausente ou inválida, usa `VITE_DEFAULT_SCENARIO` quando válido e, caso contrário, `factory`. Se o `localStorage` estiver indisponível, usa o mesmo padrão configurado.
- **REQ-FUNC-003** — Trocar o valor do seletor salva imediatamente a nova escolha em `localStorage` e inicia a ativação do novo cenário.
- **REQ-FUNC-004** — Ao trocar de cenário, a SPA primeiro para a fonte de telemetria anterior (`stop()`) e descarta a cena 3D anterior (`dispose()` — libera geometrias, materiais e o `labelRenderer`, remove os nós do DOM do canvas) antes de montar o novo cenário.
- **REQ-FUNC-005** — Durante a troca de cenário, o seletor fica desabilitado; se a ativação falhar, um toast de erro é exibido e o seletor retorna ao valor do cenário anterior.
- **REQ-FUNC-006** — Cada cenário é um "perfil" registrado centralmente com seu próprio catálogo de ativos, textos de interface, regras de KPI e função de inicialização de cena 3D; adicionar um novo caso de uso não exige alterar o ponto de entrada da aplicação.
- **REQ-FUNC-007** — Os cinco cenários respeitam `VITE_TELEMETRY_MODE` (`mock` ou `fabric`) e `VITE_AGENT_MODE` (`mock` ou `foundry`) independentemente. No modo Fabric, ativos iniciam sem comunicação até receber telemetria; métricas nativas ausentes não são preenchidas com dados mock.
- **REQ-FUNC-008** — Ativar um cenário atualiza todos os textos de interface (título do documento, cabeçalho, nome acessível da marca, instruções, procedimentos, contatos, rótulos de KPI, placeholder do assistente) conforme o perfil daquele cenário.

## 2. Cena 3D interativa

- **REQ-FUNC-009** — A câmera é orbital (arraste para girar, scroll para zoom), com suavização (damping), ângulo polar limitado (não permite olhar por baixo do piso) e distância mínima/máxima restrita.
- **REQ-FUNC-010** — Clicar em um ativo na cena 3D (via raycaster sobre as malhas clicáveis) seleciona o ativo; passar o cursor sobre um ativo clicável muda o ponteiro do mouse para "pointer", caso contrário para "grab".
- **REQ-FUNC-011** — O ativo selecionado recebe um contorno de destaque (outline pass) ao redor do seu modelo 3D.
- **REQ-FUNC-012** — Ao carregar a cena, a câmera anima até a posição padrão do cenário; a duração e a disponibilidade de interação durante a introdução podem variar por cenário.
- **REQ-FUNC-013** — Modo vitrine: se não há ativo selecionado e não há interação do usuário (arraste, clique, zoom, seleção) por 20 segundos, a câmera entra em rotação automática ao redor da cena; qualquer interação ou nova seleção cancela o modo vitrine.
- **REQ-FUNC-014** — Rótulos 2D identificam ativos com status sincronizado (verde=online, amarelo=alerta, vermelho=offline). Na Smart Energy, o selecionado e alertas têm prioridade; os demais rótulos aparecem ao aproximar a câmera, evitando sobreposição de 40 etiquetas.
- **REQ-FUNC-015** — Indicadores visuais adicionais (anel, halo, feixe de luz) do ativo mudam de cor conforme seu status, reavaliados a cada atualização de telemetria.
- **REQ-FUNC-016** — Dicas de uso fixas sobre a cena ("Arraste para orbitar · scroll para zoom", "Clique em um ativo para ver as métricas", "Modo vitrine: a câmera orbita após 20 s sem interação") e uma legenda de cores permanecem visíveis sobre o canvas.
- **REQ-FUNC-017** — (Smart Farm) Os ativos são organizados em zonas sinalizadas por placas (ex.: "Talhão/Tratores", "Garagem/Manutenção", "Armazenagem/Carga", "Suinocultura"); veículos de campo (tratores, pulverizador, caminhão) seguem circuitos fechados próprios com curvas suaves, verificam distância de segurança entre si para evitar colisão, e suas rodas giram proporcionalmente à distância percorrida, parando quando o veículo para.

## 3. Monitoramento reativo

- **REQ-FUNC-018** — A lista de ativos no painel lateral mostra todos os ativos do cenário ativo com indicador de status colorido; clicar em um item seleciona o ativo (mesmo efeito do clique na cena 3D).
- **REQ-FUNC-019** — Os contadores Online/Alerta/Offline do HUD são recalculados a cada atualização de telemetria, contando os ativos pelo status atual.
- **REQ-FUNC-020** — Regra de prioridade 1 (perda de comunicação): se `commLost=true`, o status é sempre `offline`, com motivo "Sem comunicação desde `<hora>` — verificar gateway/sensor.", independentemente de qualquer outra leitura.
- **REQ-FUNC-021** — Regra de prioridade 2 (desligado): se não há perda de comunicação mas `params.mode === 'off'`, o status é `offline` com motivo "Desligada pelo operador (modo Desligado)."
- **REQ-FUNC-022** — Alerta de temperatura: se `temp >= tempLimit`, o ativo entra em `alert`; é classificado como crítico quando `temp >= tempLimit × 1.05` (texto "Temperatura crítica…"), caso contrário "Temperatura elevada…".
- **REQ-FUNC-023** — Alerta de vibração: se `vib >= vibLimit`, alerta "Vibração elevada `<vib>` mm/s — limite `<vibLimit>` mm/s."
- **REQ-FUNC-024** — Alerta de combustível (ativos com `fuel`/`fuelMin` definidos): se `fuel <= fuelMin`, alerta "baixo"; crítico se `fuel <= fuelMin × 0.6`.
- **REQ-FUNC-025** — Alerta de umidade (`humidity`/`humidityLimit`): se `humidity >= humidityLimit`, alerta "Umidade elevada `<humidity>` % — limite `<humidityLimit>` %."
- **REQ-FUNC-026** — Alerta de amônia (`nh3`/`nh3Limit`): se `nh3 >= nh3Limit`, alerta "elevada"; crítico se `nh3 >= nh3Limit × 1.15`.
- **REQ-FUNC-027** — Alerta de atividade do rebanho (`activity`/`activityLimit`): se `activity >= activityLimit`, alerta "Atividade elevada `<activity>` % — limite `<activityLimit>` %."
- **REQ-FUNC-028** — Alerta de cerca virtual (`outside`/`outsideLimit`): se `outside > outsideLimit`, alerta de contagem acima do limite configurado.
- **REQ-FUNC-029** — Modo pausado: se `params.mode === 'paused'` (e o ativo não está offline por outro motivo), soma-se o alerta "Operação pausada pelo operador."; se qualquer um dos alertas acima se aplica, o status final é `alert`; sem nenhum alerta aplicável, o status é `online`.
- **REQ-FUNC-030** — Um ativo pode estar simultaneamente em alerta de temperatura/vibração e em funcionamento (`isRunning=true`); um alerta não implica equipamento parado.
- **REQ-FUNC-031** — O painel de alertas ativos lista todos os ativos com status ≠ `online`, ordenados por severidade (crítico > alerta > offline), clicáveis para selecionar o ativo; sem alertas, mostra "✅ Nenhum alerta ativo — todos os ativos dentro dos limites configurados."
- **REQ-FUNC-032** — O log de eventos registra mudanças de status, ajustes de parâmetros e comandos (até 60 entradas em memória, exibindo as 10 mais recentes), cada uma com hora e descrição textual.

> **Nota de generalização:** os rótulos usados nos alertas de combustível/umidade/atividade/cerca (REQ-FUNC-024, 025, 027, 028) vêm da métrica declarada pelo catálogo do ativo (`asset.metrics`), não de um texto fixo — isso permite que outros casos de uso reaproveitem os mesmos quatro canais genéricos com significados físicos diferentes (ver seção de reorganização em `docs/specs/non-functional-spec.md`).

## 4. Painel do ativo (info panel)

- **REQ-FUNC-033** — Selecionar um ativo abre o painel de informações, mostrando identificação (ID/nome), tipo e um selo de status (Online/Alerta/Offline).
- **REQ-FUNC-034** — O painel lista todos os motivos de alerta ativos do ativo selecionado, um por linha, com o respectivo nível (crítico/alerta/offline).
- **REQ-FUNC-035** — Métricas ao vivo são exibidas com barra de progresso proporcional ao limite configurado (ou a uma escala fixa para métricas sem limite) e destaque visual quando acima do limite; o conjunto de métricas é específico por ativo e cenário. Exemplos incluem temperatura/vibração/utilização na fábrica; temperatura/velocidade/combustível, rebanho e clima na fazenda; geração, água, consumo, bateria e recarga em Energy; vazão, estoques, cargas, rejeitos e entregas em Mining; e lotes, unidades, qualidade e temperatura na cadeia Pharma.
- **REQ-FUNC-036** — O resumo de parâmetros exibe o estado operacional derivado da telemetria ("Em funcionamento" / "Parado"), a localização (quando aplicável) e todos os setpoints do schema do tipo de ativo com seus valores e unidades atuais.
- **REQ-FUNC-037** — Uma dica no rodapé do painel mostra a hora da última leitura e a origem (Fabric RTI ou simulador do cenário) ou, quando sem comunicação, a hora da última leitura conhecida e a instrução de enviar RESUME para reconectar.
- **REQ-FUNC-038** — As métricas do painel exibem um efeito visual de destaque ("flash") quando o status do ativo muda em relação à última leitura exibida.
- **REQ-FUNC-039** — O botão "🤖 Perguntar ao assistente" abre o assistente com uma pergunta pré-preenchida (explicação de funcionamento se o ativo está online, ou motivo do alerta/offline caso contrário).

## 5. Ajuste de parâmetros

- **REQ-FUNC-040** — O botão "⚙️ Ajustar parâmetros" abre um modal com um campo por parâmetro do schema do tipo de ativo (modo de operação + demais setpoints numéricos), pré-populado com os valores atuais.
- **REQ-FUNC-041** — Cada parâmetro numérico tem controle duplo (slider + campo numérico sincronizados) com faixa (min/max) e passo (step) definidos pelo schema; o modo é um grupo de botões (Automático/Manual/Pausado/Desligado).
- **REQ-FUNC-042** — Toda alteração no modal é imediatamente pré-visualizada: reflete-se ao vivo no painel do ativo, na cena 3D e nos alertas/KPIs, sem publicar no dispositivo.
- **REQ-FUNC-043** — Validação por campo: o valor deve ser numérico finito e estar dentro da faixa min–max definida pelo schema do ativo; regras adicionais de consistência do schema (como `tempLimit` maior que `targetTemp`, quando aplicável) também são verificadas. Campos inválidos exibem mensagem de erro e desabilitam o botão "Aplicar".
- **REQ-FUNC-044** — "Restaurar padrão" redefine todos os parâmetros do ativo para os valores de fábrica, com pré-visualização imediata.
- **REQ-FUNC-045** — "Cancelar" (botão, clique fora do modal ou tecla Esc) descarta a pré-visualização, restaurando os parâmetros ao estado anterior à abertura do modal.
- **REQ-FUNC-046** — "Aplicar" (ou Ctrl/Cmd+Enter) só fica habilitado quando todos os campos são válidos; publica os parâmetros alterados na fonte de telemetria ativa, registra o evento no log e incrementa o KPI "Ajustes de parâmetros"; sem alterações pendentes, exibe aviso "Nenhuma alteração para aplicar." sem publicar nada.
- **REQ-FUNC-047** — Se a publicação falhar (erro de rede/dispositivo), a alteração permanece aplicada localmente e um toast de aviso informa a falha de sincronização.
- **REQ-FUNC-048** — A nota no rodapé do modal alterna entre o texto de "pré-visualização" (quando há alterações não aplicadas) e o texto padrão de publicação do cenário.

## 6. Comandos

- **REQ-FUNC-049** — A lista de comandos disponíveis depende do cenário e, na Smart Farm, da família do ativo (campo/rebanho/instalação), cada um com rótulo e ícone próprios (ex.: fábrica usa `EMERGENCY_STOP`/`PAUSE`/`RESUME`/`CALIBRATE`/`SPEED_UP`/`SLOW_DOWN`/`CYCLE_START`; a fazenda reaproveita os mesmos IDs com rótulos como "Conter lote", "Exaustão de emergência", "Localizar lote", "Acalmar lote").
- **REQ-FUNC-050** — `EMERGENCY_STOP` exige confirmação explícita do usuário (diálogo) antes do envio; aplicado, define `mode='off'` e `speed=0`.
- **REQ-FUNC-051** — `PAUSE` define `mode='paused'` (velocidade inalterada).
- **REQ-FUNC-052** — `RESUME` define `mode='auto'` e, se a velocidade estiver zerada, restaura a velocidade padrão do ativo; no simulador local, também tenta reconectar um dispositivo sem comunicação após ~1,5 s.
- **REQ-FUNC-053** — `CYCLE_START` tem o mesmo efeito de `RESUME` sobre modo/velocidade (reinicia o ciclo em modo Automático).
- **REQ-FUNC-054** — `SPEED_UP` aumenta a velocidade em 10 pontos percentuais, até o máximo de 130%.
- **REQ-FUNC-055** — `SLOW_DOWN` reduz a velocidade em 10 pontos percentuais, até o mínimo de 0%.
- **REQ-FUNC-056** — `CALIBRATE` reduz a vibração medida em 25% (`vib *= 0.75`) e, no servidor, incrementa um contador de calibrações do dispositivo.
- **REQ-FUNC-057** — Qualquer comando enviado incrementa o KPI "Comandos enviados", gera uma entrada no log de eventos e é registrado (ack) na fonte de telemetria ativa; falha no envio gera um toast de erro, mas o efeito local permanece registrado.
- **REQ-FUNC-058** — No proxy, comandos e parâmetros são validados por cenário (o `machineId` precisa pertencer ao catálogo daquele cenário) e por conjunto de comandos conhecidos; a resposta de sucesso é `{ ack: true, delivery: 'local-control' }`, que confirma apenas aceitação em memória — não execução física nem persistência no Fabric; o estado desejado é perdido ao reiniciar o proxy.

## 7. Assistente IoT

- **REQ-FUNC-059** — O botão flutuante "🤖" abre/fecha o painel do assistente; ao abrir pela primeira vez (ou após "Nova conversa"), uma mensagem de saudação é exibida apenas no modo mock.
- **REQ-FUNC-060** — O contexto exibido no cabeçalho do assistente mostra o ativo atualmente selecionado (id, nome e status) ou o contexto geral apropriado ao cenário (planta, fazenda, estação, mina ou cadeia farmacêutica) quando nada está selecionado.
- **REQ-FUNC-061** — Sugestões de perguntas (chips) são recalculadas reativamente conforme a seleção e o estado dos ativos.
- **REQ-FUNC-062** — No modo mock, as respostas usam uma base de conhecimento local por cenário e tipo de ativo (como funciona, causas prováveis, manutenção recomendada) combinada ao estado ao vivo do ativo citado/selecionado; reconhecem perguntas sobre o resumo e o domínio do cenário, funcionamento, parâmetros, comandos e causas de alerta, identificando o ativo pelo código ou nome.
- **REQ-FUNC-063** — O modo mock simula uma latência de resposta de ~450–950 ms.
- **REQ-FUNC-064** — No modo Foundry, a mensagem é enviada ao proxy (`/api/agent/chat`) junto com um snapshot do estado da planta (contagens online/alerta/offline, lista de alertas, ativo selecionado) e o ID de conversa atual; o proxy anexa esse contexto à pergunta antes de consultar o agente Foundry, mantendo as credenciais fora do navegador.
- **REQ-FUNC-065** — No modo Foundry, a resposta inclui o ID de conversa retornado pelo servidor, reutilizado nas mensagens seguintes; o botão "Nova conversa" (⟲) reinicia esse ID.
- **REQ-FUNC-066** — Falhas do agente (resposta de texto ausente/vazia, HTTP de erro, timeout) são exibidas como mensagem de erro no chat, sem substituição por resposta local.
- **REQ-FUNC-067** — Durante o processamento de uma pergunta, o campo de entrada e os botões de envio/nova conversa ficam desabilitados, e uma mensagem de "digitando" é exibida até a resposta chegar.

## 8. Telemetria

- **REQ-FUNC-068** — No modo mock, cada dispositivo é simulado fisicamente: a telemetria converge exponencialmente para um ponto de equilíbrio determinado pelos setpoints atuais (modo, velocidade, temperatura alvo) mais ruído de sensor; a velocidade efetiva é 0 quando o modo é `off` ou `paused`.
- **REQ-FUNC-069** — A primeira leitura de cada ativo após ativar um cenário preserva os valores iniciais do catálogo (sem ruído/evolução); as leituras seguintes evoluem a cada ciclo (padrão 1000 ms no navegador).
- **REQ-FUNC-070** — `isRunning` é calculado pela mesma regra em todos os simuladores (navegador, servidor, loopback): `true` quando não há perda de comunicação e a velocidade efetiva (considerando o modo) é maior que zero; caso contrário `false`; nunca é enviado como `null`, e um alerta de temperatura/vibração não implica `isRunning=false`.
- **REQ-FUNC-071** — Comandos e ajustes de parâmetros não são publicados no Fabric; apenas a telemetria medida vai ao Eventstream — o canal de controle é local (HTTP) entre a SPA/simulador e o proxy.
- **REQ-FUNC-072** — No modo `fabric`, a telemetria chega via Server-Sent Events do proxy (`/api/telemetry/stream`), que consulta periodicamente o Eventhouse (KQL) e retransmite a última leitura por máquina; leituras mais antigas que `FABRIC_STALE_SEC` (padrão 15 s) ou máquinas sem leitura são reportadas como `commLost=true` ("sem comunicação"), distinto de qualquer alerta de limite.
- **REQ-FUNC-073** — A barra de status exibe a latência estimada do caminho de telemetria, com indicador visual de alerta quando ultrapassa 150 ms.
- **REQ-FUNC-074** — O painel de sincronização mostra contadores de eventos recebidos/publicados, quantidade de dispositivos sincronizados (sem `commLost`) sobre o total, e a hora da última sincronização.
- **REQ-FUNC-075** — `FABRIC_LOOPBACK=true` faz o proxy emular o Eventstream/Eventhouse inteiramente em memória, permitindo testar o caminho `fabric` fim a fim sem recursos do Fabric provisionados.
- **REQ-FUNC-075b** — As rotas de telemetria/parâmetros/comandos do proxy aceitam um parâmetro `scenario` (query string ou corpo da requisição); cada cenário registrado mantém seu próprio device control e seus próprios clientes SSE, usando o mesmo Eventhouse/Eventstream configurado — o parâmetro é opcional e assume `factory` por padrão, preservando a compatibilidade de quem não o envia.

## 9. KPIs por cenário

- **REQ-FUNC-076** — Fábrica — **Disponibilidade**: percentual de ativos cujo status ≠ `offline`.
- **REQ-FUNC-077** — Fábrica — **OEE estimado**: disponibilidade × performance (uso médio dos ativos em operação, limitado a 100%) × qualidade (0,985 reduzido em 0,004 por ativo em alerta).
- **REQ-FUNC-078** — Fábrica — **Peças produzidas**: contador acumulado, incrementado a cada ciclo de telemetria proporcionalmente à velocidade e ao inverso do tempo de ciclo de cada ativo em operação (ativos parados/pausados não contribuem); é um KPI específico do cenário `factory` — outros cenários não o acumulam.
- **REQ-FUNC-079** — Fábrica — **Paradas não planejadas**: incrementado quando um ativo que não estava em modo `off` transita para `offline`.
- **REQ-FUNC-080** — Fábrica — **Comandos enviados** e **Ajustes de parâmetros**: contadores cumulativos na sessão.
- **REQ-FUNC-081** — Smart Farm — **Disponibilidade** (mesma regra da fábrica); **Combustível médio** (média de combustível dos ativos de campo com leitura válida); **Animais monitorados** (soma de `headcount` dos lotes de rebanho); **Instalações em alerta** (ativos da família "barn" em status `alert`); **Comandos enviados** e **Ajustes de parâmetros** (mesma lógica da fábrica).
- **REQ-FUNC-082** — A cor do indicador de disponibilidade muda conforme a faixa, na Smart Factory e na Smart Farm: verde ≥ 90%, amarelo ≥ 75%, vermelho abaixo disso.

## 10. Modos de execução e variáveis de ambiente

| Configuração | Comportamento |
|---|---|
| `VITE_TELEMETRY_MODE=mock` | Simulação local no navegador (padrão). |
| `VITE_TELEMETRY_MODE=fabric` | Recebe telemetria do proxy por SSE, consultada no Eventhouse. |
| `VITE_AGENT_MODE=mock` | Assistente local com base de conhecimento e contexto da planta (padrão). |
| `VITE_AGENT_MODE=foundry` | Usa o agente Microsoft Foundry através do proxy; o estado da planta é anexado à pergunta. |
| `FABRIC_LOOPBACK=true` | Emula parâmetros/comandos/telemetria em memória no proxy, sem Fabric. |
| `VITE_AGENT_DEBUG` | Força `true`/`false` logs do agente no console do navegador. |
| `VITE_API_BASE` | Prefixo opcional da API (normalmente vazio). |
| `API_PORT` | Porta do proxy Express (padrão `8787`). |
| `API_HOST` | Interface opcional do proxy; `127.0.0.1` restringe o acesso à máquina local. |
| `FABRIC_EVENTSTREAM_CONNECTION_STRING` / `FABRIC_EVENTSTREAM_NAME` | Credenciais/nome do Event Hub do Eventstream (publicação). |
| `FABRIC_KUSTO_URI` / `FABRIC_KUSTO_DATABASE` / `FABRIC_KUSTO_SCOPE` | Endpoint, banco e escopo Entra ID do Eventhouse (consulta). |
| `FABRIC_KUSTO_TENANT_ID` | Tenant opcional para consultas ao Eventhouse; não altera a credencial padrão do Foundry. |
| `FABRIC_TELEMETRY_TABLE` | Tabela KQL de telemetria (padrão `MachineTelemetry`). |
| `FABRIC_POLL_MS` / `FABRIC_STALE_SEC` | Intervalo de consulta e limite de telemetria desatualizada. |
| `DEVICE_INTERVAL_MS` / `DEVICE_CONTROL_URL` | Intervalo do simulador de dispositivos e URL do proxy consultada por ele. |
| `SCENARIO` | Cenário simulado por `server/deviceSimulator.js` (padrão `factory`; qualquer id registrado em `server/catalogs.js`). |
| `FOUNDRY_PROJECT_ENDPOINT` / `FOUNDRY_AGENT_NAME` / `FOUNDRY_AGENT_ID` | Endpoint do projeto Foundry, nome do agente (ou ID legado `asst_...`). |
| `FOUNDRY_API_VERSION` / `FOUNDRY_SCOPE` / `FOUNDRY_TIMEOUT_MS` | Versão de API, escopo Entra ID e timeout do agente. |
| `FOUNDRY_DEBUG=true` | Registra payload/resposta do agente no console do proxy (pode expor conteúdo de conversas). |

- **REQ-FUNC-083** — `VITE_TELEMETRY_MODE` alterna entre `mock` (padrão) e `fabric`, conforme a tabela acima.
- **REQ-FUNC-084** — `VITE_AGENT_MODE` alterna entre `mock` (padrão) e `foundry`, conforme a tabela acima.
- **REQ-FUNC-085** — `FABRIC_LOOPBACK=true` permite testar o adaptador `fabric` fim a fim sem recursos do Fabric provisionados.
- **REQ-FUNC-086** — `VITE_AGENT_DEBUG` e `FOUNDRY_DEBUG` controlam, independentemente, o nível de log do agente no navegador e no proxy, respectivamente.
- **REQ-FUNC-087** — O proxy autentica no Fabric e no Foundry com `DefaultAzureCredential`; o tenant opcional do Fabric não altera a credencial padrão do Foundry. Credenciais nunca são colocadas em variáveis `VITE_*` (que podem ir ao bundle do navegador).
- **REQ-FUNC-088** — As demais variáveis da tabela configuram portas, intervalos de polling/simulação e parâmetros de conexão do Eventhouse/Eventstream/Foundry.

## 11. Execução local

- **REQ-FUNC-089** — `npm run dev` inicia somente o Vite (porta 5173); suficiente para os modos mock de telemetria e assistente.
- **REQ-FUNC-090** — `npm run dev:all` inicia a SPA e o proxy Express simultaneamente (necessário para os modos `fabric`/`foundry`).
- **REQ-FUNC-091** — `npm run server` inicia apenas o proxy Express (porta padrão `8787`, configurável por `API_PORT`); em produção, também serve os arquivos estáticos de `dist/` quando existentes.
- **REQ-FUNC-092** — `npm run simulate:devices` inicia o simulador Node de dispositivos, que publica telemetria no Eventstream e consulta o estado desejado no proxy a cada `DEVICE_INTERVAL_MS` (padrão 2000 ms); `SCENARIO=<id>` seleciona qual catálogo registrado é simulado (padrão `factory`).
- **REQ-FUNC-093** — No Windows, `./dev.ps1 start|status|stop|restart` gerencia os processos da SPA e do proxy via PowerShell, com logs ao vivo e cópia em `.dev-processes\stdout.log`.
- **REQ-FUNC-094** — `npm run build` gera a SPA em `dist/`; `npm run preview` serve apenas o front-end buildado (sem API).
- **REQ-FUNC-095** — `npm test` executa os 18 arquivos de teste Node registrados em `package.json`, cobrindo controle, telemetria, assistente, catálogos, layouts, simulações, integrações e recursos visuais dos cinco cenários; dependências do Azure são isoladas por mocks.

## 12. Smart Energy — cidade, água e rede elétrica

- **REQ-FUNC-096** — O catálogo contém exatamente 40 ativos: dez painéis e dois inversores, três turbinas e uma comporta, cinco carregadores, dez casas, quatro carros, dois caminhões e três circuitos. Os 14 IDs originais são preservados.
- **REQ-FUNC-097** — A paisagem diurna apresenta represa elevada, barragem, tomada/condutos, turbinas visíveis em corte e canal de saída conectado ao rio. O movimento dos rotores depende da vazão recebida.
- **REQ-FUNC-098** — Dez painéis individuais ficam em duas fileiras em campo verde fora da cidade. A cidade tem dez casas, ruas, lotes e acesso à praça de recarga.
- **REQ-FUNC-099** — Postes e fios conectam as fontes solar/hídrica à distribuição urbana. Qualquer seleção de um trecho monitorado remete ao circuito correspondente, não a um ativo por poste.
- **REQ-FUNC-100** — O motor didático calcula nível do reservatório por afluência e saídas, potência hídrica por vazão/queda/eficiência e solar por irradiância/sujidade/estado dos inversores. A comporta do vertedouro controla descarga separada das turbinas. Sem vazão não há geração hídrica.
- **REQ-FUNC-101** — As fontes convergem no barramento; são consideradas perdas ilustrativas de 2%. A energia disponível é repartida proporcionalmente entre demanda residencial e recarga, sem dupla contagem de painéis e inversores.
- **REQ-FUNC-102** — Isolar circuito solar ou hídrico remove apenas essa fonte; isolar distribuição urbana interrompe atendimento a casas e recarga. Déficit gera alerta, independentemente da comunicação dos medidores.
- **REQ-FUNC-103** — Casas mostram consumo atendido em kW, atendimento em % e energia acumulada em kWh. Circuitos mostram potência, carregamento e tensão. Limites configuráveis geram alertas com unidades/rótulos do catálogo.
- **REQ-FUNC-104** — Quatro carros e dois caminhões circulam em rotas com distância de segurança; os modelos e hitboxes acompanham posições recebidas. Rodas giram com deslocamento.
- **REQ-FUNC-105** — Bateria ≤20% aciona busca por posto compatível e reserva de vaga. A recarga depende da potência efetivamente atendida; ao atingir 80% o veículo libera o posto e volta à rua. Parada e bateria esgotada impedem circulação.
- **REQ-FUNC-106** — Mock do navegador, loopback e publicador de dispositivos usam o mesmo motor de conjunto. Em Fabric real, a cena interpola observações; campos ausentes são indisponíveis e não recebem valores simulados. A última posição de um veículo sem comunicação é mantida e sinalizada.
- **REQ-FUNC-107** — Casas, veículos e circuitos participam de lista, seleção, painel, parâmetros, comandos específicos e contexto do assistente. A API valida o schema do tipo e rejeita ações incompatíveis.
- **REQ-FUNC-108** — Modelos/texturas são carregados localmente de forma assíncrona, com indicador de carregamento e erro explícito, sem substituição silenciosa. O cenário descarta recursos ao sair. Não há rede externa, bateria estacionária, fluxo AC nem controle industrial real.

## 13. Smart Mining — da extração à entrega

- **REQ-FUNC-109** — O catálogo contém 21 ativos: escavadeira, quatro caminhões de mina, três britadores, correia, usina de beneficiamento, seis silos, caminhão de entrega, terminal e três centros de distribuição. Os oito IDs originais são preservados. A cena identifica as zonas e permite seleção e comandos por ativo.
- **REQ-FUNC-110** — A extração abastece a cava; quatro caminhões transportam minério por faixas independentes até os britadores designados, que compartilham a correia. A usina distribui o produto entre silos disponíveis; o caminhão de entrega alterna silos e centros em rodízio, com retorno contínuo até o próximo ponto de carga. Uma entrega só é contabilizada na descarga, com centro e terminal disponíveis.
- **REQ-FUNC-111** — O beneficiamento separa 90% de produto e 10% de rejeitos. A massa extraída é igual à soma dos estoques, cargas dos caminhões, recebimentos dos centros e rejeitos acumulados; estoques e cargas respeitam capacidades finitas. O contador do terminal agrega os centros, sem duplicar massa.
- **REQ-FUNC-112** — O estado inicial contabiliza 31 t extraídas: 12 t na cava, 6 t no britador, 3 t na correia, 2 t na alimentação da usina e 8 t no silo. Em mock, a troca de cenário reinicia esses valores; em Fabric, prevalecem as leituras recebidas do Eventhouse.
- **REQ-FUNC-113** — Etapas pausadas, desligadas, desconectadas ou com velocidade zero não produzem fluxo; as demais podem consumir estoques existentes. Veículos parados preservam posição e carga, retomando a fase anterior quando liberados. Uma carga parcial segue após cinco segundos sem novo material ou quando a origem fica indisponível.
- **REQ-FUNC-114** — Telemetria, KPIs e assistente apresentam extração, vazões, estoques, cargas, rejeitos e entregas quando disponíveis. A Smart Mining suporta mock ou Fabric/Foundry, reutiliza texturas locais e não controla equipamentos reais.
- **REQ-FUNC-115** — A simulação mantém desvios demonstrativos de vibração em `MIN-BRI-002` e temperatura em `MIN-SIL-005` e `MIN-DIS-002`, gerando alertas pelas regras e limites comuns. Em Fabric, prevalecem as medições recebidas, sem injeção de alertas na UI.

---

## 14. Smart Pharma — cadeia produtiva farmacêutica

- **REQ-FUNC-116** — O catálogo contém 11 ativos selecionáveis: cinco setores da fábrica em sequência linear, três caminhões refrigerados, um centro de distribuição e duas farmácias. A cena separa a fábrica da Smart City, que contém cinco casas, três carros, ruas e farmácias com fachadas envidraçadas e sinalização própria; a fábrica possui estruturas industriais e o centro de distribuição exibe área de armazenagem e doca. Os carros e caminhões usam modelos locais da Smart Energy; os caminhões recebem uma unidade de refrigeração ilustrativa e suas rodas acompanham o deslocamento.
  O mapa apresenta fábrica, distribuição e cidade da esquerda para a direita, com identificação persistente das áreas, números de etapas, setas e faixa navegável do lote ao paciente. A câmera não orbita automaticamente neste cenário. A fonte pode ser escolhida explicitamente entre Fabric RTI e simulação local, com preferência salva por navegador somente para Pharma; trocar a fonte reinicia o estado local. Falhas do Fabric não acionam fallback silencioso nem são corrigidas artificialmente por comandos.
- **REQ-FUNC-117** — O recebimento gera lotes de 100 unidades equivalentes a cada 12 segundos de atividade. O identificador acompanha o lote; cada instalação recebe até 300 unidades e cada caminhão, 100. Os caminhões em operação fazem viagens contínuas do armazém ao centro e deste às farmácias, com rodízio entre farmácias disponíveis e reserva de capacidade. No simulador, as entregas do centro às farmácias seguem pela rua da cidade; caminhões vazios alternam entre o armazém e o centro enquanto aguardam cargas. Os carros da cidade variam a velocidade e escolhem caminhos no entroncamento, com verificações de distância em relação aos demais veículos.
- **REQ-FUNC-118** — Cada quinto lote é bloqueado por resultado fictício de qualidade. Lotes em etapas refrigeradas fora de 2 a 8 °C são bloqueados permanentemente nesta execução; comandos e ajustes de limites não removem bloqueios. A regra não representa liberação ou validação de medicamentos reais.
- **REQ-FUNC-119** — Ativos indisponíveis ou cheios impedem suas transferências; uma farmácia indisponível não impede entregas à outra, enquanto o centro único indisponível bloqueia seu trecho da cadeia. Pausar mantém o alvo térmico; desligar faz a temperatura convergir para 22 °C. Caminhões pausados preservam posição e carga, salvo bloqueio por excursão térmica. Entregas aumentam ao concluir a etapa de uma farmácia. Unidades recebidas equivalem às unidades em processo, incluindo cargas, bloqueadas e entregues.
- **REQ-FUNC-120** — KPIs, alertas, comandos e assistente usam o contexto farmacêutico. No estado inicial do simulador, os 11 ativos estão conectados e enviam telemetria; `PHA-TRK-001` e `PHA-TRK-002` estão em movimento, enquanto `PHA-TRK-003` permanece conectado e estacionado. Cada leitura Pharma inclui `status` calculado pelas mesmas regras da interface, independentemente de `isRunning`; ausência de leitura é detectada pelo tempo decorrido. Mock e Fabric/Foundry são opcionais; em Fabric, campos ausentes não recebem valores simulados. A interface exibe somente o lote em atendimento, não um histórico regulatório.

## 15. Smart Farm — campo, rebanho e instalações

- **REQ-FUNC-121** — O catálogo contém 16 ativos: seis equipamentos de campo, quatro lotes de bovinos/ovinos e seis instalações agropecuárias (celeiro, dois silos e três áreas de suinocultura), selecionáveis na cena ou na lista.
- **REQ-FUNC-122** — As métricas dependem da família do ativo: campo inclui temperatura, velocidade e combustível; rebanho inclui temperatura, atividade e contagem fora da cerca; instalações incluem temperatura, umidade, amônia ou nível. Leituras não recebidas no modo Fabric permanecem indisponíveis e não são substituídas por valores simulados.
- **REQ-FUNC-123** — A cena organiza as zonas de campo, manutenção, armazenagem, pastagens e instalações. Tratores, pulverizador e caminhão seguem circuitos independentes com curvas suaves e distância de segurança; as rodas acompanham o deslocamento e param com o veículo.
- **REQ-FUNC-124** — Os KPIs da fazenda mostram disponibilidade, combustível médio dos equipamentos de campo com leitura, animais monitorados dos lotes com leitura e instalações em alerta, além de contadores de comandos e ajustes. Valores sem leitura válida são mostrados como indisponíveis.
- **REQ-FUNC-125** — Os comandos e seus rótulos dependem da família: equipamento de campo, rebanho ou instalação. Ações de contenção/localização são específicas do rebanho; ações de exaustão e ventilação são específicas das instalações.
- **REQ-FUNC-126** — O simulador genérico evolui combustível e velocidade dos equipamentos, e atividade, temperatura e métricas ambientais conforme os parâmetros; controles e alertas afetam somente a demonstração, não representam rastreamento GPS nem orientação veterinária ou operação real.

## Nota de rastreabilidade

Esta especificação reflete a estrutura compartilhada em `app/src/{core,domain,usecases,integration,ui}` e os cinco cenários com integrações opcionais. A cobertura de cada cenário varia; as verificações de Fabric/Foundry na suíte são isoladas com mocks e não comprovam integração com uma assinatura real.
