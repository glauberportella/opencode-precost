#!/usr/bin/env bash
# Ciclo bloqueio -> approve -> reenvio -> uso unico contra um servidor OpenCode REAL (opencode-ai 1.19.6), SEM chamar modelo pago:
# o provedor "google" nao tem credencial no HOME isolado, entao o prompt aprovado chega ate a etapa do provedor e falha ali (HTTP 500 esperado).
# Evidencia de contagem de mensagens: 0 enquanto bloqueado, 1 depois de aprovado.
set -euo pipefail
export HOME=$(mktemp -d); P=$(mktemp -d); R="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$P/.opencode/plugins"; cd "$P"; git init -q
cat > .opencode/plugins/precost.js <<JS
import { appendFileSync } from 'node:fs';
import { PrecostPlugin } from '$R/adapters/opencode/index.js';
export const P = async (input) => PrecostPlugin(input, { limitUsd: 0.5, version: undefined, stateDir: '$P/state', historyPath: '$P/hist.json', log: (t) => appendFileSync('$P/gate.log', t + '\n=====\n') });
JS
(${OPENCODE_BIN:-npx --yes opencode-ai@1.19.6} serve --port 4570 --hostname 127.0.0.1 >"$P/serve.log" 2>&1 &) ; for i in $(seq 1 40); do curl -s -m1 http://127.0.0.1:4570/global/health >/dev/null && break; sleep 1; done
B=http://127.0.0.1:4570; ID=$(curl -s -X POST $B/session -H 'content-type: application/json' -d '{"title":"gate"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
FAIL=0; chk(){ [ "$1" = "$2" ] || { echo "FALHOU: esperado $2, obtido $1"; FAIL=1; }; }
send(){ curl -s -m 25 -o /dev/null -w "HTTP %{http_code}; " -X POST $B/session/$ID/message -H 'content-type: application/json' -d "{\"model\":{\"providerID\":\"google\",\"modelID\":\"gemini-4-neon\"},\"parts\":[{\"type\":\"text\",\"text\":\"$1\"}]}"; sleep 1; N=$(curl -s $B/session/$ID/message | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))'); echo "mensagens na sessao: $N"; }
echo "1 bloqueado:"; send "refatorar o modulo inteiro"; chk "$N" 0
CODE=$(grep -o 'precost approve [0-9a-f]\{8\}' gate.log | head -1 | awk '{print $3}')
echo "2 reenvio sem aprovar:"; send "refatorar o modulo inteiro"; chk "$N" 0
echo "3 approve:"; send "precost approve $CODE"; chk "$N" 0
echo "4 reenvio aprovado (chega ao provedor):"; send "refatorar o modulo inteiro"; chk "$N" 1
echo "5 reenvio de novo (uso unico):"; send "refatorar o modulo inteiro"; chk "$N" 1
pkill -f "opencode.* serve" || true
CODEOK=$(grep -c "precost approve" gate.log || true)
[ "$CODEOK" -ge 1 ] || { echo "FALHOU: texto de bloqueio nao chegou ao log"; FAIL=1; }
[ "$FAIL" = 0 ] && echo "E2E OK (opencode-ai 1.19.6)" || { echo "E2E FALHOU"; exit 1; }
