#!/usr/bin/env bash
# Falha do hook no caminho PLUGIN (--plugin-dir, Claude Code pinado 2.1.332, servidor Anthropic FALSO, sem gasto):
# crash do script, node ausente e travamento (timeout) NAO podem deixar o prompt chegar ao modelo (onFailure:block).
# Controle negativo: com onFailure:continue e comando que falha, o prompt passa (prova que o teste detecta falha aberta).
set -uo pipefail
# macOS nao tem `timeout`: usa perl (alarm) quando ausente.
command -v timeout >/dev/null 2>&1 || timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$s" "$@"; }
R="$(cd "$(dirname "$0")/.." && pwd)"; W=$(mktemp -d); export MOCKDIR=$W HOME=$W/home CLAUDE_CONFIG_DIR=$W/cfg ANTHROPIC_BASE_URL=http://127.0.0.1:4590 ANTHROPIC_API_KEY=sk-ant-fake PRECOST_CONFIG=$W/cfg.json PRECOST_STATE=$W/state
mkdir -p $HOME $CLAUDE_CONFIG_DIR $W/proj; cd $W/proj; CC="${CLAUDE_BIN:-npx --yes @anthropic-ai/claude-code@2.1.332}"
(node "$R/scripts/mock-anthropic.mjs" >/dev/null 2>&1 &); sleep 1
echo '{"model":"claude-sonnet-5.5","limitUsd":5}' > $W/cfg.json
calls(){ [ -f $W/mock-model-calls.log ] && wc -l < $W/mock-model-calls.log || echo 0; }
FAIL=0; chk(){ [ "$2" = "$3" ] || { echo "FALHOU ($1): esperado '$3', obtido '$2'"; FAIL=1; }; }
variant(){ # $1 nome, $2 comando, $3 args JSON, $4 timeout, $5 onFailure
  D=$W/plug-$1; mkdir -p $D; cp -r $R/.claude-plugin $R/adapters $R/src $R/data $R/package.json $D/ 2>/dev/null; mkdir -p $D/hooks
  python3 - "$D" "$2" "$3" "$4" "$5" <<'PY'
import sys,json
D,cmd,args,to,onf=sys.argv[1:]
json.dump({"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":cmd,"args":json.loads(args),"timeout":int(to),"onFailure":onf}]}]}},open(D+"/hooks/hooks.json","w"))
PY
}
runv(){ before=$(calls); timeout 90 $CC -p "Refatorar o modulo inteiro de pagamentos e reescrever todos os testes" --plugin-dir $W/plug-$1 > $W/out-$1.txt 2>&1; echo $(( $(calls) - before )); }
variant ok node "[\"$R/adapters/claude-code/userpromptsubmit.js\"]" 20 block; chk "saudavel bloqueia (0 chamadas)" "$(runv ok)" 0
variant crash node "[\"$W/nao-existe.js\"]" 20 block; chk "crash do script" "$(runv crash)" 0
variant nonode node-inexistente-xyz "[\"$R/adapters/claude-code/userpromptsubmit.js\"]" 20 block; chk "node ausente" "$(runv nonode)" 0
variant hang sleep '["30"]' 3 block; chk "timeout" "$(runv hang)" 0
variant old false '[]' 20 continue; chk "controle: continue deixa passar (1 chamada)" "$(runv old)" 1
pkill -f mock-anthropic.mjs || true
[ "$FAIL" = 0 ] && echo "E2E PLUGIN FALHA-DE-HOOK OK (Claude Code 2.1.332, servidor falso, sem gasto)" || { echo "E2E PLUGIN FALHA-DE-HOOK FALHOU"; exit 1; }
