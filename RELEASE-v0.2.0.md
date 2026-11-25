# opencode-precost v0.2.0 (primeira release utilizável, privada)

Prévia de faixa de custo ANTES de rodar uma tarefa em OpenCode (1.19.6) e Claude Code (2.1.332), com gate opcional de aprovação por limite. Estimativa, não custo.

Guia: docs/INSTALACAO.pt-BR.md. Capacidades e limites: docs/CAPACIDADES.md.

Validado (software real, servidores falsos locais, sem gasto): hook e TUI interativa do Claude Code, falha de hook (onFailure block), plugin e TUI do OpenCode com ciclo bloqueio/approve/uso único, semântica de tokens/custo do OpenCode. 54 testes unitários. Revisão independente convergiu no RC3c.

Não validado: fatura real, instalação própria do usuário, PostModelSwitch lá, subagentes/agendadas, macOS/Windows, preço bruto Carbon/Argon. Sem release no npm, repositório privado.
