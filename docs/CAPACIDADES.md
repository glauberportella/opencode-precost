# O que cada ferramenta permite de verdade

Estado em 25/nov/2026. Legenda: VERIFICADO = rodei aqui; DOC = so li a documentacao/tipos; NAO = nao existe na interface lida.

| Capacidade | OpenCode (plugin V1, @opencode-ai/plugin 1.19.6) | Claude Code (hooks) |
|---|---|---|
| Carregar o plugin/hook | VERIFICADO: `opencode serve` 1.19.6 carregou `.opencode/plugins/precost.js` e listou a tool `precost_estimate` (docs/evidence-opencode-1.19.6-load.log). Sem chamada a modelo. | NAO TESTADO: Claude Code nao esta instalado/autenticado aqui. Hook testado so com JSON simulado no stdin. |
| Mostrar previa antes de executar | Sob demanda: tool `precost_estimate` (modelo ou usuario chama). VERIFICADO que a tool existe; execucao testada so direto na funcao. | DOC: hook `UserPromptSubmit` recebe o texto do prompt; `systemMessage` mostra mensagem ao usuario. Teste: simulado. |
| Bloquear antes de gastar | Prompt: NAO ha API para recusar (V2 diz que o hook de prompt so transforma; V1 `chat.message` nao tem retorno de bloqueio). Ferramenta: DOC/tipo: `tool.execute.before` pode lancar erro; testado so com mock. | DOC: `UserPromptSubmit` pode bloquear (`decision: "block"`); a pagina de referencia desse evento nao foi lida inteira. Teste: simulado. |
| Gasto real da sessao | DOC/tipo: evento `message.updated` traz `cost` e `tokens` por mensagem do assistente. Usado para historico e limite de sessao. Nao observei o evento em execucao real (exigiria chamada paga). | NAO usado ainda: o transcript tem uso real, mas o formato nao foi verificado. |
| Modelo ativo | `chat.message` recebe `model` (tipo). Ainda nao usado no gate. | NAO garantido no evento: o modelo vem de config (`PRECOST_MODEL`). |

Paridade: nao ha. No OpenCode o gate forte e por ferramenta/limite de sessao, nao por prompt. No Claude Code o gate e por prompt, sem ver o modelo.

## Limites do estimador
- Contagem de tokens: caracteres/4 (aproximada).
- Sem historico (menos de 5 sessoes): tres cenarios com premissas fixas, nao medidas.
- Com historico: P25/P50/P75 das sessoes passadas, sem ajustar ao tamanho da tarefa.
- Faixa nao e garantia: o agente explora, roda testes, refaz trabalho.
- Preco ausente fica "n/d"; nunca vira zero. Cache sem preco na tabela e cobrado a preco cheio (limite superior).
