# opencode-precost (prototipo)

Mostra uma ESTIMATIVA de faixa de custo ANTES de executar uma tarefa em agentes de codigo (OpenCode e Claude Code), e opcionalmente pede aprovacao explicita quando a faixa alta passa de um limite. Privado, sem chamadas pagas. Nao e pronto: ver "Limites" e `docs/CAPACIDADES.md`.

## Instalar e testar (reproduzivel)
```
npm ci            # usa package-lock.json; instala a dependencia de dev @opencode-ai/plugin@1.19.6 (necessaria para o teste do adaptador OpenCode)
npm test          # 47 testes; sem npm ci o teste do adaptador OpenCode falha por dependencia ausente
npm run e2e:opencode          # OpenCode 1.19.6 real, sem modelo: ciclo bloqueio/approve/uso unico (npx opencode-ai@1.19.6)
npm run e2e:opencode-ledger   # OpenCode 1.19.6 real + provedor FALSO local: evento real do assistente, semantica de tokens/custo
npm run e2e:claude            # Claude Code 2.1.332 REAL + servidor Anthropic FALSO local: hook, bloqueio sem chamar modelo, approve, uso unico, modelo via transcript (npx @anthropic-ai/claude-code@2.1.332)
```

## Primeiro uso real guiado (escopo)
1. Previa pelo terminal, o canal acessivel e verificado: `node bin/precost.js estimate "tarefa..." --model gemini-3.5-flash` (ou `--task`, `--file`). Tambem `node bin/precost.js last` mostra o ultimo bloqueio.
2. Modelos com preco conhecido na tabela (`data/prices.json`): Gemini 3.x/4 e Claude 4.5 a 5.5. Modelo fora da tabela com limite configurado = bloqueia e pede aprovacao.
3. Claude Code NAO informa o modelo ao hook (observado na 2.1.332: nem em SessionStart nem em UserPromptSubmit). O modelo vem, em ordem: `PRECOST_MODEL`, rastreador, ultima resposta no transcript da sessao, `ANTHROPIC_MODEL`, `config.model`. Na 1a mensagem de uma sessao so valem `ANTHROPIC_MODEL`/`config.model`: configure `~/.config/precost/config.json` (ex. `{"model":"claude-sonnet-5.5","limitUsd":5}`) e, se trocar de modelo, o transcript corrige a partir da 2a mensagem. Sem modelo conhecido e com limite, bloqueia. Historico: com 5+ sessoes do mesmo modelo na pasta de transcripts do projeto, a previa usa o consumo real.
4. OpenCode: `.opencode/plugins/precost.js` reexportando `adapters/opencode/index.js`, opcoes `limitUsd`, `models`, `ttlMin`. So OpenCode 1.19.6 (outra versao bloqueia, salvo `allowUnverifiedVersion`).
5. Comandos digitados no prompt (nao chegam ao modelo): `precost estimate <tarefa>`, `precost last`, `precost approve CODIGO`, `precost revoke CODIGO|all`. No Claude Code 2.1.332 em modo `claude -p` o texto aparece na saida ("UserPromptSubmit operation blocked by hook: ..."), verificado com Claude Code real; o modo interativo (TUI) nao foi verificado. No OpenCode o cliente recebe erro generico; o texto vai por toast (NAO verificado em TUI real) e pelo CLI `last`. Trate o terminal como canal confiavel e os comandos no prompt como conveniencia nao comprovada no OpenCode.

## Limites (resumo; detalhes em docs/CAPACIDADES.md)
- E estimativa: tokens = chars/4 (x1.3 nos observados para Claude 4.7+) + 8k de sistema (premissa). Nao e custo conhecido.
- Faixa alta = P75/cenario grande, nao teto. O gate age antes do prompt; nao limita gasto durante a tarefa nem laços longos.
- OpenCode nao tem previa automatica antes do modelo; este plugin calcula dentro de `chat.message`. O bloqueio por throw e comportamento nao documentado (versao fixada, falha fechada).
- Gate contra gasto acidental, nao contra agente com shell no mesmo usuario (estado e arquivo local).
- Precos: Gemini via cloud.google.com/vertex-ai/generative-ai/pricing, Claude via platform.claude.com/docs/en/about-claude/pricing, lidos em 25/nov/2026. Carbon/Argon: bruto inferido. Nao modelados: Batch, Priority, Fast mode, residencia de dados.
- Historico: so sessoes do mesmo modelo e projeto, minimo 5. Semantica dos tokens validada com eventos/transcripts reais de OpenCode e Claude Code contra provedores FALSOS (sem fatura real): `input` exclui o cache. Comparacao com fatura real ainda nao feita.
- Premissa de sistema: 8k tokens no OpenCode e 13k no Claude Code, a partir do tamanho medido do corpo da requisicao (32,6 KB e 48,9 KB para um prompt de 3 a 9 caracteres) convertido por chars/4; nao e contagem de tokens do provedor.
