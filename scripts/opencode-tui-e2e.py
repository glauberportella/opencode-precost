# TUI REAL do OpenCode (pty, pinado 1.19.6), sem gasto: provedor google sem credencial; o gate bloqueia ANTES do provedor.
# Uso: OPENCODE_BIN=/caminho/opencode python3 scripts/opencode-tui-e2e.py   (espera: texto de bloqueio visivel na TUI)
import os,pty,select,time,re,json,sys,signal,fcntl,termios,struct,tempfile
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W=tempfile.mkdtemp(prefix='precost-octui-')
os.makedirs(W+'/home'); os.makedirs(W+'/p/.opencode/plugins'); os.system(f'cd {W}/p && git init -q')
open(W+'/p/.opencode/plugins/precost.js','w').write(f"import {{ appendFileSync }} from 'node:fs';\nimport {{ PrecostPlugin }} from '{R}/adapters/opencode/index.js';\nexport const P = async (input) => PrecostPlugin(input, {{ limitUsd: 0.5, stateDir: '{W}/state', historyPath: '{W}/hist.json', log: (t) => appendFileSync('{W}/gate.log', t) }});\n")
json.dump({"model":"google/gemini-4-neon"},open(W+'/p/opencode.json','w'))
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
for ch in b'refatorar o modulo inteiro de pagamentos':
    os.write(fd,bytes([ch])); pump(0.03)
pump(1); os.write(fd,b"\r"); pump(15)
txt=re.sub(rb'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\\\)',b'',buf).decode('utf8','replace')
open(W+'/tui-out.txt','w').write(txt)
vis='BLOQUEADO' in txt or 'precost approve' in txt
print('bloqueio visivel na TUI:',vis,'| gate.log:',os.path.exists(W+'/gate.log') and 'precost approve' in open(W+'/gate.log').read(),'| capture',W+'/tui-out.txt')
os.kill(pid,signal.SIGKILL); sys.exit(0 if vis else 1)
