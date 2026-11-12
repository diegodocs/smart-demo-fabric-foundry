# Dashboard IoT multi-cenário — Smart Factory · Smart Farm · Smart Energy · Smart Mining · Smart Pharma

SPA de monitoramento IoT com cena 3D interativa, telemetria reativa e integrações opcionais com Microsoft Fabric Real-Time Intelligence (RTI) e Microsoft Foundry. A interface é feita em JavaScript modular, sem framework, com Vite e Three.js. Cinco cenários compartilham o mesmo motor reativo, regras de status, telemetria, comandos e assistente: **Smart Factory** (16 máquinas industriais), **Smart Farm** (máquinas de campo, rebanho e instalações agropecuárias), **Smart Energy** (geração, cidade e recarga de veículos), **Smart Mining** (extração, beneficiamento e entrega de minério) e **Smart Pharma** (cadeia farmacêutica da matéria-prima ao consumidor).

> **Demonstração:** os dados iniciais, a identificação do operador e as informações de sessão são fictícios. A interface não implementa autenticação. Todos os cenários permitem telemetria Microsoft Fabric e assistente Microsoft Foundry, ou implementações mock locais. O controle HTTP continua exclusivo do simulador.

## Requisitos

- Node.js 24 ou superior e npm.
- Para integrações reais: recursos e permissões configurados no Microsoft Fabric e/ou Microsoft Foundry, conforme necessário.

## Executar localmente

Na raiz do projeto:

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. Por padrão, a telemetria e o assistente usam implementações mock locais; esse modo não exige o proxy.

Para iniciar a SPA e o proxy Express juntos:

```bash
npm run dev:all
```

No Windows, também é possível gerenciar os dois processos pelo PowerShell:

```powershell
.\dev.ps1 start
.\dev.ps1 status
.\dev.ps1 stop
.\dev.ps1 restart
```

O script abre um console com os logs ao vivo e grava uma cópia em `.dev-processes\stdout.log`. Se a política local bloquear scripts, execute `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 start`. Para interromper a execução manual de `npm run dev:all`, use `Ctrl+C`.

## O que a SPA oferece

- **Cenário:** o seletor **Simulação** alterna entre **Smart Factory** (padrão), **Smart Farm**, **Smart Energy**, **Smart Mining** e **Smart Pharma**. A escolha fica em `localStorage` (`iot-scenario`); os IDs são `factory`, `farm`, `energy`, `mining` e `pharma`. Sem escolha válida salva, `VITE_DEFAULT_SCENARIO` define o cenário inicial. Os cinco cenários respeitam `VITE_TELEMETRY_MODE` e `VITE_AGENT_MODE`, com telemetria e assistente configuráveis independentemente.
- **Cena 3D:** cada cenário tem uma cena e uma cadeia operacional próprias; ativos animados, câmera orbital, seleção e modo vitrine.
- **Qualidade visual:** os cinco cenários usam iluminação física, sombras suaves e texturas locais com mapas normais. Os rótulos da cena aparecem somente enquanto o mouse está sobre o ativo correspondente, inclusive para ativos selecionados, em alerta ou offline; os indicadores visuais de status permanecem disponíveis.
- **Organização da Smart Farm:** talhões separados para tratores, pulverização, colheita e irrigação; garagem de manutenção, pátio logístico de mão única, armazenagem, pastagens e suinocultura. Veículos seguem circuitos independentes com curvas suaves e verificação de distância de segurança; as rodas acompanham o deslocamento e param junto com o veículo.
- **Organização da Smart Energy:** represa, barragem, condutos e três turbinas em corte didático; campo verde rural com dez painéis; cidade com dez casas, ruas, quatro carros e dois caminhões circulando; cinco postos de recarga e três circuitos aéreos com postes/fios.
- **Organização da Smart Mining:** cava, quatro caminhões de mina em faixas independentes, três britagens, correia, usina, seis silos, caminhão de entrega, terminal e três centros de distribuição, com estoques, cargas e entregas acompanhados ao vivo.
- **Organização da Smart Pharma:** fábrica com cinco setores em sequência linear, **Smart City** em área separada com cinco casas, três carros e duas farmácias, um centro de distribuição e três caminhões refrigerados com lotes e cadeia fria simulados.
- **Monitoramento reativo:** lista de máquinas, estados online/alerta/offline, métricas, alertas, KPIs, eventos e sincronização.
- **Painel do ativo:** temperatura, vibração, utilização, limites e setpoints.
- **Ajuste de parâmetros:** pré-visualização imediata na interface, validação por tipo de máquina, restauração dos valores padrão e aplicação ou cancelamento.
- **Comandos:** `EMERGENCY_STOP`, `PAUSE`, `RESUME`, `CALIBRATE`, `SPEED_UP`, `SLOW_DOWN` e `CYCLE_START`. A parada de emergência pede confirmação.
- **Assistente IoT:** no modo mock, responde com uma base local sobre máquinas, estado e manutenção; no modo Foundry, conversa com o agente configurado e recebe o contexto ao vivo da planta enviado pelo proxy.
- **Telemetria:** simulador local no navegador ou leitura do Fabric Eventhouse via proxy. Somente telemetria vai ao Fabric; comandos e ajustes usam o controle HTTP local do simulador.
- **Estado operacional:** `isRunning=true` indica em funcionamento; `false` indica parado (desligado, pausado ou velocidade zero). O painel mostra esse estado recebido por telemetria separadamente de perda de comunicação.

Os valores de temperatura, vibração, utilização, KPIs e estado inicial são demonstrações; não representam uma instalação ou processo industrial real.

As especificações funcional e não funcional do sistema, obtidas por engenharia reversa do comportamento atual, estão em [docs/specs/functional-spec.md](docs/specs/functional-spec.md) e [docs/specs/non-functional-spec.md](docs/specs/non-functional-spec.md).

Na Smart Factory, UI e simuladores compartilham o estado operacional inicial: 15 máquinas começam em funcionamento (`isRunning=true`), e `ROB-003` começa parado (`isRunning=false`, modo `off`, velocidade zero). Todas as 16 enviam telemetria, sempre com estado booleano, sem `null`. O primeiro lote preserva os valores iniciais antes da evolução física; alertas de temperatura/vibração não significam equipamento parado. Para uma demonstração limpa, reinicie proxy e simulador e recarregue a SPA. Controles já existentes no proxy são respeitados.

## Smart Farm: campo, rebanho e instalações

A **Smart Farm** monitora **16 ativos**: seis equipamentos de campo (tratores, colheitadeira, pulverizador, pivô e caminhão), quatro lotes de bovinos/ovinos e seis instalações (celeiro, dois silos e três áreas de suinocultura). A cena organiza talhões, garagem, armazenagem, pastagens e instalações; veículos percorrem circuitos próprios com distância de segurança.

Os painéis e KPIs são específicos por família: máquinas de campo mostram temperatura, velocidade e combustível; rebanhos, temperatura corporal, atividade e animais fora da cerca; instalações, temperatura, umidade, amônia ou nível. A disponibilidade, combustível médio, animais monitorados e instalações em alerta só usam leituras válidas. Comandos também variam por família: por exemplo, localização/contenção para rebanhos e ventilação para instalações.

Os valores e alertas são demonstrativos. A simulação de rotas e sensores não é rastreamento GPS nem orientação veterinária ou de operação agrícola real. A Smart Farm usa os mesmos modos opcionais de telemetria Fabric e assistente Foundry dos demais cenários.

## Smart Pharma: da matéria-prima ao consumidor

Selecione **Smart Pharma** em **Simulação**. A fábrica agrupa cinco edifícios em sequência linear: recebimento de matéria-prima (`PHA-REC-001`), formulação/produção (`PHA-PRD-001`), controle de qualidade (`PHA-QUA-001`), embalagem/serialização (`PHA-EMB-001`) e armazém refrigerado (`PHA-ARM-001`). A **Smart City** ocupa uma área separada com cinco casas, ruas e duas farmácias (`PHA-FAR-001` e `PHA-FAR-002`), com fachadas envidraçadas e sinalização própria. Um centro de distribuição (`PHA-DIS-001`) e três caminhões refrigerados (`PHA-TRK-001` a `PHA-TRK-003`) ligam as áreas, totalizando **11 ativos**. Casas e carros são elementos visuais, não ativos monitorados.

A fábrica apresenta estruturas industriais abertas para visualizar os equipamentos; o centro de distribuição mostra áreas de armazenagem e doca. O mapa organiza o fluxo da esquerda para a direita em três áreas: fábrica, distribuição e cidade. Números e setas identificam as etapas 1 a 7; a faixa **do lote ao paciente** permite selecionar cada etapa. A câmera mantém a orientação inicial, com órbita e zoom manuais. As casas ficam em lotes separados das farmácias e docas. Os três carros da cidade reutilizam o modelo local da Smart Energy, variam a velocidade e escolhem aleatoriamente o caminho no entroncamento, com verificações de distância em relação aos demais veículos. Os caminhões usam o modelo de entrega com uma unidade de refrigeração ilustrativa. As fontes e licenças estão nas [atribuições dos modelos](app/public/assets/energy/ATTRIBUTIONS.md). Rótulos detalhados e leituras aparecem somente enquanto o ponteiro está sobre um ativo; nomes das áreas e números das etapas permanecem visíveis. No simulador, os 11 ativos começam conectados e enviam telemetria. `PHA-TRK-001` e `PHA-TRK-002` começam em movimento e alternam entre o armazém e o centro ao circular vazios enquanto aguardam lotes; `PHA-TRK-003` permanece conectado e estacionado com ritmo zero. **Iniciar etapa** ou **Retomar etapa** inicia seu deslocamento após a chegada da telemetria, sem criar cargas fictícias. Pausa, parada e perda de comunicação interrompem o movimento. No Fabric, prevalece o estado recebido para os caminhões, sem movimento simulado pelo navegador.

A telemetria Pharma inclui `status` (`online`, `alert` ou `offline`), calculado pelas mesmas regras da interface, e `isRunning` separadamente: uma etapa aguardando lote ou um caminhão estacionado pode estar `online` com `isRunning=false`. Alertas de qualidade e temperatura continuam aparecendo como `alert`. A ausência de eventos é detectada pelo horário da última leitura, não pelo último `status` recebido. Para guardar o novo campo no Eventhouse, adicione `status:string` e mapeie `$.status` conforme o [setup](docs/setup-fabric-foundry.md#colunas-adicionais-para-smart-farm-smart-energy-smart-mining-e-smart-pharma); eventos históricos não são alterados.

Na barra lateral da Smart Pharma, **Fonte da telemetria** permite escolher **Fabric RTI** ou **Simulação local (sem Fabric)**. A escolha fica salva neste navegador e vale apenas para Pharma; sem escolha salva, prevalece `VITE_PHARMA_TELEMETRY_MODE` (`mock` ou `fabric`), quando definido, ou `VITE_TELEMETRY_MODE`. A troca reinicia o estado local da demonstração, não altera dados históricos no Fabric e não muda a configuração do agente. O modo local identifica explicitamente a telemetria simulada e permite operar sem o proxy ou serviços externos. Não há fallback automático: uma falha real no Fabric continua aparecendo como erro/offline até a recuperação ou a escolha explícita do modo local. `ENOTFOUND` indica que o endereço em `FABRIC_PHARMA_KUSTO_URI` não resolveu no DNS; confira o Query URI do Eventhouse e o acesso à rede. Uma resposta `CapacityNotActive` na API do Fabric indica capacidade indisponível: confirme o estado da capacidade antes de trocar o endereço ou reativá-la, pois a reativação pode retomar a cobrança. Comandos como **Retomar etapa** não corrigem DNS ou conectividade do Fabric.

Para reduzir o consumo, a renderização da Smart Pharma é limitada a 30 FPS e fica suspensa enquanto a aba está oculta. A telemetria não é interrompida pela cena, embora o navegador possa limitar timers em segundo plano; ao retornar, os caminhões são reconciliados com as leituras mais recentes.

A cada 12 segundos de atividade do recebimento entra um lote de **100 unidades equivalentes**. O identificador `LOT-00001`, por exemplo, acompanha o lote até a entrega; o painel mostra o primeiro lote em atendimento em cada ativo, não um histórico regulatório. Cada instalação tem capacidade para 300 unidades e cada caminhão para 100. Os caminhões em operação fazem os dois trechos, **armazém → centro → farmácia**, com escolha em rodízio entre destinos disponíveis e reserva de capacidade no destino. A carga espera quando não há capacidade ou o ativo necessário está indisponível. Os caminhões em operação deslocam-se continuamente até a origem e o destino; carga e descarga são visíveis nas docas.

O controle de qualidade bloqueia **cada quinto lote** com um resultado fictício. No armazém, nos três caminhões, no centro e nas duas farmácias, temperaturas fora de **2 a 8 °C** bloqueiam os lotes presentes; lotes novos não entram enquanto a temperatura estiver fora da faixa. Bloqueios são permanentes nesta execução: comandos, calibração e mudanças dos limites de alerta não liberam unidades. Desligar a refrigeração faz a temperatura convergir para 22 °C. Pausar mantém o alvo térmico, mas interrompe o fluxo; caminhões pausados preservam posição e carga, salvo bloqueio por excursão térmica.

Os KPIs mostram recebimento, unidades em processo, lotes aprovados na simulação, bloqueios e entregas agregadas das duas farmácias. A conservação é verificável: **recebidas = em processo, incluindo cargas + bloqueadas + entregues**. A simulação começa vazia; a primeira entrega ocorre após percorrer os setores e o centro de distribuição. Trocar de cenário reinicia o mock; no modo Fabric, o simulador Node continua independente da navegação.

O cenário usa o mesmo controle HTTP, telemetria e assistente dos demais. Para publicar telemetria pelo simulador Node: `$env:SCENARIO='pharma'; npm run simulate:devices`. Após atualizar o código, reinicie o proxy e o simulador Pharma para reconhecer e publicar os 11 ativos; evite executar simultaneamente simuladores antigos e novos para os mesmos IDs. `PHA-TRK-004`, `PHA-TRK-005`, `PHA-DIS-002` e `PHA-FAR-003` não pertencem mais ao catálogo: suas leituras são ignoradas e comandos são rejeitados, mas os dados históricos no Fabric não são apagados. Ativos sem leituras atuais aparecem indisponíveis. Consulte o [setup Fabric/Foundry](docs/setup-fabric-foundry.md) para os campos adicionais.

**Somente demonstração:** ritmos, testes de qualidade, unidades e faixa térmica são fictícios. Não representa formulação farmacêutica, validação sanitária, BPF/GMP, serialização regulatória, autenticação ou liberação real de medicamentos. Não use para decisões sobre medicamentos reais.

## Smart Mining: da extração à entrega

Os **21 ativos** simulam a cadeia cava → quatro caminhões de mina → três britagens → correia → beneficiamento → seis silos → caminhão de entrega → três centros de distribuição, com um terminal de expedição que autoriza e agrega as entregas. A ampliação preserva os oito IDs originais e acrescenta três caminhões, dois britadores, cinco silos e três centros.

O beneficiamento converte 90% da massa recebida em produto e registra 10% como rejeitos. Os três britadores compartilham a capacidade disponível da correia, e a usina distribui produto entre silos disponíveis. A expedição alterna silos e centros de distribuição em rodízio, retornando ao próximo silo por vias contínuas, sem saltos de posição. Pausar uma ramificação não para as demais. Estoques e cargas têm capacidades finitas; entregas só aumentam na descarga. O contador do terminal soma os recebimentos dos centros e **não representa um segundo estoque** no balanço de massa.

A demonstração começa com **31 t já extraídas** distribuídas entre cava (12 t), britador (6 t), correia (3 t), alimentação da usina (2 t) e silo (8 t), para que o fluxo e a primeira entrega sejam visíveis rapidamente. Minério em estoque, cargas nos veículos, produto entregue e rejeitos somam a massa extraída. Em mock, a simulação e seus contadores são reiniciados ao trocar de cenário; em Fabric, o estado recebido do Eventhouse prevalece e o simulador Node continua independente da navegação.

Pausar, desligar ou desconectar uma etapa impede sua atividade; as demais podem continuar usando estoques já disponíveis. Os caminhões mantêm posição e carga quando pausados e retomam a rota posteriormente. Com carga parcial e sem novo material por cinco segundos, o caminhão parte para não reter o estoque restante. Ritmos, capacidades, temperaturas e conversão são ilustrativos; não representam uma mina real nem controlam equipamentos.

Para manter pontos de investigação visíveis, o simulador inclui desvios demonstrativos persistentes: vibração no `MIN-BRI-002`, temperatura no `MIN-SIL-005` e no `MIN-DIS-002`. Os alertas vêm das leituras comparadas aos limites, não de um status fixo; a vibração inicial do britador 1 pode normalizar. No modo Fabric, os alertas dependem da telemetria recebida; não são injetados pelo navegador.

## Smart Energy: cidade e geração integradas

São **40 ativos monitorados**: 10 painéis + 2 inversores, 3 turbinas + 1 comporta, 5 carregadores, 10 casas, 4 carros + 2 caminhões e 3 circuitos. Os 14 IDs originais foram preservados; `SOL-ARR-*` agora representa painéis individuais da demonstração.

- A água da represa percorre os condutos, movimenta as turbinas e sai pelo canal. A comporta do vertedouro regula a descarga excedente, separada da vazão das turbinas.
- Solar e hidrelétrica alimentam a mesma rede. Há perdas ilustrativas de 2%; em déficit, casas e recarga recebem a mesma proporção da demanda. Circuitos e casas sem energia continuam com monitoramento comunicando.
- Isolar `RED-SOL-001` ou `RED-HID-001` remove a fonte correspondente; isolar `RED-CID-001` interrompe o fornecimento urbano.
- Veículos procuram postos compatíveis com bateria **≤20%**, reservam uma vaga e retornam às ruas com **80%**. Sem fornecimento não há recarga; veículos parados ou sem bateria não circulam. As capacidades e consumos são demonstrativos.
- KPIs mostram potência em kW, demanda e déficit. Casas acumulam energia em kWh. A cena interpola posições recebidas, sem manter outra simulação física.
- O mesmo motor integrado roda no mock do navegador, no loopback e no simulador que publica no Fabric. Em Fabric real, dados ausentes não são simulados nem exibidos como zero.

Modelos GLB e texturas PBR são servidos localmente, sem CDN. A Smart Factory reutiliza a textura de concreto; a Smart Farm inclui solo e modelos ilustrativos de bovinos e ovinos; a Smart Mining reutiliza as texturas locais de solo, grama e concreto. As origens, licenças e adaptações estão nos arquivos de atribuição da [Smart Energy](app/public/assets/energy/ATTRIBUTIONS.md) e da [Smart Farm](app/public/assets/farm/ATTRIBUTIONS.md). Se um recurso visual falhar, a telemetria continua ativa e a cena oferece uma nova tentativa sem reiniciar a simulação. O pacote visual da Smart Energy tem aproximadamente 27 MB; o primeiro carregamento pode ser maior que nos outros cenários.

**Limite:** não há armazenamento estacionário, rede externa, cálculo de fluxo de potência AC, proteção elétrica ou modelagem hidráulica de engenharia. Esta demonstração não deve operar equipamentos reais.

## Modos de execução

| Configuração | Comportamento |
|---|---|
| `VITE_TELEMETRY_MODE=mock` | Simulação local no navegador; padrão. |
| `VITE_TELEMETRY_MODE=fabric` | Recebe telemetria do proxy por Server-Sent Events (SSE), consultada no Eventhouse. |
| `VITE_AGENT_MODE=mock` | Assistente local com base de conhecimento e contexto da planta; padrão. |
| `VITE_AGENT_MODE=foundry` | Usa o agente Microsoft Foundry através do proxy; o estado da planta é anexado à pergunta. |
| `FABRIC_LOOPBACK=true` | Emula a API de telemetria, parâmetros e comandos em memória para testar o adaptador `fabric` sem Fabric. |

`npm run dev` inicia apenas o Vite. Para os modos `fabric` e `foundry`, inicie também o proxy com `npm run dev:all` ou `npm run server`. Os modos se aplicam aos cinco cenários, inclusive ao alternar entre eles. Por exemplo, é possível usar Fabric com assistente mock, ou telemetria mock com Foundry.

## Configuração

O passo a passo curto do Eventstream, do Eventhouse e do agente Foundry, com o `.env` mínimo de cada um, está em [docs/setup-fabric-foundry.md](docs/setup-fabric-foundry.md).

Copie `.env.example` para `.env` e preencha somente as configurações dos serviços que pretende usar. O arquivo `.env` não deve ser versionado. O Vite carrega as variáveis de front-end a partir da raiz do projeto; credenciais do Fabric e Foundry são usadas apenas pelo proxy.

| Variável | Finalidade |
|---|---|
| `VITE_TELEMETRY_MODE` | `mock` ou `fabric`. |
| `VITE_DEFAULT_SCENARIO` | Cenário inicial sem seleção válida salva: `factory` (padrão), `farm`, `energy`, `mining` ou `pharma`. |
| `VITE_AGENT_MODE` | `mock` ou `foundry`. |
| `VITE_AGENT_DEBUG` | Força `true`/`false` para logs do agente no console do navegador; por padrão, os logs ficam ativos em desenvolvimento. |
| `VITE_API_BASE` | Prefixo opcional da API; normalmente vazio, pois o Vite encaminha `/api` ao proxy. |
| `API_PORT` | Porta do proxy Express; padrão `8787`. |
| `API_HOST` | Endereço de escuta do proxy; use `127.0.0.1` para restringir o acesso local. Se vazio ou ausente, o Node escuta em todas as interfaces. |
| `FABRIC_EVENTSTREAM_CONNECTION_STRING` | Connection string do endpoint Event Hubs do Eventstream; usada somente para publicar telemetria. |
| `FABRIC_EVENTSTREAM_NAME` | Nome do Event Hub, se não estiver incluído na connection string. |
| `FABRIC_KUSTO_URI`, `FABRIC_KUSTO_DATABASE` | URI de consulta e banco KQL do Eventhouse. |
| `FABRIC_KUSTO_SCOPE` | Escopo Entra ID do Eventhouse; padrão `https://kusto.kusto.windows.net/.default`. |
| `FABRIC_KUSTO_TENANT_ID` | Tenant opcional para autenticar as consultas ao Eventhouse; vazio usa o tenant padrão da credencial. Não altera a autenticação do Foundry. |
| `FABRIC_TELEMETRY_TABLE` | Tabela KQL de telemetria; padrão `MachineTelemetry`. |
| `FABRIC_{FACTORY\|FARM\|ENERGY\|MINING\|PHARMA}_*` | Overrides opcionais de Eventstream e Eventhouse por cenário; campos e regras abaixo. |
| `FABRIC_POLL_MS`, `FABRIC_STALE_SEC` | Intervalo de consulta e limite de telemetria considerada desatualizada. |
| `FABRIC_LOOPBACK` | `true` ativa a emulação em memória do proxy, quando o Eventhouse não está configurado. |
| `DEVICE_INTERVAL_MS` | Intervalo do simulador de dispositivos; padrão `2000` ms. |
| `DEVICE_CONTROL_URL` | URL base do proxy consultado pelo simulador; padrão `http://localhost:<API_PORT>`. |
| `SCENARIO` | Cenário simulado por `npm run simulate:devices`: `factory` (padrão), `farm`, `energy`, `mining` ou `pharma`. |
| `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME` | Endpoint do projeto Foundry e nome do agente. |
| `FOUNDRY_{FACTORY\|FARM\|ENERGY\|MINING\|PHARMA}_AGENT_NAME` | Nome opcional do agente por cenário; sem ele, usa o agente compartilhado. |
| `FOUNDRY_AGENT_ID` | Compatibilidade com o Agent Service clássico; IDs `asst_...` usam o endpoint legado quando não há nome específico ou compartilhado. |
| `FOUNDRY_API_VERSION`, `FOUNDRY_SCOPE`, `FOUNDRY_TIMEOUT_MS` | Versão da API (`2025-11-15-preview` por padrão para hosted agents), escopo Entra ID e timeout. |
| `FOUNDRY_DEBUG` | `true` registra mensagens, payload e respostas do agente no console do proxy. Pode expor conteúdo de conversas nos logs. |

O proxy autentica no Fabric e no Foundry com `DefaultAzureCredential` (por exemplo, `az login` durante desenvolvimento ou managed identity em hospedagem). Não coloque credenciais em variáveis `VITE_*`, pois elas podem ser incluídas no bundle do navegador. O proxy não possui autenticação própria; mantenha `API_HOST=127.0.0.1` em execuções locais e não o exponha à rede sem proteção adicional.

Para iniciar a UI em Mining sem uma escolha anterior salva, configure `VITE_DEFAULT_SCENARIO=mining` e reinicie o Vite ou gere novamente o build. Uma seleção válida em `localStorage` tem precedência e continua sendo preservada ao trocar de cenário; selecione Mining na UI ou remova a chave `iot-scenario` no armazenamento do navegador para usar o novo padrão. Valor ausente ou inválido usa `factory`; valores inválidos geram um aviso no console. Essa variável é independente de `SCENARIO`, que seleciona somente o simulador Node.

O proxy atende os cinco cenários com destinos compartilhados ou específicos: as rotas `/api/telemetry/stream`, `/api/params`, `/api/devices/control`, `/api/commands` e `/api/health` aceitam `scenario` (query string ou corpo da requisição, conforme o caso), com `factory` como padrão quando omitido. Um cenário explícito inválido é rejeitado. A SPA envia o cenário ativo automaticamente. Os catálogos em [server/catalogs.js](server/catalogs.js) isolam controles e telemetria pelo conjunto de IDs conhecidos.

### Destinos e agentes por cenário

Para cada prefixo `FABRIC_FACTORY`, `FABRIC_FARM`, `FABRIC_ENERGY`, `FABRIC_MINING` ou `FABRIC_PHARMA`, os sufixos disponíveis são `_EVENTSTREAM_CONNECTION_STRING`, `_EVENTSTREAM_NAME`, `_KUSTO_URI`, `_KUSTO_DATABASE`, `_TELEMETRY_TABLE` e `_KUSTO_TENANT_ID`. Se todos estiverem vazios ou ausentes, o cenário usa as variáveis `FABRIC_*` compartilhadas, como antes. Se **qualquer um** tiver valor, nenhum campo de destino ou tenant é herdado do compartilhado; somente `FABRIC_KUSTO_SCOPE`, `FABRIC_POLL_MS` e `FABRIC_STALE_SEC` continuam comuns.

A publicação específica precisa de connection string e, quando ela não contém `EntityPath`, do nome do Event Hub. A consulta específica precisa de URI, banco **e tabela**; tenant específico é opcional e, quando omitido, usa o tenant padrão da credencial, não o tenant compartilhado. Publicação e consulta são verificadas separadamente: uma configuração parcial deixa a operação incompleta não configurada, sem misturar destinos. Mesmo com `FABRIC_LOOPBACK=true`, um override parcial de consulta retorna erro em vez de emular ou consultar o destino compartilhado.

Exemplo **ilustrativo**, com valores a obter no próprio ambiente privado; não cria nem conecta recursos:

```env
FABRIC_FARM_EVENTSTREAM_CONNECTION_STRING=<connection-string-do-eventstream-farm>
FABRIC_FARM_EVENTSTREAM_NAME=<nome-do-event-hub-se-necessario>
FABRIC_FARM_KUSTO_URI=<query-uri-do-eventhouse-farm>
FABRIC_FARM_KUSTO_DATABASE=<banco-farm>
FABRIC_FARM_TELEMETRY_TABLE=<tabela-farm>
FABRIC_FARM_KUSTO_TENANT_ID=
FOUNDRY_FARM_AGENT_NAME=<nome-do-agente-farm>
```

O Eventstream escolhido deve estar configurado para ingerir na tabela consultada; as variáveis não criam nem verificam esse encaminhamento. `GET /api/health?scenario=farm` mostra os indicadores do cenário solicitado e de todos os cenários em `scenarios`, sem expor credenciais. Esses indicadores verificam configuração, não conectividade, permissões ou ingestão. A consulta de telemetria/SSE e o simulador usam o destino do mesmo cenário.

O proxy escolhe `FOUNDRY_<CENARIO>_AGENT_NAME` pelo `context.scenario` enviado pela aplicação, ou recorre a `FOUNDRY_AGENT_NAME` e depois a `FOUNDRY_AGENT_ID`. Uma troca de cenário inicia outra conversa, mesmo quando o agente é compartilhado; IDs de conversas específicas não reconhecidos após reiniciar o proxy também iniciam uma nova conversa. Isso é isolamento funcional, não autenticação do proxy.

Para publicar um cenário específico pelo PowerShell:

```powershell
$env:SCENARIO='farm' # factory | farm | energy | mining | pharma
npm run simulate:devices
```

Para publicar os cinco simultaneamente, execute um simulador por cenário, em terminais separados. Farm preserva combustível, velocidade, rebanho e clima; Mining preserva vazões, estoques, cargas, rejeitos, entregas e posições dos caminhões; Pharma preserva lotes, bloqueios, estoques e entregas em unidades equivalentes. Adicione as [colunas e os mapeamentos nativos](docs/setup-fabric-foundry.md#colunas-adicionais-para-smart-farm-smart-energy-smart-mining-e-smart-pharma) antes da ingestão. Campos ausentes não são preenchidos com valores simulados; ativos sem leitura recente ficam sem comunicação.

O mesmo agente Foundry pode atender todos os cenários ou cada cenário pode usar seu próprio nome. Cada pergunta inclui o ID do cenário, a planta, os alertas, o ativo selecionado e as leituras disponíveis dos ativos. Configure as instruções e fontes de cada agente para os domínios atendidos; um agente ou Data Agent com dados somente de fábrica não ganha conhecimento dos outros domínios automaticamente. Veja como [conectar um Data Agent Fabric específico a cada agente Foundry](docs/setup-fabric-foundry.md#conectar-um-fabric-data-agent-por-cenário).

## Fabric Real-Time Intelligence

Para configurar a ingestão, localizar a connection string do Eventstream e a Query URI do Eventhouse, e verificar a chegada dos dados, veja [Ingestão em tempo real: passo a passo](docs/setup-fabric-foundry.md#configurar-e-obter-a-ingestão-em-tempo-real-real-time-intelligence).

### Eventhouse

Use o `machineId` dos catálogos do cenário ativo em `app/src/usecases/<cenário>/catalog.js` para relacionar a telemetria de `MachineTelemetry` aos ativos e fornecer contexto ao Data Agent. Os catálogos são dados estáticos de demonstração, não registros de leituras ou estados atuais.

Crie um banco KQL e a tabela padrão da integração, ou configure outra tabela para cada cenário:

```kusto
.create table MachineTelemetry (eventType:string, machineId:string, ts:datetime, temp:real, vib:real, usage:real, mode:string, speed:real, isRunning:bool)
```

`usage` e `speed` devem ser `real` para preservar valores fracionários. Se uma tabela existente usar `int`, siga a [migração sem perda de dados](docs/setup-fabric-foundry.md#colunas-adicionais-para-smart-farm-smart-energy-smart-mining-e-smart-pharma); alterar diretamente o tipo invalida os valores históricos.

Para uma tabela existente, adicione a coluna sem apagar dados:

```kusto
.alter-merge table MachineTelemetry (isRunning:bool)
```

Atualize também o schema/mapeamento do Eventstream para preservar `isRunning` e mapear `$.isRunning` como booleano; depois publique. Registros antigos permanecem sem essa informação, não equivalem a equipamento parado. O [guia de setup](docs/setup-fabric-foundry.md#equipamento-parado-ou-em-funcionamento) descreve o campo e as consultas de conferência.

Configure `FABRIC_KUSTO_URI` e `FABRIC_KUSTO_DATABASE`. Conceda à identidade usada pelo proxy permissão para consultar o banco.

### Eventstream e simulador

1. Crie um Eventstream com uma fonte **Custom endpoint** usando o protocolo Event Hubs e configure `FABRIC_EVENTSTREAM_CONNECTION_STRING` (e, se necessário, `FABRIC_EVENTSTREAM_NAME`).
2. Configure um único destino no Eventhouse: `telemetry` para `MachineTelemetry`.
3. Conceda à identidade de desenvolvimento permissão para enviar eventos ao Eventstream e consultar o Eventhouse.
4. Defina `VITE_TELEMETRY_MODE=fabric` e inicie `npm run dev:all`.
5. Execute `npm run simulate:devices` em outro terminal para enviar telemetria dos 16 dispositivos, incluindo o `ROB-003` parado. O simulador busca o controle desejado no proxy HTTP, aplica comandos e ajustes e publica o estado resultante (`isRunning`, `mode`, `speed`, temperatura, vibração e utilização).

O controle segue `UI → proxy HTTP → simulador`; a telemetria segue `simulador → Eventstream → MachineTelemetry → proxy → UI`. O ACK da API confirma controle aceito em memória, não execução no dispositivo nem ingestão no Fabric. O estado desejado é volátil: reiniciar o proxy restaura os padrões. Se o proxy estiver indisponível, o simulador registra o erro e continua enviando o último estado conhecido. Esse canal é exclusivo da demonstração local, sem autenticação; equipamentos reais exigem uma integração de controle apropriada.

Configurações antigas: desative/remova no portal os filtros e destinos de parâmetros e comandos e publique o fluxo. As tabelas antigas podem permanecer para preservar o histórico, mas não são mais usadas. A antiga variável de tabela de parâmetros é ignorada. Em `MachineTelemetry`, acrescente `isRunning:bool` conforme descrito acima.

O proxy consulta a última leitura por máquina e a transmite à SPA via SSE. Leituras mais antigas que `FABRIC_STALE_SEC` (15 segundos por padrão), ou máquinas sem leitura, são mostradas como sem comunicação. Ajuste esse limite ao intervalo de envio e à latência de ingestão observada: um limite maior evita falsos alertas, mas também retarda a indicação de perda real de comunicação.

Para testar o caminho do adaptador `fabric` sem recursos Fabric, defina `FABRIC_LOOPBACK=true` e `VITE_TELEMETRY_MODE=fabric`, depois inicie `npm run dev:all`. O loopback emula as operações em memória; não envia dados ao Fabric.

## Microsoft Foundry

1. Crie um agente de prompt em um projeto do Foundry e defina as instruções desejadas.
2. Conceda à identidade do proxy o papel necessário para usar o projeto (por exemplo, **Azure AI User**).
3. Configure `FOUNDRY_PROJECT_ENDPOINT` e `FOUNDRY_AGENT_NAME` no `.env`.
4. Defina `VITE_AGENT_MODE=foundry` e inicie `npm run dev:all`.

A SPA envia a mensagem, um snapshot da planta (contagens, alertas, ativos e máquina selecionada) e o ID da conversa ao proxy. O proxy acrescenta esse contexto à pergunta e chama o Foundry; as credenciais não são expostas ao navegador. Para iniciar uma conversa nova, use o botão **Nova conversa** no assistente. Evite `FOUNDRY_DEBUG=true` fora de ambientes apropriados: esse modo registra o conteúdo das mensagens e das respostas.

## Build, produção e testes

```bash
npm run build
npm run preview
```

O build da SPA é gerado em `dist/`. Para servir a versão buildada com a API, configure o `.env` e execute `npm run server`; o Express serve `dist/` quando a pasta existe. O `npm run preview` do Vite serve apenas o front-end e não inicia a API.

Testes de controle, telemetria, assistente, cenários e recursos visuais (Node 24):

```bash
npm test
```

O script executa os 18 arquivos de teste registrados em `package.json`, cobrindo os cinco cenários. Os testes isolam o Azure; os testes de controle usam um servidor HTTP local em porta temporária.

## Estrutura do projeto

```text
.env.example                 Modelo das variáveis; copie para .env na raiz
docs/
  setup-fabric-foundry.md     Setup do Eventstream, Eventhouse e agente Foundry
  specs/                      Especificações funcional e não funcional (engenharia reversa)
app/
  index.html                  Entrada da SPA (http://localhost:5173)
  public/assets/energy/       Modelos GLB, texturas PBR locais e licenças
  public/assets/farm/         Animais, textura de solo e licenças
  src/main.js                 Lê VITE_TELEMETRY_MODE e VITE_AGENT_MODE
  src/core/                   Motor reativo genérico (store, state) — sem dados de catálogo
  src/domain/                 Regras de status, física da simulação e schema de parâmetros
                               (genéricos; reaproveitados por todos os casos de uso)
  src/usecases/               Um caso de uso por pasta: catálogo de ativos, perfil de UI/KPIs
                               e cena 3D (registry.js registra os cenários disponíveis)
    factory/                  Smart Factory (16 máquinas) — mock ou Fabric/Foundry real
    farm/                     Smart Farm (campo, rebanho, galpões) — mock ou Fabric/Foundry
    energy/                   Catálogo/perfil, layout, simulação integrada, models, environment e scene
    mining/                   Smart Mining: catálogo, layout, simulação e cena — mock ou Fabric/Foundry
    pharma/                   Smart Pharma: catálogo, lotes, cadeia fria, perfil e cena 3D
  src/ui/                     Painéis, modal de parâmetros e assistente (genérico, por perfil)
  src/integration/            Adaptadores telemetry (mock|fabric) e agent (mock|foundry)
server/
  index.js                    API Express em API_PORT (padrão 8787), roteada por cenário
  catalogs.js                 Registro dos catálogos de dispositivos disponíveis no proxy
  fabric.js                   Cliente Eventstream/Eventhouse (FABRIC_*)
  foundry.js                  Cliente Microsoft Foundry (FOUNDRY_*)
  deviceSimulator.js          Simulador de dispositivos para o Eventstream (SCENARIO=<id>)
  deviceControl.js            Controle HTTP local dos dispositivos simulados
tests/
  agent.test.js               Testes do adaptador do assistente
  device-control.test.js      Controle HTTP e aplicação no simulador
  fabric.test.js               Publicação exclusiva de telemetria e consultas
  telemetry-state.test.js     Estado da UI e efeitos dos comandos
  farm.test.js, farm-layout.test.js, side-panels.test.js
  energy.test.js              Catálogo, alertas e roteamento por cenário do Smart Energy
  energy-layout.test.js       Contagens, conectividade e rotas fora dos lotes
  energy-simulation.test.js   Água, energia, controles, bateria, tráfego e recarga
  energy-fabric.test.js       Campos nativos e isolamento no caminho Fabric/SSE
  mining.test.js              Fluxo, conservação de massa, controles, telemetria e assistente
  pharma.test.js              Lotes, conservação, qualidade, cadeia fria, transporte e contexto
  scenario-integrations.test.js Fabric/SSE e contexto Foundry nos cinco cenários
  visual-assets.test.js       Carregamento e descarte dos recursos gráficos
  scene-startup.test.js       Falhas 3D, recuperação e preservação da telemetria
```
