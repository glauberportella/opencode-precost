# Claude Code marketplace install E2E (Linux/macOS, bash). Real Claude Code against a local mock model: no paid call. Needs the repo public and: npx --yes @anthropic-ai/claude-code@2.1.332 cached. Not run by CI.
set -u
R=$(cd "$(dirname "$0")/.." && pwd); CB=${CLAUDE_CMD:-$(ls ~/.npm/_npx/*/node_modules/.bin/claude | head -1)}
W=$(mktemp -d); export HOME=$W/home CLAUDE_CONFIG_DIR=$W/cfg MOCKDIR=$W ANTHROPIC_BASE_URL=http://127.0.0.1:4590 ANTHROPIC_API_KEY=sk-ant-fake PRECOST_CONFIG=$W/cfg.json PRECOST_STATE=$W/state ANTHROPIC_MODEL=claude-sonnet-5.5
mkdir -p $HOME $CLAUDE_CONFIG_DIR $W/proj; echo '{"model":"claude-opus-5.5","limitUsd":5}' > $W/cfg.json
cd $W/proj
$CB plugin marketplace add glauberportella/opencode-precost 2>&1 | tail -1
$CB plugin install precost@precost-marketplace 2>&1 | tail -1
setsid node $R/scripts/mock-anthropic.mjs >/dev/null 2>&1 & MP=$!; sleep 1.5
calls(){ [ -f $W/mock-model-calls.log ] && grep -c . $W/mock-model-calls.log || echo 0; }
chk(){ if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHOU $1 (esperado $3, obtido $2)"; fi; }
P='Refatorar o modulo inteiro de pagamentos e reescrever todos os testes'
SID=$(cat /proc/sys/kernel/random/uuid)
out=$(timeout 120 $CB -p "$P" --session-id $SID 2>&1); echo "$out" | head -3
chk "1 bloqueia (instalacao do marketplace, sem --plugin-dir)" "$(echo "$out" | grep -c BLOCKED)" 1; chk "1 modelo nao chamado" "$(calls)" 0
code=$(echo "$out" | grep -oE 'precost approve [0-9a-f]{8}' | head -1 | awk '{print $3}')
out=$(timeout 120 $CB -p "precost approve $code" --resume $SID 2>&1); chk "2 aprovado sem chamar modelo" "$(echo "$out" | grep -c 'approved for')/$(calls)" "1/0"
out=$(timeout 120 $CB -p "$P" --resume $SID 2>&1); chk "3 reenvio chama modelo 1x" "$(calls)" 1; chk "3 resposta mock" "$(echo "$out" | grep -c 'mock ok')" 1
out=$(timeout 120 $CB -p "$P" --resume $SID 2>&1); chk "4 uso unico bloqueia de novo" "$(echo "$out" | grep -c BLOCKED)/$(calls)" "1/1"
H=$(find $CLAUDE_CONFIG_DIR -name hooks.json -path '*precost*' | head -1); echo hooks: ${H#$W/}
cp $H $W/hooks.orig
sed 's#"node"#"node-inexistente-xyz"#' $W/hooks.orig > $H
b=$(calls); timeout 120 $CB -p "$P" --session-id $(cat /proc/sys/kernel/random/uuid) >/dev/null 2>&1; chk "5 falha fechada: node ausente nao chega ao modelo (instalado)" "$(( $(calls)-b ))" 0
sed 's#userpromptsubmit.js#nao-existe.js#' $W/hooks.orig > $H
b=$(calls); timeout 120 $CB -p "$P" --session-id $(cat /proc/sys/kernel/random/uuid) >/dev/null 2>&1; chk "6 falha fechada: script quebra nao chega ao modelo (instalado)" "$(( $(calls)-b ))" 0
cp $W/hooks.orig $H
kill -- -$MP 2>/dev/null; kill $MP 2>/dev/null; rm -rf $W
