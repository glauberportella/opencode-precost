#!/usr/bin/env bash
# Teste REAL do Claude Code (pinado 2.1.332) contra um servidor Anthropic FALSO local: nenhuma chamada paga, nenhuma credencial real.
# Prova: hook dispara com o prompt antes do modelo, bloqueio nao chama o modelo (contador do mock), ciclo approve/reenvio/uso unico,
# modelo vindo do transcript. Falha com exit 1 se algo divergir.
set -uo pipefail
# macOS nao tem `timeout`: usa perl (alarm) quando ausente.
command -v timeout >/dev/null 2>&1 || timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$s" "$@"; }
R="$(cd "$(dirname "$0")/.." && pwd)"; W=$(mktemp -d); export MOCKDIR=$W HOME=$W/home CLAUDE_CONFIG_DIR=$W/cfg ANTHROPIC_BASE_URL=http://127.0.0.1:4590 ANTHROPIC_API_KEY=sk-ant-fake
mkdir -p $HOME $CLAUDE_CONFIG_DIR $W/proj; cd $W/proj
CC="${CLAUDE_BIN:-npx --yes @anthropic-ai/claude-code@2.1.332}"
(node "$R/scripts/mock-anthropic.mjs" >/dev/null 2>&1 &); sleep 1
cat > $W/settings.json <<JSON
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node $R/adapters/claude-code/track-model.js"}]}],
"UserPromptSubmit":[{"hooks":[{"type":"command","command":"node $R/adapters/claude-code/userpromptsubmit.js","timeout":20}]}]}}
JSON
echo '{"model":"claude-opus-5.5","limitUsd":5}' > $W/cfg.json   # config DIVERGE do modelo real (sonnet) de proposito
export PRECOST_CONFIG=$W/cfg.json PRECOST_STATE=$W/state
SID=$(python3 -c 'import uuid;print(uuid.uuid4())'); FAIL=0; P="Refatorar o modulo inteiro de pagamentos e reescrever todos os testes"
calls(){ [ -f $W/mock-model-calls.log ] && wc -l < $W/mock-model-calls.log || echo 0; }
export ANTHROPIC_MODEL=claude-sonnet-5.5   # modelo efetivo do Claude; o config diverge de proposito (opus) => fontes declaradas em CONFLITO => nao comprovado
run(){ timeout 90 $CC -p "$1" --settings $W/settings.json "${@:2}" > $W/out.txt 2> $W/err.txt; }
chk(){ [ "$2" = "$3" ] || { echo "FALHOU ($1): esperado '$3', obtido '$2'"; FAIL=1; }; }
has(){ grep -q "$2" $W/out.txt && echo sim || echo nao; }
run "$P" --session-id $SID; chk "1 bloqueia" "$(has x 'BLOQUEADO')" sim; chk "1 modelo nao chamado" "$(calls)" 0
chk "1 modelo nao comprovado: pior caso dito" "$(has x 'MODELO NAO COMPROVADO')" sim; chk "1 conflito de fontes dito" "$(has x 'CONFLITO')" sim
CODE=$(grep -o 'precost approve [0-9a-f]\{8\}' $W/out.txt | head -1 | awk '{print $3}')
run "precost approve $CODE" --resume $SID; chk "2 approve nao chama modelo" "$(calls)" 0; chk "2 aprovado" "$(has x 'aprovado por')" sim
run "$P" --resume $SID; chk "3 reenvio chama o modelo 1x" "$(calls)" 1; chk "3 resposta do modelo" "$(has x 'mock ok')" sim
run "$P" --resume $SID; chk "4 uso unico: bloqueia de novo" "$(has x 'BLOQUEADO')" sim; chk "4 modelo nao chamado de novo" "$(calls)" 1
chk "4 transcript e so observado: ainda nao comprovado (conflito com config opus)" "$(has x 'transcript (ultima resposta')" sim; chk "4 pior caso, nao silencia" "$(has x 'MODELO NAO COMPROVADO')" sim
run "precost estimate corrigir um bug" --resume $SID; chk "5 estimate nao chama modelo" "$(calls)" 1; chk "5 previa" "$(has x 'Nada foi enviado ao modelo')" sim
SID2=$(python3 -c 'import uuid;print(uuid.uuid4())')
run "$P" --session-id $SID2 --model claude-opus-5.5; chk "6 --model do processo e observado (nao prova)" "$(has x 'flag --model do processo claude')" sim; chk "6 ainda nao comprovado" "$(has x 'NAO COMPROVADO')" sim
SID3=$(python3 -c 'import uuid;print(uuid.uuid4())')
PRECOST_MODEL=claude-opus-5.5 run "$P" --session-id $SID3; chk "7 PRECOST_MODEL comprova" "$(has x 'env PRECOST_MODEL')" sim; chk "7 sem pior caso" "$(has x 'NAO COMPROVADO')" nao
pkill -f mock-anthropic.mjs || true
[ $FAIL = 0 ] && echo "E2E CLAUDE CODE OK (2.1.332, servidor falso, sem gasto)" || { echo "E2E CLAUDE CODE FALHOU"; exit 1; }
