# Setup do Fabric Eventstream e do agente Foundry

Guia para ligar a SPA ao **Microsoft Fabric Real-Time Intelligence** e ao **Microsoft Foundry**. O `.env` fica na raiz, ao lado de `package.json`, não dentro de `app/`. Credenciais ficam no servidor; nunca em variáveis `VITE_*`, que podem ser expostas ao navegador.

## Arquivos e localização

| Arquivo | Função |
|---|---|
| `.env.example` | Modelo versionado; copie para `.env` sem sobrescrever configurações existentes. |
| `.env` | Configuração local; não versionar. |
| `vite.config.js` | Porta `5173`, `envDir` na raiz e proxy de `/api` para `API_PORT`. |
| `app/index.html` | Entrada da SPA. |
| `app/src/main.js` | Seleciona os modos de telemetria e agente. |
| `app/src/integration/telemetry/` | Adaptadores mock e Fabric; usam `VITE_API_BASE` opcional. |
| `app/src/integration/agent/` | Adaptadores mock e Foundry. |
| `server/index.js` | Proxy: SSE, controle HTTP local e chat; roteia por `scenario` (padrão `factory`). |
| `server/catalogs.js` | Registro dos catálogos de dispositivos disponíveis no proxy, por cenário. |
| `server/deviceControl.js` | Estado desejado em memória para os dispositivos simulados. |
| `server/fabric.js` | Publicação de telemetria e consultas ao Eventhouse. |
| `server/deviceSimulator.js` | Busca controle no proxy, simula os dispositivos e publica telemetria (`SCENARIO=<id>` escolhe o catálogo). |
| `server/foundry.js` | Integração com o agente Foundry. |

## Antes de editar o `.env`

1. Se ainda não existir `.env`, execute `Copy-Item .\.env.example .\.env` no PowerShell.
2. Autentique a identidade de consulta com `az login`, na conta/tenant que tem acesso aos recursos.
3. Após alterar o `.env`, reinicie SPA e proxy com `.\dev.ps1 restart` ou reinicie `npm run dev:all`. Reinicie também o simulador se alterou suas configurações.

Sem Fabric nem Foundry, use `VITE_TELEMETRY_MODE=mock`, `VITE_AGENT_MODE=mock` e `npm run dev`.

> **Múltiplos cenários:** Smart Factory, Smart Farm, Smart Energy, Smart Mining e Smart Pharma podem compartilhar Eventhouse/Eventstream e agente, como na configuração anterior, ou usar destinos e agentes específicos. Cada catálogo em `server/catalogs.js` tem IDs conhecidos e controle próprios; o proxy filtra por esses IDs. Os modos `VITE_TELEMETRY_MODE` e `VITE_AGENT_MODE` se aplicam a todos os cenários e são independentes.

| Cenário | `SCENARIO` | Ativos |
|---|---|---|
| Smart Factory | `factory` | 16 máquinas |
| Smart Farm | `farm` | 16 ativos de campo, rebanho e instalações |
| Smart Energy | `energy` | 40 ativos de geração, distribuição e mobilidade |
| Smart Mining | `mining` | 21 ativos: 4 caminhões de mina, 3 britagens, 6 silos e 3 centros, além das etapas compartilhadas |
| Smart Pharma | `pharma` | 11 ativos: cinco setores da fábrica, três caminhões, um centro de distribuição e duas farmácias |

A SPA envia o cenário ativo automaticamente. Para publicar Farm, por exemplo, use `$env:SCENARIO='farm'; npm run simulate:devices` no PowerShell. Troque o valor por qualquer ID da tabela; para ingestão simultânea, mantenha um simulador por cenário em terminais separados. Trocar a seleção na SPA não inicia nem reinicia os simuladores Node.

Para que a UI inicie em Mining quando não houver seleção válida salva, configure `VITE_DEFAULT_SCENARIO=mining` e reinicie o Vite ou gere novamente o build. Os valores aceitos são os IDs da tabela; vazio ou inválido usa `factory`, e um valor inválido gera um aviso no console. Uma seleção válida salva em `localStorage` (`iot-scenario`) tem precedência: escolha Mining na UI ou remova essa chave do navegador para aplicar o padrão configurado. `SCENARIO` afeta somente o simulador, não a seleção inicial da UI.

### Configuração isolada por cenário

Os campos abaixo são opcionais para cada prefixo `FABRIC_FACTORY`, `FABRIC_FARM`, `FABRIC_ENERGY`, `FABRIC_MINING` e `FABRIC_PHARMA`:

| Sufixo | Efeito |
|---|---|
| `_EVENTSTREAM_CONNECTION_STRING` | Connection string SAS do Eventstream específico. |
| `_EVENTSTREAM_NAME` | Nome do Event Hub específico; necessário quando a connection string não contém `EntityPath`. |
| `_KUSTO_URI`, `_KUSTO_DATABASE`, `_TELEMETRY_TABLE` | Query URI, banco e tabela específicos; os três são necessários para consultar esse cenário. |
| `_KUSTO_TENANT_ID` | Tenant específico opcional. Se omitido, usa o padrão da credencial, não `FABRIC_KUSTO_TENANT_ID`. |

Todos vazios/ausentes preservam o destino `FABRIC_*` compartilhado, inclusive o tenant e o padrão `MachineTelemetry`. Qualquer valor específico não vazio desativa **toda** a herança dos campos de destino para aquele cenário: connection string, nome, URI, banco, tabela e tenant não são combinados com os compartilhados. Publicação e consulta são verificadas separadamente; complete os campos da operação usada. As configurações comuns de escopo, polling e idade (`FABRIC_KUSTO_SCOPE`, `FABRIC_POLL_MS`, `FABRIC_STALE_SEC`) continuam herdadas. Um override parcial de consulta aparece como erro em SSE/health, inclusive com `FABRIC_LOOPBACK=true`; o simulador também recusa uma configuração de publicação incompleta.

Exemplo **somente de formato**, a ser preenchido com valores do próprio ambiente:

```env
FABRIC_FARM_EVENTSTREAM_CONNECTION_STRING=<connection-string-do-eventstream-farm>
FABRIC_FARM_EVENTSTREAM_NAME=<nome-do-event-hub-se-necessario>
FABRIC_FARM_KUSTO_URI=<query-uri-do-eventhouse-farm>
FABRIC_FARM_KUSTO_DATABASE=<banco-farm>
FABRIC_FARM_TELEMETRY_TABLE=<tabela-farm>
FABRIC_FARM_KUSTO_TENANT_ID=
FOUNDRY_FARM_AGENT_NAME=<nome-do-agente-farm>
```

Uma connection string com `EntityPath` dispensa o nome. As variáveis não criam recursos nem conectam Eventstream e Eventhouse: confirme separadamente que o stream escolhido ingere na tabela configurada e que a identidade de consulta tem acesso. Cada simulador usa o destino do seu `SCENARIO`; o proxy consulta o destino do cenário solicitado. `GET /api/health?scenario=farm` mostra os indicadores do cenário selecionado e, em `scenarios`, de todos os demais, sem retornar credenciais. Esses indicadores verificam configuração, não conectividade, permissões ou ingestão. O parâmetro omitido usa `factory`; valores explícitos inválidos são rejeitados.

Na implantação isolada, cada Eventstream pode usar um destino **Direct ingestion** para a tabela do seu próprio banco, com um mapeamento JSON de ingestão que cubra as colunas da tabela. A configuração processada com filtros descrita adiante é uma alternativa; não direcione os dois caminhos para a mesma tabela simultaneamente, para evitar duplicação.

## Fabric Eventstream + Eventhouse

O Fabric recebe **somente `eventType=telemetry`**, por padrão na tabela compartilhada `MachineTelemetry`; uma tabela específica pode ser configurada por cenário.

```text
Controle:   UI -> proxy HTTP -> simulador
Telemetria: simulador -> Eventstream -> MachineTelemetry -> proxy SSE -> UI
```

Comandos e parâmetros continuam existindo como ações da UI, mas não como fluxos ou tabelas no Fabric. Ao parar uma empilhadeira, o simulador aplica o controle e publica a telemetria resultante com `mode=off`, `speed=0` e **`isRunning=false`**. Temperatura, vibração e utilização convergem pelo modelo físico da simulação; não zeram necessariamente no mesmo instante.

### Equipamento parado ou em funcionamento

O campo JSON **`isRunning`**, do tipo booleano, registra o estado operacional do dispositivo no instante `ts`:

| Valor | Significado no simulador |
|---|---|
| `true` | O dispositivo está em funcionamento na simulação. |
| `false` | O dispositivo está parado ou ocioso, mesmo que ainda exista temperatura, vibração ou utilização residual. |

O simulador genérico calcula o campo depois de aplicar o controle, considerando modo e velocidade efetiva; os cenários integrados também consideram a atividade do processo. Nenhum deles estima o estado com base em `usage`. Em equipamentos reais, o produtor deve obter esse estado do dispositivo/controlador; um comando enviado não comprova execução física.

Na Smart Pharma, `isRunning` também é `false` quando uma etapa aguarda um lote ou um caminhão está estacionado, mesmo com comunicação normal. Para distinguir esses casos, cada evento Pharma inclui `status`, calculado pelas mesmas regras da interface: `online` para estado normal, `alert` para alertas ou pausa e `offline` para modo desligado. Por exemplo, o `PHA-TRK-003` começa com `status=online` e `isRunning=false`. Os 11 ativos começam online, mas podem entrar em alerta quando houver lotes bloqueados ou temperatura fora dos limites.

Um dispositivo sem comunicação deixa de publicar: o último `status=online` não comprova que ele ainda está online. O proxy usa `ts` e `FABRIC_STALE_SEC` para indicar perda de comunicação; consultas externas devem aplicar o mesmo critério e considerar também IDs sem registros. O mock do navegador e o simulador Node são execuções independentes: para comparar com o Fabric, selecione **Fabric RTI** na Smart Pharma e mantenha um único simulador Pharma atualizado em execução.

**Smart Factory (`SCENARIO=factory`):** UI, proxy e simulador usam o mesmo cadastro inicial e a mesma regra para `isRunning`. As 16 máquinas começam com comunicação e enviam telemetria. Quinze começam em `auto`, velocidade 100 e `isRunning=true`; o `ROB-003` começa parado, em `off`, velocidade zero e `isRunning=false`. Nos demais cenários, o simulador usa o catálogo e os estados iniciais próprios. Não há um terceiro estado nem envio de `null` nesse campo. Uma máquina em alerta de temperatura ou vibração ainda pode estar em funcionamento.

O primeiro lote é uma fotografia dos valores iniciais (`temp`, `vib`, `usage`, `mode`, `speed`, `isRunning`), antes de aplicar ruído ou evolução física. Os ciclos seguintes simulam a evolução normalmente. O mock do navegador e o loopback seguem a mesma regra. Antes de publicar, o simulador consulta o controle do proxy: comandos já aceitos são respeitados, não sobrescritos por um reinício do simulador.

Para começar uma demonstração limpa, reinicie proxy e simulador e recarregue a SPA. Reiniciar apenas a SPA não reinicia o dispositivo nem apaga controles existentes. O estado inicial da UI é uma referência local da demonstração, não uma confirmação de ingestão: ao receber leituras reais do Eventhouse, a UI assume o estado recebido; dados ausentes ou desatualizados continuam sendo tratados como sem comunicação.

O painel do ativo mostra **Operação (telemetria)** somente como **Em funcionamento** ou **Parado**; o assistente recebe o mesmo booleano. Uma alteração na UI é confirmada nesse indicador quando chega a telemetria correspondente. Problemas reais de conexão continuam indicados separadamente e não criam um terceiro valor de `isRunning`: enquanto não há nova leitura, a UI mantém o último estado operacional conhecido. Um equipamento parado continua enviando `isRunning=false`.

Exemplo de evento de uma empilhadeira parada:

```json
{
  "eventType": "telemetry",
  "machineId": "FKL-001",
  "ts": "2026-10-26T19:35:00.000Z",
  "temp": 46.2,
  "vib": 0.18,
  "usage": 12,
  "mode": "off",
  "speed": 0,
  "isRunning": false
}
```

O horário acima é ilustrativo; o simulador envia o horário atual em UTC. Use booleanos JSON `true`/`false`, sem aspas.

Se você optou por armazenar `isRunning` como `string` no Eventhouse, o proxy normaliza a leitura com `tobool(isRunning)` para entregar booleanos à UI. Os valores textuais `"true"`/`"false"` são aceitos. Para simplificar a demo ao consultar registros antigos sem um booleano válido, o proxy calcula o estado por `mode` e `speed`; sem esses dados, considera parado (`false`). Isso é uma convenção da demonstração, não confirmação física de operação. O produtor continua enviando booleanos JSON, e o schema recomendado neste guia permanece `bool`.

| Endpoint local | Função |
|---|---|
| `POST /api/params` | Atualiza os parâmetros desejados no proxy. |
| `POST /api/commands` | Aplica o comando ao estado desejado no proxy. |
| `GET /api/devices/control` | Entrega o estado desejado ao simulador. |
| `GET /api/telemetry/stream` | Entrega à SPA a telemetria consultada no Eventhouse via SSE. |
| `GET /api/health` | Mostra se publicação, consulta e agente estão configurados por cenário, sem segredos. |

O simulador consulta o controle antes de cada envio, sem depender da latência de ingestão do Eventhouse. A confirmação `ack: true, delivery: local-control` significa **controle aceito em memória**, não execução física nem persistência no Fabric. O proxy perde esse estado ao reiniciar. Sem acesso ao proxy, o simulador registra `[control]` e continua com o último estado conhecido; isso não é um mecanismo de segurança industrial.

Esse canal HTTP é para demonstração local, sem autenticação. Use `API_HOST=127.0.0.1` para restringir o proxy à máquina local; sem essa configuração, o Node escuta em todas as interfaces. Para equipamentos reais, substitua-o por uma integração de controle apropriada, com autenticação, confirmação de execução e mecanismos de segurança. A telemetria registra o estado observado, não constitui uma auditoria completa de todas as ações.

### Configuração mínima

```env
VITE_TELEMETRY_MODE=fabric
API_PORT=8787
API_HOST=127.0.0.1
FABRIC_EVENTSTREAM_CONNECTION_STRING="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
FABRIC_EVENTSTREAM_NAME=
FABRIC_KUSTO_URI=https://<query-uri-copiada-do-portal>
FABRIC_KUSTO_DATABASE=IoTFactory
FABRIC_KUSTO_SCOPE=https://kusto.kusto.windows.net/.default
FABRIC_KUSTO_TENANT_ID=
FABRIC_TELEMETRY_TABLE=MachineTelemetry
FABRIC_POLL_MS=3000
FABRIC_STALE_SEC=90
FABRIC_LOOPBACK=false
DEVICE_INTERVAL_MS=2000
DEVICE_CONTROL_URL=http://localhost:8787
```

| Variável | Origem ou efeito |
|---|---|
| `FABRIC_EVENTSTREAM_CONNECTION_STRING` | Fonte Custom endpoint, connection string Event Hubs completa. |
| `FABRIC_EVENTSTREAM_NAME` | Nome do Event Hub; deixe vazio quando a string já contém `EntityPath`. |
| `FABRIC_KUSTO_URI` | **Query URI** do banco KQL; não use Ingestion URI. |
| `FABRIC_KUSTO_DATABASE` | Nome do banco, por exemplo `IoTFactory`. |
| `FABRIC_TELEMETRY_TABLE` | Nome da tabela consultada; não cria nem configura o destino de ingestão. |
| `FABRIC_KUSTO_SCOPE` | Escopo Entra ID; padrão `https://kusto.kusto.windows.net/.default`. |
| `FABRIC_KUSTO_TENANT_ID` | Tenant opcional do Eventhouse; útil quando é diferente do tenant padrão usado pelo Foundry. A identidade ainda precisa de acesso ao banco. |
| `FABRIC_POLL_MS` | Intervalo de consulta do proxy. |
| `FABRIC_STALE_SEC` | Idade máxima da leitura antes de aparecer sem comunicação; padrão do proxy 15 segundos. O exemplo usa 90 segundos para acomodar latência real de ingestão. |
| `DEVICE_INTERVAL_MS` | Pausa entre ciclos do simulador; padrão 2000 ms. Consultas e envios acrescentam tempo ao ciclo. |
| `DEVICE_CONTROL_URL` | URL base do proxy; se omitida, usa `http://localhost:<API_PORT>`, com porta padrão 8787. |

Ajuste `FABRIC_STALE_SEC` ao intervalo de publicação e à latência medida no seu ambiente. Um limite maior evita marcar leituras recentes como desconectadas, mas demora mais para sinalizar uma perda de comunicação real.

### Configurar e obter a ingestão em tempo real (Real-Time Intelligence)

Os nomes dos botões abaixo estão em inglês e podem variar conforme a versão e o idioma do portal.

**1. Criar o Eventhouse, banco e tabela**

No [portal do Fabric](https://app.fabric.microsoft.com), abra um workspace com capacidade Fabric ou Trial e permissão Contributor ou superior. Crie um **Eventhouse** e um banco KQL, por exemplo `IoTFactory`. Abra o banco e, se a tabela ainda não existir, execute:

```kusto
.create table MachineTelemetry (eventType:string, machineId:string, ts:datetime, temp:real, vib:real, usage:real, mode:string, speed:real, isRunning:bool)
```

Se a tabela já existir sem `isRunning`, execute no banco KQL o comando abaixo para adicionar a coluna sem apagar dados:

```kusto
.alter-merge table MachineTelemetry (isRunning:bool)
```

Não recrie a tabela. Registros antigos continuam sem valor nessa coluna; o comando não preenche o histórico. Atualize também o schema/mapeamento do Eventstream conforme a etapa 6 e publique as alterações.

### Colunas adicionais para Smart Farm, Smart Energy, Smart Mining e Smart Pharma

Sem overrides, os quatro cenários além da Factory usam o mesmo Eventstream/tabela compartilhado; com destinos separados, aplique as colunas e mapeamentos necessários a cada destino correspondente. A Smart Farm envia combustível, velocidade, rebanho e clima; a Smart Energy calcula água, geração, consumo, circuitos e mobilidade em conjunto; a Smart Mining calcula o balanço de massa, estoques, caminhões e entregas. A Smart Pharma envia unidades equivalentes, lotes em atendimento, bloqueios e entregas ao consumidor.

`usage` e `speed` precisam ser `real`: vários cenários enviam utilização fracionária e o controle aceita velocidade fracionária. Esses valores podem ser ingeridos como nulos em colunas `int`. Para uma tabela existente com esses campos como `int`, preserve o histórico seguindo [Change column type without data loss](https://learn.microsoft.com/en-us/kusto/management/change-column-type-without-data-loss?view=microsoft-fabric): crie uma nova tabela com o mesmo schema e ordem de colunas, alterando os campos para `real`; copie os dados com `todouble(usage)` e `todouble(speed)`; replique mapeamentos e políticas necessários; e troque os nomes das tabelas. Pause os produtores durante a cópia e confira a nova ingestão antes de remover qualquer cópia. Valores fracionários que já foram ingeridos como nulos não podem ser recuperados da tabela antiga. Não use `.alter column` diretamente, pois o Kusto deixa os valores históricos dessas colunas nulos.

Antes de alterar um fluxo de ingestão de streaming ativo, siga o procedimento de [coordenação de mudanças de schema](https://learn.microsoft.com/kusto/management/data-ingestion/streaming-ingestion-schema-changes?view=microsoft-fabric): suspenda a ingestão e aguarde as requisições pendentes; depois das alterações na tabela e no mapeamento, limpe o cache de schema e só então retome.

Para receber as métricas nativas, adicione as colunas abaixo no banco KQL, sem apagar as existentes:

```kusto
.alter-merge table MachineTelemetry (
  scenario:string,
  fuel:real, humidity:real, nh3:real, activity:real, outside:real, speedKmh:real, headcount:real,
  powerKw:real, demandKw:real, servedKw:real, unservedKw:real, energyKwh:real,
  voltageV:real, loadPct:real, batteryPct:real, flowM3s:real, levelM:real,
  spillM3s:real, supplyPct:real, irradiance:real, routeDistance:real,
  positionX:real, positionZ:real, heading:real, chargeKw:real,
  throughputTph:real, inventoryT:real, payloadT:real, extractedT:real, tailingsT:real, deliveredT:real,
  inventoryUnits:real, receivedUnits:real, deliveredUnits:real, quarantinedUnits:real, processedBatches:real,
  vehicleState:string, chargerId:string, batchId:string, batchStatus:string, status:string
)
```

Se as demais colunas já existem, adicione somente a coluna Pharma sem alterar o histórico:

```kusto
.alter-merge table MachineTelemetry (status:string)
```

Use o nome da tabela configurada para Pharma. No schema/mapeamento JSON do destino do Eventstream (etapa 6), **mantenha os campos existentes** e acrescente cada coluna com o caminho JSON homônimo: `powerKw` → `$.powerKw`, `batteryPct` → `$.batteryPct`, `vehicleState` → `$.vehicleState` e `status` → `$.status`. Números são `real`; `scenario`, `vehicleState`, `chargerId`, `batchId`, `batchStatus` e `status` são `string`. Publique o pipeline atualizado. `status` é enviado pela Smart Pharma; registros antigos e outros cenários podem não ter valor nessa coluna.

Não substitua um mapeamento existente por um que omita os demais campos. Reinicie o proxy e o simulador Pharma atualizado após a mudança.

Para verificar as últimas leituras Pharma, após atualizar o mapeamento:

```kusto
MachineTelemetry
| where ts > ago(10m) and machineId startswith "PHA-"
| summarize arg_max(ts, *) by machineId
| extend statusAtual = case(ts < ago(15s), "offline", isempty(status), "sem status", status)
| project machineId, ts, statusAtual, isRunning
| order by machineId asc
```

Os 15 segundos são o padrão de `FABRIC_STALE_SEC` e devem ser ajustados ao ambiente. IDs sem eventos nos últimos dez minutos não aparecem na consulta; compare-os com o catálogo para detectar ausências. Registros anteriores à alteração continuam sem `status`.

| Campos | Unidade / significado |
|---|---|
| `fuel`, `humidity`, `nh3`, `activity`, `outside`, `headcount` | Combustível %, umidade %, amônia ppm, atividade %, animais fora da cerca e total de animais |
| `powerKw`, `demandKw`, `servedKw`, `unservedKw`, `chargeKw` | kW: geração/transporte, demanda, atendimento, déficit e recarga |
| `energyKwh` | kWh efetivamente gerados/consumidos pelo ativo |
| `voltageV`, `loadPct`, `supplyPct`, `batteryPct` | V, carregamento %, atendimento %, bateria % |
| `flowM3s`, `spillM3s`, `levelM`, `irradiance` | m³/s, m³/s, m, W/m² |
| `positionX`, `positionZ`, `routeDistance`, `heading`, `speedKmh` | Coordenadas/distância da cena, orientação em radianos, km/h |
| `throughputTph` | Vazão da mineração em t/h |
| `inventoryT`, `payloadT`, `extractedT`, `tailingsT`, `deliveredT` | Estoque, carga do caminhão, extração, rejeitos e entregas em toneladas |
| `inventoryUnits`, `receivedUnits`, `deliveredUnits`, `quarantinedUnits` | Unidades equivalentes farmacêuticas em processo, recebidas, entregues e bloqueadas |
| `processedBatches` | Lotes processados na etapa; no controle de qualidade inclui aprovados e bloqueados |
| `batchId`, `batchStatus` | Identificador do primeiro lote em atendimento e estado demonstrativo; não é um histórico regulatório |
| `status` | Estado Pharma (`online`, `alert`, `offline`) no instante da leitura, distinto de `isRunning` |
| `vehicleState`, `chargerId` | `driving`, `seeking`, `approaching`, `charging`, `leaving`, `stopped`, `loading`, `hauling`, `delivering`, `unloading` ou `returning`; ID do posto reservado ou string vazia |

O proxy preserva esses campos na consulta e no SSE e isola o catálogo por IDs conhecidos. Consultas usam `column_ifexists`, portanto uma tabela antiga não quebra o cenário de fábrica; isso **não cria valores** para novos campos. Sem colunas/mapeamento, Farm, Energy, Mining e Pharma exibirão métricas indisponíveis. Todos os cenários iniciam sem comunicação no modo Fabric até receber leituras; dados ausentes ou antigos não são substituídos por dados mock.

Em `fabric` real, Energy e Mining interpolam posições recebidas, e Pharma posiciona seus três caminhões pela telemetria recebida, sem rodar o simulador integrado nem criar métricas faltantes. Reinicie o proxy e o simulador Pharma após atualizar o catálogo para publicar os 11 IDs atuais; evite simuladores antigos e novos simultâneos para os mesmos IDs. Leituras de `PHA-TRK-004`, `PHA-TRK-005`, `PHA-DIS-002` e `PHA-FAR-003` são ignoradas pelo catálogo atual, sem apagar seu histórico no Fabric. Na Farm, as rotas 3D continuam sendo uma visualização ilustrativa da atividade, não rastreamento GPS. Um produtor físico pode enviar os mesmos campos, mas deverá definir suas próprias medições e coordenadas. O simulador e o controle HTTP continuam sendo exclusivamente demonstrativos.

Estas instruções não alteram recursos automaticamente. A suíte cobre o caminho Fabric/SSE com respostas simuladas; uma validação real exige executar a ingestão e consultar o ambiente configurado.

**2. Criar a fonte do Eventstream e copiar a connection string**

1. No workspace, crie ou abra o **Eventstream**.
2. Em **Edit**, selecione **Add source → Custom endpoint**, nomeie a fonte e selecione **Publish**.
3. Em **Live view**, selecione a fonte e abra **Details → Event Hub → SAS Key Authentication**.
4. Copie **Connection string-primary key** ou a secundária inteira para `FABRIC_EVENTSTREAM_CONNECTION_STRING`. Não copie somente a chave, nem as configurações Kafka.
5. Se a string já incluir `EntityPath`, deixe `FABRIC_EVENTSTREAM_NAME` vazio; caso contrário, preencha com **Event hub name**.

Guarde a string SAS somente no `.env` ou em um gerenciador de segredos.

**3. Configurar a consulta do Eventhouse**

1. Abra o **banco KQL** do Eventhouse e copie **Query URI** dos detalhes para `FABRIC_KUSTO_URI`. Não construa a URI a partir do nome do recurso.
2. Preencha `FABRIC_KUSTO_DATABASE` e `FABRIC_TELEMETRY_TABLE`.
3. Execute `az login` com a identidade que tem permissão de consulta, como Viewer no banco ou equivalente. A chave SAS de publicação não concede acesso às consultas.

O projeto chama `/v1/rest/query` usando `DefaultAzureCredential`. A **Ingestion URI** não deve ser colocada em `FABRIC_KUSTO_URI`.

**4. Conferir a entrada de eventos**

1. Inicie `npm run dev:all` em um terminal e `npm run simulate:devices` em outro, na raiz.
2. No Eventstream, abra **Live view**, selecione a fonte ou stream principal e abra **Data preview**.
3. Atualize e confira os campos `eventType`, `machineId`, `ts`, `temp`, `vib`, `usage`, `mode`, `speed` e `isRunning`, na raiz do JSON. Se `isRunning` não aparecer, reinicie o simulador com o código atualizado.
4. Confirme `eventType=telemetry`. Se não houver eventos, confira os logs do simulador, a connection string e se a fonte está publicada antes de investigar o destino.

Após o primeiro lote enviado com sucesso, o simulador imprime uma única amostra JSON com o prefixo `[telemetry] Exemplo de payload aceito pelo endpoint:`. Confira nesse JSON o campo exato `isRunning` (com `R` maiúsculo), booleano e na raiz do evento. Esse log confirma aceitação pelo endpoint de envio, não persistência no Eventhouse.

Se o terminal mostrar o campo, mas a prévia do Fabric não, atualize a amostra/schema da fonte ou do stream e confira se você está olhando a fonte correta. Se o campo aparecer na fonte e desaparecer depois, confira a saída do filtro, operadores **Manage fields** e o mapeamento do destino. Não use `isrunning`: os nomes precisam corresponder exatamente. Reinicie o simulador para obter uma nova amostra no terminal após alterações de código.

**5. Criar um filtro de telemetria**

1. Selecione **Edit**.
2. A partir do stream principal, selecione **Transform events → Filter**, ou use **+ → Filter** no nó.
3. Nomeie o filtro `FilterTelemetry`.
4. Selecione o campo `eventType`, operador de igualdade (**Equals** ou `=`), tipo **String** se solicitado, e valor `telemetry`. No campo de valor da interface, não acrescente aspas.
5. Salve e confira a conexão do stream principal à entrada do filtro.

Se `eventType` não aparecer na seleção, confira o schema do nó anterior e atualize a prévia com eventos reais. O filtro usa o campo do corpo JSON, não apenas propriedades de transporte do Event Hubs.

```text
Custom endpoint -> Stream principal -> FilterTelemetry -> MachineTelemetry
                                      eventType=telemetry
```

O filtro mantém fora da tabela eventuais eventos legados ou de outros produtores. Para este fluxo com filtro, use processamento antes da ingestão na próxima etapa.

**6. Adicionar o destino Eventhouse**

1. Na saída de `FilterTelemetry`, selecione **+ → Eventhouse**.
2. Selecione **Event processing before ingestion**, normalmente já selecionado após um operador.
3. Preencha o nome, por exemplo `ToMachineTelemetry`.
4. Selecione o **Workspace**, o **Eventhouse**, o banco KQL **IoTFactory** e a tabela existente **MachineTelemetry**, nos campos apresentados pelo portal. Confira o banco se houver mais de um.
5. Se aparecer **Activate ingestion**, deixe ativado.
6. Confira schema/mapeamento e selecione **Save**.

| Tipo KQL | Campos |
|---|---|
| `string` | `eventType`, `machineId`, `mode`, `status` (Smart Pharma) |
| `datetime` | `ts` |
| `real` | `temp`, `vib`, `usage`, `speed` |
| `bool` | `isRunning` |

Preserve os nomes e a capitalização. Se usar **Manage fields**, mantenha os nove campos básicos e, para Pharma, `status` e os campos adicionais necessários. Se abrir um assistente de inspeção, escolha **JSON** e confira **Edit columns**. Quando forem solicitados caminhos JSON, use `$.eventType`, `$.machineId`, `$.ts`, `$.temp`, `$.vib`, `$.usage`, `$.mode`, `$.speed`, `$.isRunning` e, para Pharma, `$.status`, não `$.body.temp`.

Em um fluxo já existente, atualize o schema de entrada com uma nova amostra, preserve `isRunning` nos operadores e inclua a coluna booleana no destino. Adicionar a coluna no Eventhouse não atualiza automaticamente o schema ou o mapeamento do Eventstream. Se o campo existir na prévia da fonte mas chegar nulo à tabela, confira cada operador e o mapeamento `$.isRunning`, salve e publique.

O `ts` é enviado como ISO 8601 em UTC e deve chegar como `datetime`. Algumas versões apresentam o schema diretamente, sem assistente separado.

**7. Publicar e ativar**

1. Confira **Test result** ou a prévia do filtro.
2. Resolva erros em **Authoring errors**.
3. Selecione **Publish**: salvar o destino não publica o fluxo.
4. Na **Live view**, confira fonte e destino ativos, sem erros; retome o destino se estiver pausado.
5. Envie novos eventos depois de o fluxo estar ativo. Não conte com reprocessamento automático das amostras anteriores. Para recuperar eventos anteriores, confira retomada por **Custom time** e retenção disponível.

**8. Confirmar persistência e efeito de um comando**

Mantenha os dois processos em execução:

```powershell
# Terminal 1: SPA e proxy
npm run dev:all

# Terminal 2: simulador com controle HTTP e envio real ao Fabric
npm run simulate:devices
```

`npm run dev:all` não inicia o simulador. Em <http://localhost:5173>, selecione uma empilhadeira da demonstração e aplique a parada. A UI reflete a ação; no próximo ciclo com controle disponível o simulador aplica `mode=off`, `speed=0`, `isRunning=false` e publica esse estado como telemetria.

No banco KQL, execute:

```kusto
MachineTelemetry
| where ts > ago(10m)
| extend ingestedAt = ingestion_time()
| project machineId, ts, ingestedAt, isRunning, mode, speed, temp, vib, usage
| top 30 by ts desc
```

Para acompanhar somente a empilhadeira escolhida:

```kusto
MachineTelemetry
| where ts > ago(10m) and machineId == "FKL-001"
| project ts, isRunning, mode, speed, temp, vib, usage
| order by ts desc
| take 20
```

Substitua o ID se necessário. Confira eventos posteriores à ação com `isRunning=false`, `mode=off` e `speed=0`. Ao executar `RESUME`, espere `isRunning=true` nos novos eventos. A chegada à UI pelo Fabric tem o atraso de ingestão mais o polling; não é controle instantâneo pelo Eventhouse.

Para ver o último estado por máquina, sem confundir registros antigos com o estado atual:

```kusto
MachineTelemetry
| where ts > ago(10m)
| summarize arg_max(ts, *) by machineId
| extend isRunning = coalesce(
    tobool(isRunning),
    coalesce(mode !in ("off", "paused") and speed > 0, false))
| extend Operacao = iff(isRunning, "Em funcionamento", "Parado"),
    Comunicacao = iff(ts > ago(15s), "Recente", "Sem leitura recente")
| project machineId, ts, isRunning, Operacao, Comunicacao, mode, speed
| order by machineId asc
```

O limite de 15 segundos corresponde ao padrão de `FABRIC_STALE_SEC`; ajuste a consulta se mudar essa configuração. Máquinas sem eventos nos últimos 10 minutos não aparecem nessa consulta, o que não significa que estejam paradas.

Uma conferência inicial da tabela, inclusive se estiver vazia:

```kusto
MachineTelemetry
| summarize Total=count(), UltimoEvento=max(ts),
    UltimaIngestao=max(ingestion_time()),
    TipoIncorreto=countif(isempty(eventType) or eventType != "telemetry")
```

O total deve aumentar, e `TipoIncorreto` deve ser zero para os novos dados. Essa consulta sem janela é para diagnóstico inicial; em tabelas grandes, filtre por tempo no monitoramento frequente. `ingestion_time()` é aproximado e pode ser nulo se a política de horário de ingestão não estiver habilitada.

**9. Migrar uma configuração anterior com múltiplas tabelas**

1. Atualize e reinicie proxy e simulador. Não misture o simulador antigo com o proxy novo.
2. No editor do Eventstream, desative/remova os filtros e destinos antigos de parâmetros e comandos. Mantenha somente a ramificação de telemetria e publique.
3. Mantenha os dados das tabelas antigas se houver histórico útil; a aplicação não depende delas nem as apaga.
4. Remova do `.env`, se existir, a antiga variável `FABRIC_PARAMS_TABLE`: ela não é mais utilizada.
5. Se a tabela ainda não tiver o estado operacional, execute `.alter-merge table MachineTelemetry (isRunning:bool)` e atualize o schema/mapeamento do Eventstream para incluir `$.isRunning` como booleano. Publique e confirme o campo em novos eventos; não é necessário apagar o histórico.

**10. Diagnosticar falhas**

| Sintoma | O que conferir |
|---|---|
| Não há eventos na fonte | Simulador, logs de envio, connection string e publicação da fonte. |
| A fonte recebe, mas o filtro não produz saída | Campo JSON `eventType`, valor exato `telemetry`, schema e conexão do filtro. |
| O filtro produz saída, mas a tabela está vazia | Workspace/banco/tabela do destino, permissões de escrita, schema, publicação, ativação e erros do destino. |
| A ação muda a UI, mas não a telemetria do simulador | Proxy atualizado, simulador em execução, `DEVICE_CONTROL_URL`, porta e erros `[control]`. |
| Há campos vazios | Nomes, tipos, caminhos JSON e campos preservados após transformações. |
| Há dados no KQL, mas a UI indica perda de comunicação | Horários atuais, tabela/banco do proxy e IDs em `app/src/usecases/factory/catalog.js` (ou no catálogo do cenário ativo, em `app/src/usecases/<cenário>/catalog.js`). |

O proxy consulta os últimos 10 minutos. No cenário Smart Factory, os 16 ativos transmitem desde o início; o `ROB-003` começa parado e `RESUME` ou `CYCLE_START` coloca-o em funcionamento com velocidade 100. Nos demais cenários, consulte os estados iniciais do catálogo correspondente. Ajustar `FABRIC_STALE_SEC` muda a tolerância da UI, mas não acelera a ingestão.

`GET /api/health` com indicadores `true` verifica presença de configuração, não credenciais nem chegada de dados. Status conectado significa conexão com o proxy. O ACK de controle não comprova execução; confirme o estado na telemetria. A aplicação ainda não oferece confirmação individual por `eventId`.

Referências oficiais: [Custom endpoint](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-source-custom-app), [destino Eventhouse](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database) e [editor de processamento](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/process-events-using-event-processor-editor).

### Testar sem Fabric (loopback)

Deixe connection string, `FABRIC_KUSTO_URI` e `FABRIC_KUSTO_DATABASE` vazios e configure:

```env
VITE_TELEMETRY_MODE=fabric
FABRIC_LOOPBACK=true
```

Execute somente `npm run dev:all`. O proxy aplica controle e simula telemetria em memória para os cinco cenários; não precisa do simulador separado e não envia dados ao Fabric. Alterne entre eles para conferir as métricas nativas e os controles isolados.

## Agente Foundry

Crie um agente de prompt no projeto Foundry e anote o **nome** do agente. Conceda à identidade do proxy o papel **Azure AI User** no projeto.

Por padrão o agente é compartilhado pelos cinco cenários. Opcionalmente, `FOUNDRY_FACTORY_AGENT_NAME`, `FOUNDRY_FARM_AGENT_NAME`, `FOUNDRY_ENERGY_AGENT_NAME`, `FOUNDRY_MINING_AGENT_NAME` e `FOUNDRY_PHARMA_AGENT_NAME` selecionam o agente pelo `context.scenario` enviado pela aplicação. Sem nome específico, usa `FOUNDRY_AGENT_NAME` e, na ausência deste, `FOUNDRY_AGENT_ID` clássico. A troca de cenário inicia uma nova conversa mesmo se ambos usam o mesmo agente; IDs específicos desconhecidos após reiniciar o proxy não são reutilizados. Esse isolamento não substitui autenticação.

### Conectar um Fabric Data Agent por cenário

Para manter os cinco domínios independentes, repita estas etapas para cada cenário:

1. No workspace Fabric, crie um Data Agent e selecione apenas o banco KQL e a tabela `MachineTelemetry` daquele cenário, incluindo as colunas necessárias. Configure as instruções para o domínio e publique o agente com uma descrição clara.
2. No projeto Foundry, crie uma conexão para o endpoint MCP do Data Agent publicado e adicione-a a uma toolbox exclusiva do cenário como ferramenta Fabric IQ. A identidade que faz a consulta precisa ter acesso ao Data Agent e aos dados no Fabric.
3. Crie um agente Foundry de prompt para o cenário, conecte somente sua toolbox e configure o nome em `FOUNDRY_<CENARIO>_AGENT_NAME`. Oriente o agente a consultar o Data Agent, informar quando os dados estiverem indisponíveis e não inventar medições.
4. Envie uma pergunta sobre uma leitura existente e confirme que a resposta incluiu uma chamada à ferramenta e os dados da tabela correta. `GET /api/health` não verifica essa conexão.

Se a conexão usar autenticação delegada `UserEntraToken`, defina sua audiência como `https://api.fabric.microsoft.com` (sem `/.default`); sem ela, a resolução da conexão OBO pode falhar. Mantenha permissões e políticas de aprovação compatíveis com o ambiente. O endpoint MCP só fica disponível após a publicação; consulte a [documentação do Data Agent como servidor MCP](https://learn.microsoft.com/en-us/fabric/data-science/data-agent-mcp-server).

Se o Foundry retornar `400` com `tool_user_error` e a mensagem `A user error occurred while executing a tool call.`, confira também se a capacidade Fabric do workspace está ativa. O endpoint MCP do Data Agent pode responder HTTP `200` com um erro JSON-RPC `CapacityNotActive`; esse HTTP não significa que a ferramenta funcionou. Se a capacidade estiver pausada, obtenha autorização para retomá-la no Azure, pois a retomada reinicia a cobrança, e depois valide uma nova pergunta que consulte a ferramenta. `GET /api/health` não detecta capacidade pausada.

O proxy anexa a cada pergunta o cenário (`factory`, `farm`, `energy`, `mining` ou `pharma`), a planta, o resumo de estados, os alertas, o ativo selecionado e as leituras disponíveis dos ativos; leituras indisponíveis aparecem como `null` na lista. Ajuste as instruções e as fontes de conhecimento do agente para os domínios desejados. Para Pharma, explicite que os dados são fictícios, não orientam fabricação e não autorizam liberação de medicamentos. Nenhuma ferramenta de controle de equipamentos é adicionada ao Foundry.

```env
VITE_AGENT_MODE=foundry
FOUNDRY_PROJECT_ENDPOINT=https://<recurso>.services.ai.azure.com/api/projects/<projeto>
FOUNDRY_AGENT_NAME=<nome-do-agente>
FOUNDRY_API_VERSION=2025-11-15-preview
FOUNDRY_SCOPE=https://ai.azure.com/.default
FOUNDRY_DEBUG=false
```

| Variável | Origem ou efeito |
|---|---|
| `FOUNDRY_PROJECT_ENDPOINT` | Endpoint da API do projeto, sem barra no final. |
| `FOUNDRY_AGENT_NAME` | Nome do agente na UI atual, não o ID clássico `asst_...`. |
| `FOUNDRY_<CENARIO>_AGENT_NAME` | Nome opcional por cenário (`FACTORY`, `FARM`, `ENERGY`, `MINING` ou `PHARMA`), com precedência sobre o agente compartilhado. |
| `FOUNDRY_API_VERSION` | Padrão `2025-11-15-preview` para hosted agents; ajuste conforme os detalhes da implantação. |
| `FOUNDRY_SCOPE` | Padrão `https://ai.azure.com/.default`. |
| `FOUNDRY_DEBUG` | `true` registra mensagens, payloads e respostas; pode expor conversas nos logs. |
| `VITE_AGENT_DEBUG` | Log no navegador; vazio mantém ligado em desenvolvimento. |

Para compatibilidade com o agente clássico, use `FOUNDRY_AGENT_ID=asst_...` sem `FOUNDRY_AGENT_NAME`; um nome específico de cenário, se definido, usa a API atual para esse cenário.

## Os dois juntos

Combine os blocos de configuração do Fabric e Foundry no mesmo `.env`, com `VITE_TELEMETRY_MODE=fabric` e `VITE_AGENT_MODE=foundry`. Inicie SPA e proxy com `npm run dev:all` ou `.\dev.ps1 start`, e o simulador em outro terminal com `npm run simulate:devices`, selecionando `SCENARIO` conforme a tabela inicial. Os dois serviços também podem ser usados separadamente, mantendo o outro modo em `mock`.

Abra <http://localhost:5173>. Confira a telemetria em **Sincronização Fabric RTI** e abra **Assistente IoT** para enviar uma mensagem. Falhas do agente aparecem no chat e no console do proxy.
