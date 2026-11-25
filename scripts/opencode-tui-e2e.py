# TUI REAL do OpenCode (pty, pinado 1.19.6), sem gasto: provedor OpenAI-compativel FALSO local (mock/m1). Ciclo: bloqueio -> approve -> reenvio (1 chamada ao mock) -> uso unico.
# Uso: OPENCODE_BIN=/caminho/opencode python3 scripts/opencode-tui-e2e.py   (espera: texto de bloqueio visivel na TUI)
import os,pty,select,time,re,json,sys,signal,fcntl,termios,struct,tempfile
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W=tempfile.mkdtemp(prefix='precost-octui-')
os.makedirs(W+'/home'); os.makedirs(W+'/p/.opencode/plugins'); os.system(f'cd {W}/p && git init -q')
open(W+'/p/.opencode/plugins/precost.js','w').write(f"import {{ appendFileSync }} from 'node:fs';\nimport {{ PrecostPlugin }} from '{R}/adapters/opencode/index.js';\nexport const P = async (input) => PrecostPlugin(input, {{ limitUsd: 0.5, stateDir: '{W}/state', historyPath: '{W}/hist.json', log: (t) => appendFileSync('{W}/gate.log', t) }});\n")
json.dump({"model":"mock/m1","provider":{"mock":{"npm":"@ai-sdk/openai-compatible","name":"Mock","options":{"baseURL":"http://127.0.0.1:4591/v1","apiKey":"fake"},"models":{"m1":{"name":"m1","cost":{"input":1,"output":2,"cache_read":0.1},"limit":{"context":200000,"output":8000}}}}}},open(W+'/p/opencode.json','w'))
import subprocess; subprocess.Popen(['node',R+'/scripts/mock-openai.mjs'],env=dict(os.environ,MOCKLOG=W+'/mock.log'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
env=dict(os.environ,HOME=W+'/home',TERM='xterm-256color')
pid,fd=pty.fork()
if pid==0:
    os.chdir(W+'/p'); b=os.environ.get('OPENCODE_BIN','opencode'); os.execvpe(b,[b],env)
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',50,160,0,0)); buf=b''
def pump(t):
    global buf
    end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.3)
        if r:
            try: buf+=os.read(fd,65536)
            except OSError: return
pump(20)
def send(t):
    os.write(fd,b'\x15'); pump(0.5)
    for ch in t.encode(): os.write(fd,bytes([ch])); pump(0.03)
    pump(1); os.write(fd,b'\r'); pump(8)
def ncalls():
    p=W+'/mock.log'; return sum(1 for l in open(p) if 'chat/completions' in l and int(l.split()[-1]) > 10000)  # a chamada pequena (~2,4 KB) e a geracao de titulo da sessao, nao a mensagem do usuario if os.path.exists(p) else 0
P='refatorar o modulo inteiro de pagamentos'
send(P); c0=ncalls()
g=open(W+'/gate.log').read() if os.path.exists(W+'/gate.log') else ''
m=re.search(r'precost approve ([0-9a-f]{8})',g); code=m.group(1) if m else None
send('precost approve '+(code or 'x')); c1=ncalls()
send(P); c2=ncalls()
send(P); c3=ncalls()
txt=re.sub(rb'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\\\)',b'',buf).decode('utf8','replace')
open(W+'/raw.bin','wb').write(buf); open(W+'/tui-out.txt','w').write(txt)
ok = code is not None and (c0,c1,c2,c3)==(0,0,1,1)
print('codigo de aprovacao no log do gate:',bool(code),'| chamadas ao mock apos bloqueio/approve/reenvio/reenvio:',(c0,c1,c2,c3),'(esperado 0,0,1,1) | capture',W+'/tui-out.txt')
os.system('pkill -f mock-openai.mjs'); os.kill(pid,signal.SIGKILL); sys.exit(0 if ok else 1)
