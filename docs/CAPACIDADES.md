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


## Atualizacao (revisao independente, 25/nov/2026)
- **Limite de seguranca (declarado):** a aprovacao e estado em arquivos do mesmo usuario (`~/.cache/precost`). Um agente com shell ou escrita nesse usuario pode forjar aprovacao ou ler o codigo. Nao ha autoridade fora do alcance do modelo nem prometo protecao contra autoaprovacao. O gate protege contra gasto acidental, nao contra agente adversario. O comando `precost approve` so e aceito como texto de prompt do usuario (no OpenCode ele e barrado no `chat.message`; no Claude Code, no hook, e nao chega ao modelo). A CLI local nao aprova nada; `precost last` so mostra o ultimo bloqueio.
- **Falha fechada** (quando `limitUsd` esta configurado): limite nao numerico/negativo, ttl invalido, config ilegivel, tabela de precos ilegivel, erro interno, entrada do hook ilegivel, modelo ativo desconhecido ou sem preco, custo so com limite inferior, arquivo de contexto nao contado (grande, fora do projeto, segredo): tudo bloqueia e pede aprovacao ou correcao. Sem `limitUsd` e so informativo e diz "SEM GATE".
- **OpenCode: dependencia do throw nao documentado.** Versao fixada em 1.19.6 (`PINNED_OPENCODE`, devDependency exata). Em runtime o plugin le `/global/health`; versao diferente ou nao identificada bloqueia, salvo `allowUnverifiedVersion: true`. Regressao: `npm run e2e:opencode` (servidor real, falha com exit 1 se a contagem de mensagens 0,0,0,1,1 nao bater).
- **Contexto observado:** arquivos (`@caminho` no Claude Code, partes `file` no OpenCode) sao lidos dentro do projeto, entram na estimativa e o hash do conteudo entra no vinculo da aprovacao. Arquivos sem leitura contam como "NAO contado" e exigem aprovacao.
- **Historico:** com >=5 sessoes soma-se uma vez a entrada observada da tarefa; ainda nao escala com o tamanho alem disso. Faixa alta e P75/cenario grande, nao teto.
- **Promocao Gemini 4 Carbon/Argon:** cobranca BRUTA (preco de lista 4/20, inferido) e beneficio condicional (50% de creditos de volta, ate 30/nov) sao mostrados separados; o gate usa o bruto.
- **Contexto longo:** `long_context` = `none` (pagina sem faixa), objeto (3.1 Pro, Haiku 5.5 a 100K) ou `unknown` (Gemini 4: so limite inferior, exige aprovacao).
- **Precos Claude** (platform.claude.com/docs/en/about-claude/pricing, lido 25/nov/2026): Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (faixa a 100K), Sonnet 4.6, Opus 4.5, Haiku 4.5. Nao modelados: cache write, Batch, Fast mode, residencia de dados (1,1x). Tokenizador 4.7+ gera ~30% mais tokens: chars/4 subestima.
- **Ledger:** dedup por id de mensagem agora persiste em disco (nao duplica gasto apos reinicio).

## Atualizacao 2 (comandos e historico)
- **Comandos digitados pelo usuario, sem modelo e sem gasto** (OpenCode `chat.message` e Claude Code hook): `precost estimate <texto da tarefa>` mostra a previa; `precost last` mostra o ultimo bloqueio completo; `precost approve CODIGO` / `precost revoke CODIGO|all`. Previa nunca aprova nada. Nao e um slash command nativo (`/precost` segue pendente).
- **Historico agregado e limiar por chamada:** o limiar de contexto longo vale por chamada. Com historico, usa-se a media de tokens por chamada (entrada+cache / turnos). Media acima do limiar = limite inferior; abaixo = so nota de que o pico por chamada e desconhecido (nao soma todos os turnos).
- **Preco bruto de Carbon/Argon e INFERIDO** (4/20 = preco pos-promocao; a pagina so descreve 50% de creditos de volta). Sem validacao em fonte primaria de faturamento: estimativa conservadora, nunca "cobranca exata".
- Limite fundamental mantido: estado em arquivos do mesmo usuario; agente com shell pode alterar. Nao e seguranca resolvida.

## Atualizacao 3 (conjunto consolidado)
- **Subestimativas conhecidas agora entram no custo (conservador):** Claude 4.7+ usa x1.3 nos tokens observados (nota oficial de ~30%, valor aproximado); cache write: toda entrada nova e cobrada como cache write 5min (Claude), o que pode superestimar. Resta: chars/4 e a premissa de 8k de sistema (premissas rotuladas).
- **Pico por chamada:** o ledger registra o maior contexto real por sessao (`peakCtx`). Historico agregado so afirma sem faixa longa com pico real registrado; media por chamada nao prova ausencia de picos; pico desconhecido = limite inferior (exige aprovacao).
- **Historico filtrado:** so sessoes do mesmo modelo e do mesmo projeto (diretorio) entram; sessao com varios modelos fica fora. `cache_write` agora e registrado e custeado. Semantica de `input` vs `cache` dos eventos reais nao validada (nenhuma resposta de modelo observada).
- **Arquivos ignorados** (segredo, grande): o conteudo nao e lido; a aprovacao e vinculada a assinatura tamanho+mtime. Mudanca que preserve tamanho e mtime nao e detectada (limite declarado).
- **UX:** canal verificado = terminal (`precost estimate`, `precost last`). Comandos no prompt: contrato lido (Claude Code) e erro+toast (OpenCode) sem evidencia de TUI/UI real de que o texto aparece.
- **Reproducao:** `npm ci && npm test` (47 testes); sem `npm ci` o teste do adaptador OpenCode falha por dependencia ausente.

## Atualizacao 4 (correcoes da revisao 8f5f7a3)
- Prompt so com arquivo (sem texto) passa pelo gate no OpenCode. Comandos `precost estimate|last|approve|revoke` sao interceptados SEMPRE (OpenCode e Claude Code, com ou sem `limitUsd`/config), nunca chegam ao modelo.
- Pico por chamada no historico = MAIOR registrado (nao quantil); o texto da base diz isso.
- Historico por modelo em cada linha (`history` aceita mapa `{modelo: sessoes}`); linhas comparadas nao se misturam; base mista e rotulada por linha.
- `precost last` escopado por sessao (arquivo por sessao); a CLI de terminal mostra o mais recente de qualquer sessao e diz isso.
- Hook do Claude Code: carga dos modulos por import dinamico; falha de carga com limite configurado bloqueia (antes um erro de modulo sairia nao-bloqueante).
- Escopo: recorte de prova de conceito local, nao produto pronto nem seguranca forte. 47 testes.

## Atualizacao 5
- Regressao do revisor (ledger com 3.7 ~10k e 3.8 ~400k, mesmo projeto): tool, gate com compare e preview usam o historico de cada modelo (3.8 >20x 3.7 nos tres caminhos). A CLI recusa `--history` em lista quando ha varios modelos (exige mapa por modelo). 47 testes.

## Atualizacao 6 (validacao real contra servidores falsos, 25/nov/2026)
Sem chamada paga e sem credencial real: Claude Code 2.1.332 e OpenCode 1.19.6 reais, instalados so no sandbox, apontados para servidores locais falsos (`scripts/mock-anthropic.mjs`, `scripts/mock-openai.mjs`). Logs em `docs/evidence/`.
- **Claude Code REAL (`npm run e2e:claude`)**: `UserPromptSubmit` recebe `prompt`, `session_id`, `transcript_path`, `cwd`, `permission_mode` (docs/evidence/claude-code-2.1.332-userpromptsubmit-input.json). **Nao traz modelo**, e `SessionStart` (modo -p) tambem nao. Bloqueio por `decision: block` NAO chama o modelo (contador do servidor falso 0), o texto aparece em `claude -p`; approve, reenvio permitido (1 chamada), uso unico e `precost estimate` funcionaram; o modelo passa a vir da ultima resposta do transcript e corrige um `config.model` divergente a partir da 2a mensagem. `--resume` preserva o `session_id`, entao a aprovacao vale na mesma sessao.
- **Nao verificado no Claude Code**: modo interativo (TUI), `PostModelSwitch` (nao ocorreu em `-p`), subagentes e tarefas agendadas.
- **OpenCode REAL com provedor falso (`npm run e2e:opencode-ledger`)**: evento `message.updated` real do assistente: `tokens.input` EXCLUI `cache.read`; custo = input*preco + output*preco + cache_read*preco do config do OpenCode; pico por chamada = input + cache.read = prompt_tokens. O ledger bate (inclusive modelo e projeto).
- **Transcripts do Claude Code**: linhas `assistant` com `message.id/model/usage` (`input_tokens` exclui cache; `cache_read_input_tokens`; `cache_creation_input_tokens`). Formato lido de uma sessao real em 2.1.332, usado para modelo ativo e historico (dedup por `message.id`, maior valor). Os valores de uso vieram do servidor falso, entao a comparacao com fatura real segue pendente.
- **Premissa de sistema medida em bytes**: corpo da requisicao do Claude Code = 48.919 bytes e do OpenCode = 32.576 bytes para prompts de poucos caracteres (docs/evidence/*requests.log). Convertidos por chars/4: ~12,2K e ~8,1K tokens. Padroes: 13K (Claude Code) e 8K (OpenCode). CLAUDE.md, MCPs e skills do usuario aumentam isso.
- 49 testes.
