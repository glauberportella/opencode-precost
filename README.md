# opencode-precost (prototipo)

Mostra uma ESTIMATIVA de faixa de custo ANTES de executar uma tarefa em agentes de codigo (OpenCode e Claude Code), e opcionalmente pede aprovacao explicita quando a faixa alta passa de um limite. Privado, sem chamadas pagas. Primeira release privada v0.2.0, com limites: ver `docs/INSTALACAO.md`, "Limites" e `docs/CAPACIDADES.md`.

## Instalar e testar (reproduzivel)
```
npm ci            # usa package-lock.json; instala a dependencia de dev @opencode-ai/plugin@1.19.6 (necessaria para o teste do adaptador OpenCode)
npm test          # 54 testes; sem npm ci o teste do adaptador OpenCode falha por dependencia ausente
node bin/precost.js doctor   # verifica instalacao local (limite: nao prova que o cliente carregou o hook)
npm run e2e:opencode          # OpenCode 1.19.6 real, sem modelo: ciclo bloqueio/approve/uso unico (npx opencode-ai@1.19.6)
npm run e2e:opencode-ledger   # OpenCode 1.19.6 real + provedor FALSO local: evento real do assistente, semantica de tokens/custo
npm run e2e:claude-tui        # TUI INTERATIVA real do Claude Code (pty) + servidor falso: bloqueio visivel, 0 chamadas ao modelo
npm run e2e:claude-failure    # falha do hook (crash, node ausente, timeout) no settings.example.json real: nada chega ao modelo (onFailure:block)
npm run e2e:opencode-tui      # TUI real do OpenCode 1.19.6 (pty): bloqueio visivel, plugin carregado, sem provedor pago
npm run e2e:claude            # Claude Code 2.1.332 REAL + servidor Anthropic FALSO local: hook, bloqueio sem chamar modelo, approve, uso unico, modelo via transcript (npx @anthropic-ai/claude-code@2.1.332)
```

## Primeiro uso real guiado (escopo)
1. Previa pelo terminal, o canal acessivel e verificado: `node bin/precost.js estimate "tarefa..." --model gemini-3.5-flash` (ou `--task`, `--file`). Tambem `node bin/precost.js last` mostra o ultimo bloqueio.
2. Modelos com preco conhecido na tabela (`data/prices.json`): Gemini 3.x/4 e Claude 4.5 a 5.5. Modelo fora da tabela com limite configurado = bloqueia e pede aprovacao.
3. Claude Code NAO informa o modelo ao hook (observado na 2.1.332). So `PRECOST_MODEL` e aceito como modelo efetivo sem pior caso: e uma DECLARACAO do operador, NAO uma prova tecnica (ela nao forca o Claude a usar esse modelo; use-a junto com `claude --model` igual). Rastreador, ultima resposta do transcript e `--model` do processo sao OBSERVADOS: nao garantem o modelo do proximo prompt (apos `/model`). `ANTHROPIC_MODEL`, settings do Claude e `config.model` sao DECLARADOS. Fora do caso comprovado, o gate usa o PIOR CASO do catalogo suportado (rotulado, nao e preco comprovado nem teto: modelo fora do catalogo nao e coberto) e a aprovacao fica presa a esse estado. `trustConfiguredModel:true` no config aceita um modelo observado/declarado consistente como efetivo (decisao do usuario), exceto quando o transcript registra um `/model` depois da ultima resposta (troca pendente: volta ao pior caso). Exemplo de config: `{"model":"claude-sonnet-5.5","limitUsd":5}`. Historico: com 5+ sessoes do mesmo modelo na pasta de transcripts do projeto, a previa usa o consumo real.
   Instalacao: copie `adapters/claude-code/settings.example.json` ajustando o caminho. O `onFailure:"block"` do UserPromptSubmit e obrigatorio para o gate: sem ele (ou com `continue`) crash, node ausente ou timeout do hook deixam o prompt chegar ao modelo (reproduzido; `npm run e2e:claude-failure`). Sem limite configurado o hook e so informativo.
4. OpenCode: `.opencode/plugins/precost.js` reexportando `adapters/opencode/index.js`, opcoes `limitUsd`, `models`, `ttlMin`. So OpenCode 1.19.6 (outra versao bloqueia, salvo `allowUnverifiedVersion`).
5. Comandos digitados no prompt (nao chegam ao modelo): `precost estimate <tarefa>`, `precost last`, `precost approve CODIGO`, `precost revoke CODIGO|all`. No Claude Code 2.1.332 em modo `claude -p` o texto aparece na saida ("UserPromptSubmit operation blocked by hook: ..."), verificado com Claude Code real; a TUI interativa tambem foi verificada (`npm run e2e:claude-tui`). No OpenCode o cliente recebe erro generico; na TUI real do OpenCode 1.19.6 o texto de bloqueio aparece numa caixa de erro (`npm run e2e:opencode-tui`, captura em docs/evidence/opencode-tui-pty-capture.txt); ciclo approve/reenvio/uso unico testado na TUI com provedor falso local. Trate o terminal como canal confiavel e os comandos no prompt como conveniencia nao comprovada no OpenCode.

## Limites (resumo; detalhes em docs/CAPACIDADES.md)
- E estimativa: tokens = chars/4 (x1.3 nos observados para Claude 4.7+) + 8k de sistema (premissa). Nao e custo conhecido.
- Faixa alta = P75/cenario grande, nao teto. O gate age antes do prompt; nao limita gasto durante a tarefa nem laços longos.
- OpenCode nao tem previa automatica antes do modelo; este plugin calcula dentro de `chat.message`. O bloqueio por throw e comportamento nao documentado (versao fixada, falha fechada).
- Gate contra gasto acidental, nao contra agente com shell no mesmo usuario (estado e arquivo local).
- Precos: Gemini via cloud.google.com/vertex-ai/generative-ai/pricing, Claude via platform.claude.com/docs/en/about-claude/pricing, lidos em 25/nov/2026. Carbon/Argon: bruto inferido. Nao modelados: Batch, Priority, Fast mode, residencia de dados.
- Historico: so sessoes do mesmo modelo e projeto, minimo 5. Semantica dos tokens validada com eventos/transcripts reais de OpenCode e Claude Code contra provedores FALSOS (sem fatura real): `input` exclui o cache. Comparacao com fatura real ainda nao feita.
- Premissa de sistema: 8k tokens no OpenCode e 13k no Claude Code, a partir do tamanho medido do corpo da requisicao (32,6 KB e 48,9 KB para um prompt de 3 a 9 caracteres) convertido por chars/4; nao e contagem de tokens do provedor.
