# O que cada ferramenta permite de verdade

Estado em 25/nov/2026. VERIFICADO = rodei aqui contra o software real. DOC = so li documentacao/tipos. Nada foi chamado com modelo pago.

## Resumo honesto
- **OpenCode NAO faz previa automatica antes do modelo por conta propria.** Este plugin e que calcula a previa dentro do hook `chat.message`, que roda antes do modelo.
- **O gate de ferramenta (`tool.execute.before` + limite de sessao) NAO e teto de gasto do LLM**: o modelo ja foi chamado e cobrado quando a ferramenta e pedida; o gate so impede a proxima ferramenta depois que o gasto passou do limite. So o gate de prompt (`chat.message`) age antes do primeiro gasto da tarefa, e nao limita o gasto dentro de uma tarefa ja aprovada.
- Nenhum dos dois impede loops longos de um prompt aprovado.

| Capacidade | OpenCode 1.19.6 (plugin V1) | Claude Code (hooks) |
|---|---|---|
| Plugin/hook carrega | VERIFICADO: `opencode serve` listou a tool `precost_estimate` (evidence-opencode-1.19.6-load.log) | NAO TESTADO em Claude Code real (nao instalado/autenticado) |
| Hook recebe o prompt antes do modelo | VERIFICADO: `chat.message` disparou com o prompt real no servidor, antes de qualquer evento de processamento (evidence-opencode-events.log) | DOC: `UserPromptSubmit` recebe `prompt` (hooks.md, secao UserPromptSubmit input) |
| Bloquear prompt | VERIFICADO: lancar erro em `chat.message` impede o prompt de entrar na sessao (0 mensagens) e de chegar ao modelo (evidence-opencode-chatmessage-throw.log). Efeito nao documentado; o cliente so ve erro generico "Unexpected server error"; o texto vai por toast (melhor esforco, nao verificado sem TUI) e log | DOC: `{"decision":"block","reason":...}` com exit 0 bloqueia; `reason` aparece ao usuario. Testado so com JSON simulado |
| Ciclo bloqueio -> approve -> reenvio -> uso unico | VERIFICADO no servidor real: msgs 0, 0, 0, 1, 1 (evidence-opencode-gate-cycle.log, scripts/opencode-gate-e2e.sh); a etapa do provedor falhou por falta de credencial (esperado) | Testado com hook simulado (test/cc-hook.test.js, test/gate.test.js) |
| Modelo ativo | `chat.message` recebe `input.model.modelID` | Evento UserPromptSubmit NAO traz modelo. Rastreado por SessionStart (`model`, opcional) e PostModelSwitch (`to_model`); sem eles, `config.model` ou sem gate (doc: "no $CLAUDE_MODEL") |
| Gasto real por mensagem | DOC/tipo: `message.updated` do assistente traz `cost` e `tokens`. Nao observado: so ocorre com resposta do modelo | transcript_path existe; formato nao verificado |
| Prompts automaticos | n/d | DOC: UserPromptSubmit tambem dispara em tarefas agendadas, subagente em segundo plano e mensagem de outra sessao; o gate pode bloqueá-los |

## Aprovacao (explicita e vinculada)
Reenviar o mesmo prompt nao aprova. Para aprovar: digitar `precost approve CODIGO` (codigo aleatorio da pendencia). A aprovacao liga prompt + modelo + sessao + hash da tabela de precos + limite + teto estimado, vale por ttl (padrao 10 min), uso unico, e `precost revoke CODIGO|all` revoga. Qualquer mudanca nesses itens invalida.

## Limites do estimador
- Observado = caracteres. Tokens = chars/4; sistema/ferramentas = 8k de premissa. Custos sao estimativas.
- Sem historico (<5 sessoes): tres cenarios com premissas fixas, nao medidas. Com historico: P25/P50/P75 agregados, sem tier >200K.
- Tabela de precos: pagina oficial lida no corpo em 25/nov/2026 (Standard, Global). Desconhecidos explicitos: Gemini 4 sem faixa >200K na tabela; cache write nao modelado (valores so a partir de 12/jan/2027); creditos promocionais de Carbon/Argon sao "50% de volta" (preco efetivo, nao fatura); Priority/Batch/Flex nao modelados; acesso a Neon/Carbon na conta nao verificado; precos Anthropic/OpenAI nao incluidos (Claude Code precisaria deles).
