# Primeiro uso guiado (sem gasto, Linux)

Recorte de prova de conceito local. Nada aqui chama modelo pago. Saidas reais capturadas em `docs/exemplos/` (rodadas em 25/nov/2026, Node 22).

## Passos minimos
```
git clone git@github.com:jarbas-melo/opencode-precost.git && cd opencode-precost   # repo privado
node --version                       # precisa de Node >= 20
node bin/precost.js estimate "Adicionar paginacao na listagem de pedidos e escrever testes" \
  --model gemini-3.5-flash --model claude-sonnet-5.5 --model gemini-4-neon
```
Sem dependencias para a CLI. Para rodar os testes: `npm ci && npm test` (45 testes). Para o teste real no OpenCode 1.19.6 sem modelo pago: `npm run e2e:opencode`.

## O que a saida mostra (docs/exemplos/compare.txt)
- OBSERVADO: so caracteres. CONTEXTO INICIAL ESTIMADO: chars/4 + 8k de sistema (premissa).
- Uma faixa por modelo (tres cenarios fixos, nao medidos). O valor alto e P75/cenario grande, nao e teto.
- Claude: tokens observados x1,3 e entrada nova cobrada como cache write (conservador). gemini-4-neon: sem faixa >200K na tabela, entao "AO MENOS" (limite inferior).
- Comparar com historico por modelo: `--history docs/exemplos/historico-por-modelo.json` (arquivo SINTETICO de exemplo, mapa modelo -> sessoes). Cada linha usa so o seu historico (docs/exemplos/compare-historico-por-linha.txt).

## Gate com aprovacao (simulado, sem Claude Code real)
`docs/exemplos/bloqueio-hook.txt` e `ciclo-aprovacao-hook-simulado.txt`: bloqueio, `precost approve CODIGO`, reenvio permitido uma vez, reenvio seguinte bloqueado. Configuracao: `~/.config/precost/config.json` com `{"model":"claude-sonnet-5.5","limitUsd":5}` e o hook de `adapters/claude-code/settings.example.json`.

## Limites atuais
Estimativa, nao custo. Gate age antes do prompt, nao limita o gasto da tarefa. OpenCode so 1.19.6 (bloqueio por throw nao documentado). Claude Code e toast/TUI do OpenCode nao testados em ferramenta real. Estado de aprovacao em arquivo do mesmo usuario. Carbon/Argon: preco bruto inferido. Historico real nao validado.

## Proximos passos concretos
1. Rodar uma vez no Claude Code real (usuario aceita) e registrar se o motivo do bloqueio aparece e se SessionStart traz o modelo.
2. Rodar uma sessao curta real no OpenCode (gasto pequeno, com aprovacao dele) para observar `message.updated` com custo/tokens e validar o historico e o ledger.
3. Validar o preco bruto de Carbon/Argon na fatura/console.
4. Comando nativo `/precost` e evidencia de TUI.
5. Ajustar faixa por tamanho de tarefa com historico real.
