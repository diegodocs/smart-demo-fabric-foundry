# Smart Demo: Fabric and Foundry 

## Central monitoramento 

Explore cinco cenários 3D interativos para monitoramento de equipamentos, instalações e cadeias operacionais. A demonstração roda localmente com dados simulados; Microsoft Fabric Real-Time Intelligence e Microsoft Foundry são opcionais.

> **Somente demonstração:** leituras, dados do operador, alertas, comandos e processos são fictícios. Este projeto não implementa autenticação e não deve ser usado para monitorar ou controlar equipamentos reais nem para tomar decisões operacionais.

## Comece por aqui

**Requisitos:** Node.js 24 ou superior e npm.

1. Abra um terminal na pasta do projeto.
2. Instale as dependências e inicie a aplicação:

   ```bash
   npm install
   npm run dev
   ```

3. Acesse <http://localhost:5173>.

A aplicação inicia em modo de simulação local. Você não precisa de uma conta Azure, arquivo `.env` ou serviços na nuvem para explorar a demonstração.

## Explore a demonstração

- Escolha um cenário no menu **Simulação**.
- Selecione um ativo na lista ou clique nele na cena 3D para ver suas leituras e seu estado.
- Abra o **Assistente IA** para perguntar sobre o ativo selecionado e as condições simuladas.
- Experimente os controles de parâmetros e comandos. Eles só alteram a simulação, não controlam equipamentos reais.

| Cenário | O que você encontrará |
|---|---|
| **Smart Factory** | Máquinas industriais e monitoramento de uma linha de produção |
| **Smart Farm** | Veículos agrícolas, rebanhos e instalações rurais |
| **Smart Energy** | Geração renovável, cidade e veículos elétricos |
| **Smart Mining** | Extração, processamento, armazenagem e entregas |
| **Smart Pharma** | Produção farmacêutica, distribuição e cadeia fria simulada |

## Inicie a API local (opcional)

A aplicação web, sozinha, basta para explorar a simulação local. Para iniciar também a API local usada pelos controles e pelas integrações, execute:

```bash
npm run dev:all
```

No Windows, você também pode iniciar e gerenciar os dois processos em um console separado:

```powershell
.\dev.ps1 start
.\dev.ps1 status
.\dev.ps1 stop
```

Use `.\dev.ps1 restart` para reiniciar. O script salva uma cópia dos logs em `.dev-processes\stdout.log`.

## Conecte os serviços Microsoft (opcional)

Fabric e Foundry não são necessários para usar a demonstração local. Para conectá-los:

1. Copie `.env.example` para `.env` e preencha somente as configurações dos serviços que pretende usar.
2. Siga o [guia de configuração do Fabric e do Foundry](docs/setup-fabric-foundry.md) para configurar permissões e validar a conexão.
3. Inicie a aplicação e a API com `npm run dev:all`.

Por padrão, a aplicação usa telemetria simulada local e um assistente local. Para usar telemetria do Fabric, defina `VITE_TELEMETRY_MODE=fabric`; para usar um agente Foundry, defina `VITE_AGENT_MODE=foundry`. As opções podem ser ativadas independentemente. A telemetria do Fabric também requer um simulador de dispositivos publicando no Eventstream configurado; o guia de setup descreve o fluxo completo.

Mantenha as credenciais no arquivo `.env`, usado pelo servidor. Nunca coloque segredos em variáveis `VITE_*` nem versione o arquivo `.env`.

## Comandos úteis

| Comando | Para que serve |
|---|---|
| `npm run dev` | Inicia a aplicação web com as configurações locais padrão |
| `npm run dev:all` | Inicia a aplicação web e a API local |
| `npm run simulate:devices` | Publica telemetria simulada no Fabric; requer configuração |
| `npm run build` | Gera a versão de produção em `dist/` |
| `npm run preview` | Visualiza localmente a versão gerada por `npm run build` |
| `npm test` | Executa os testes automatizados |

No Windows, `.\dev.ps1 start`, `.\dev.ps1 status`, `.\dev.ps1 stop` e `.\dev.ps1 restart` são alternativas para gerenciar a aplicação e a API.

## Solução de problemas

- **A aplicação não inicia:** confira se o Node.js 24 ou superior está instalado e execute `npm install`.
- **A página não abre:** confirme que o servidor Vite está em execução. O endereço padrão é <http://localhost:5173>.
- **Fabric ou Foundry não conecta:** confira as configurações em `.env`, as permissões da identidade e se a API foi iniciada com `npm run dev:all`. A simulação local não depende desses serviços.
- **Uma porta já está em uso:** encerre o processo que a está usando ou configure outra porta conforme o guia de setup.

## Saiba mais

- [Diagrama interativo de arquitetura](docs/architecture.html) — abra o arquivo no navegador.
- [Configuração do Fabric e do Foundry](docs/setup-fabric-foundry.md)
- [Especificação funcional](docs/specs/functional-spec.md)
- [Especificação não funcional](docs/specs/non-functional-spec.md)
- [Atribuições dos recursos 3D: Energy](app/public/assets/energy/ATTRIBUTIONS.md)
- [Atribuições dos recursos 3D: Farm](app/public/assets/farm/ATTRIBUTIONS.md)
