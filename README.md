# opencode-precost (prototipo)

Mostra uma ESTIMATIVA de faixa de custo ANTES de executar uma tarefa em agentes de codigo. Nucleo compartilhado + adaptadores para OpenCode e Claude Code. Privado, sem chamadas pagas.

- Separa **custo conhecido** (contexto inicial) de **faixa estimada** (tarefa inteira).
- Tabela de precos editavel em `data/prices.json` (Gemini Global, fonte e data em cada linha).
- Capacidades reais e limites por ferramenta: `docs/CAPACIDADES.md`.

```
node bin/precost.js --task "corrigir paginacao" --model gemini-4-hydrogen --model gemini-4-neon --cache-hit 0.5
npm test
```

Claude Code: `adapters/claude-code/settings.example.json`, config em `~/.config/precost/config.json` (`model`, `limitUsd`, `compare`).
OpenCode: `.opencode/plugins/precost.js` reexportando `adapters/opencode/index.js` (ver evidencia de carga em `docs/`).
Bloqueio exige aprovacao explicita (`precost approve CODIGO`); reenviar nao aprova. Detalhes e limites: docs/CAPACIDADES.md.
