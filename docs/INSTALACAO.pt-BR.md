[English](INSTALLATION.md) | **Português (Brasil)**

# Instalação e verificação (v0.3.0-dev, repositório privado)

Nada aqui chama modelo pago nem publica pacote. Requisitos: Node >= 20, git, acesso ao repositório privado.

## Matriz de validacao (o que foi realmente executado)

| Verificacao (commit 21bec84, CI run #8; 70 testes unitarios) | Linux x64 | macOS arm64 (macos-26) | macOS Intel x64 (macos-15-intel) | Windows x64 |
|---|---|---|---|---|
| Testes unitarios, Node 22 | OK | OK | OK | OK |
| Testes unitarios, Node 20 | OK | OK (apos uma reexecucao) | nao rodou | OK |
| e2e-native: Claude Code (plugin) e OpenCode 1.19.6 reais vs servidores falsos | OK | OK (apos uma reexecucao) | OK | OK |
| Scripts e2e em bash (mesmos clientes) | OK | NAO validado: runner nao adquirido 2x | ainda nao rodou (etapa adicionada ao CI depois) | nao se aplica (bash) |

Evidencia anterior ao i18n, separada (commit f50909a, run #6): Windows unit 63/63 em Node 20 e 22 e e2e-native OK. Todos os jobs de macOS dessa execucao nao foram adquiridos.
Nao coberto: os clientes foram exercitados so contra servidores de modelo falsos, nunca contra um modelo real pago. A checagem da flag `--model` do processo claude usa `/proc` e roda so no Linux.

Linux nao e validacao de macOS/Windows. Caminhos de dados por plataforma (`~/.config/precost` no Linux/macOS, `%APPDATA%\precost` no Windows) estao implementados e passam nos testes unitarios e no e2e-native nas tres plataformas (ver tabela). Faltam os scripts bash no macOS e qualquer teste com modelo real.

## Instalar por cliente

- **Claude Code (plugin):** `claude --plugin-dir /caminho/opencode-precost` para testar; depois de publicado, `/plugin marketplace add <repo>` e `/plugin install precost`. Hooks em `hooks/hooks.json` (fail-closed). Plugin ainda NAO publicado em nenhum marketplace.
- **Claude Code (manual):** secao 3 abaixo (settings.json).
- **OpenCode:** `npm i opencode-precost @opencode-ai/plugin@1.19.6` no projeto (pacote ainda nao publicado: use `npm pack` do clone) e o arquivo `.opencode/plugins/precost.js` da secao 4 importando `'opencode-precost'`. So a versao 1.19.6 e aceita; o carregamento apenas por `opencode.json` nao foi verificado.
- **Primeiro passo em qualquer cliente:** `precost doctor` e depois a tabela de precos: `precost prices` e `precost update-prices --from URL|ARQUIVO` (nao ha URL padrao; sem fonte ele explica como fornecer uma).

## 1. Obter e testar
```
git clone git@github.com:jarbas-melo/opencode-precost.git && cd opencode-precost
git checkout dev/0.3.0               # ate a release 0.3.0
npm ci && npm test                     # 70 testes
```
Testes reais com software de terceiros contra servidores FALSOS locais (sem gasto, baixam versões fixas via npx): `npm run e2e:claude`, `e2e:claude-tui`, `e2e:claude-failure`, `e2e:opencode`, `e2e:opencode-ledger`, `e2e:opencode-tui`.

## 2. Configuração (`~/.config/precost/config.json`)
```
{"model":"claude-sonnet-5.5","limitUsd":5}
```
Sem `limitUsd`, o hook só informa e nunca bloqueia. `trustConfiguredModel:true` é decisão sua de aceitar um modelo observado/declarado como efetivo (ver README.pt-BR.md, item 3).

## 3. Claude Code (testado 2.1.332)
Copie `adapters/claude-code/settings.example.json` para `~/.claude/settings.json` (ou `.claude/settings.json` do projeto) e troque `/CAMINHO/opencode-precost` pelo caminho do clone. Mantenha `"onFailure":"block"` no UserPromptSubmit: sem ele, crash, timeout ou node ausente deixam o prompt chegar ao modelo.

## 4. OpenCode (testado 1.19.6; outra versão bloqueia)
Em `.opencode/plugins/precost.js` do projeto:
```
import { PrecostPlugin } from '/CAMINHO/opencode-precost/adapters/opencode/index.js';
export const P = async (input) => PrecostPlugin(input, { limitUsd: 5 });
```
Instale `@opencode-ai/plugin@1.19.6` onde o OpenCode resolver o plugin se ele pedir (ver `package.json`).

## 5. Verificar a instalação (sem chamada paga)
```
node bin/precost.js doctor [--project DIR] [--claude-settings ARQUIVO]
```
O `doctor` confere config, preços, hook/plugin nos arquivos, `onFailure`, rastreadores e executa o hook localmente (estado temporário). Sai com código 1 em qualquer FALHA.
**Limite:** o `doctor` não prova que o cliente carregou o hook/plugin na sua sessão. O fail-closed só vale com hook/plugin carregado; se não carregar, prompts grandes passam sem prévia nem gate. Procedimento seguro em sessão real: digite `precost last` primeiro. Com o hook carregado, a resposta vem do precost, sem modelo. Se o modelo responder, o hook NÃO está carregado (custo: um prompt curto).

## 6. Uso
`precost estimate <tarefa>`, `precost last`, `precost approve CODIGO`, `precost revoke CODIGO|all` digitados no prompt (não chegam ao modelo). Terminal: `node bin/precost.js estimate "..." --model ...`.

## Escopo suportado e limites (resumo; detalhes em CAPACIDADES.md)
- Estimativa, não custo; faixa alta não é teto; o gate age antes do prompt e não limita gasto durante a tarefa.
- OpenCode não tem prévia automática antes do modelo; o gate é de ferramenta, não teto de gasto do LLM. Depois da aprovação há uma chamada auxiliar (título) fora da estimativa.
- Aprovação é arquivo local do mesmo usuário: protege contra gasto acidental, não contra agente com shell.
- Pior caso de modelo = maior preço do catálogo suportado, rótulo, não garantia.
- Não verificado: fatura real, PostModelSwitch na sua instalação, subagentes/agendadas, preço bruto Carbon/Argon (inferido).

## Estado da instalacao no OpenCode (verificado em Linux, OpenCode 1.19.6)

- Verificado: `npm i opencode-precost @opencode-ai/plugin` + `.opencode/plugins/precost.js` importando `'opencode-precost'` carrega o plugin e bloqueia a mensagem (teste com provedor inexistente).
- NAO verificado: carregar so por `opencode.json` (chave `plugin` com o nome do pacote). Nos testes o plugin nao foi carregado assim. A chave `plugins` e ignorada pelo 1.19.6. Use o shim acima.
- O pacote ainda nao esta publicado no npm; o teste usou o tarball de `npm pack`.

## Falha do hook no plugin Claude Code (verificado em Linux)

`npm run e2e:claude-plugin-failure` (Claude Code 2.1.332 real, `--plugin-dir`, servidor falso, sem gasto): crash do script, `node` ausente e travamento (timeout) do hook NAO deixam o prompt chegar ao modelo (`onFailure: block`). Controle negativo: com `onFailure: continue` o prompt passa. Nao testado em macOS/Windows.
