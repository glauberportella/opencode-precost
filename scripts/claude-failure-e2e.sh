#!/usr/bin/env bash
# Falha do hook no caminho INSTALADO (settings.example.json real, Claude Code pinado 2.1.332, servidor Anthropic FALSO, sem gasto):
# crash do script, node ausente (127) e travamento (timeout) NAO podem deixar o prompt chegar ao modelo (onFailure:block). Controle: hook saudavel bloqueia por custo; sem gate (sem limite) nada muda.
set -uo pipefail
# macOS nao tem `timeout`: usa perl (alarm) quando ausente.
command -v timeout >/dev/null 2>&1 || timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$s" "$@"; }
R="$(cd "$(dirname "$0")/.." && pwd)"; W=$(mktemp -d); export MOCKDIR=$W HOME=$W/home CLAUDE_CONFIG_DIR=$W/cfg ANTHROPIC_BASE_URL=http://127.0.0.1:4590 ANTHROPIC_API_KEY=sk-ant-fake PRECOST_CONFIG=$W/cfg.json PRECOST_STATE=$W/state
mkdir -p $HOME $CLAUDE_CONFIG_DIR $W/proj; cd $W/proj; CC="${CLAUDE_BIN:-npx --yes @anthropic-ai/claude-code@2.1.332}"
(node "$R/scripts/mock-anthropic.mjs" >/dev/null 2>&1 &); sleep 1
echo '{"model":"claude-sonnet-5.5","limitUsd":5}' > $W/cfg.json
calls(){ [ -f $W/mock-model-calls.log ] && wc -l < $W/mock-model-calls.log | tr -d " " || echo 0; }
FAIL=0; chk(){ [ "$2" = "$3" ] || { echo "FALHOU ($1): esperado '$3', obtido '$2'"; FAIL=1; }; }
variant(){ # $1 nome, $2 sed da linha do UserPromptSubmit, $3 timeout
  sed "s#/CAMINHO/opencode-precost#$R#g" $R/adapters/claude-code/settings.example.json | python3 -c "
import sys,json; d=json.load(sys.stdin); h=d['hooks']['UserPromptSubmit'][0]['hooks'][0]; h['command']=sys.argv[1] or h['command']
if sys.argv[2]: h['timeout']=int(sys.argv[2])
json.dump(d,open('$W/s-$1.json','w'))" "$2" "$3"; }
runv(){ before=$(calls); timeout 90 $CC -p "Refactor the whole payments module and rewrite all the tests" --settings $W/s-$1.json > $W/out-$1.txt 2>&1; echo $(( $(calls) - before )); }
variant ok "" ""; chk "saudavel bloqueia (0 chamadas)" "$(runv ok)" 0
variant crash "node $W/nao-existe.js" ""; chk "crash do script" "$(runv crash)" 0
variant nonode "node-inexistente-xyz $R/adapters/claude-code/userpromptsubmit.js" ""; chk "node ausente" "$(runv nonode)" 0
variant hang "sleep 30" 3; chk "timeout" "$(runv hang)" 0
# controle negativo: o exemplo ANTIGO (continue) deixa passar, provando que o teste detecta a falha aberta
sed "s#/CAMINHO/opencode-precost#$R#g; s#\"onFailure\": \"block\"#\"onFailure\": \"continue\"#" $R/adapters/claude-code/settings.example.json | python3 -c "
import sys,json; d=json.load(sys.stdin); d['hooks']['UserPromptSubmit'][0]['hooks'][0]['command']='false'; json.dump(d,open('$W/s-old.json','w'))"
before=$(calls); timeout 90 $CC -p "ola" --settings $W/s-old.json > $W/out-old.txt 2>&1; chk "controle: continue deixa passar (1 chamada)" "$(( $(calls) - before ))" 1
pkill -f mock-anthropic.mjs || true
[ "$FAIL" = 0 ] && echo "E2E FALHA-DE-HOOK OK (Claude Code 2.1.332, servidor falso, sem gasto)" || { echo "E2E FALHA-DE-HOOK FALHOU"; exit 1; }
