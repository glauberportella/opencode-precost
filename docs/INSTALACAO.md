# Instalação e verificação (v0.2.0, repositório privado, Linux)

Nada aqui chama modelo pago nem publica pacote. Requisitos: Node >= 20, git, acesso ao repositório privado.

## 1. Obter e testar
```
git clone git@github.com:jarbas-melo/opencode-precost.git && cd opencode-precost
git checkout v0.2.0
npm ci && npm test                     # 54 testes
```
Testes reais com software de terceiros contra servidores FALSOS locais (sem gasto, baixam versões fixas via npx): `npm run e2e:claude`, `e2e:claude-tui`, `e2e:claude-failure`, `e2e:opencode`, `e2e:opencode-ledger`, `e2e:opencode-tui`.

## 2. Configuração (`~/.config/precost/config.json`)
```
{"model":"claude-sonnet-5.5","limitUsd":5}
```
Sem `limitUsd`, o hook só informa e nunca bloqueia. `trustConfiguredModel:true` é decisão sua de aceitar um modelo observado/declarado como efetivo (ver README, item 3).

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
