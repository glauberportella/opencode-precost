#!/usr/bin/env bash
# OpenCode 1.19.6 REAL com provedor OpenAI-compativel FALSO local (sem gasto): gera evento message.updated real do assistente
# com tokens/custo e confere a semantica usada pelo ledger: tokens.input EXCLUI cache.read; ctx = input + cache.read = prompt_tokens.
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; P=$(mktemp -d); export HOME=$(mktemp -d); cd $P; git init -q; mkdir -p .opencode/plugins
cat > opencode.json <<'JSON'
{"provider":{"mock":{"npm":"@ai-sdk/openai-compatible","name":"Mock","options":{"baseURL":"http://127.0.0.1:4591/v1","apiKey":"fake"},"models":{"m1":{"name":"m1","cost":{"input":1,"output":2,"cache_read":0.1},"limit":{"context":200000,"output":8000}}}}}}
JSON
cat > .opencode/plugins/precost.js <<JS
import { PrecostPlugin } from '$R/adapters/opencode/index.js';
export const P = async (input) => PrecostPlugin(input, { models: ['claude-sonnet-5.5'], stateDir: '$P/state', historyPath: '$P/hist.json' });
JS
(MOCKLOG=$P/mock.log node "$R/scripts/mock-openai.mjs" >/dev/null 2>&1 &); sleep 1
(${OPENCODE_BIN:-npx --yes opencode-ai@1.19.6} serve --port 4574 --hostname 127.0.0.1 >$P/serve.log 2>&1 &); for i in $(seq 1 60); do curl -s -m1 http://127.0.0.1:4574/global/health >/dev/null && break; sleep 1; done
B=http://127.0.0.1:4574; ID=$(curl -s -X POST $B/session -H 'content-type: application/json' -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -m 60 -X POST $B/session/$ID/message -H 'content-type: application/json' -d '{"model":{"providerID":"mock","modelID":"m1"},"parts":[{"type":"text","text":"ola"}]}' >/dev/null; sleep 2
pkill -f "opencode.* serve"; pkill -f mock-openai.mjs
python3 - "$P/hist.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1])); s=h['sessions'][0]; ok=True
def chk(n,a,b):
    global ok
    if a!=b: print(f"FALHOU ({n}): esperado {b}, obtido {a}"); ok=False
chk('input exclui cache.read (1234-200)',s['input'],1034); chk('cache_read',s['cache_read'],200); chk('output',s['output'],56)
chk('pico = input+cache.read = prompt_tokens',s['peakCtx'],1234); chk('modelo registrado',s['model'],'m1'); chk('custo do OpenCode (1034*1+56*2+200*0.1)/1e6',round(s['cost'],6),0.001166)
print('E2E LEDGER OK (OpenCode 1.19.6, provedor falso, sem gasto)' if ok else 'E2E LEDGER FALHOU'); sys.exit(0 if ok else 1)
PY
