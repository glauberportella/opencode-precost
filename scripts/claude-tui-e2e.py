# TUI INTERATIVA real do Claude Code (pty) contra servidor Anthropic falso: sem gasto. Uso: CLAUDE_BIN=/caminho/claude python3 scripts/claude-tui-e2e.py (espera: True True True / calls 0)
import os,pty,select,time,re,json,subprocess,sys,signal
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W='/tmp/precost-tui'; os.system(f'rm -rf {W}; mkdir -p {W}/home {W}/cfg {W}/proj')
env=dict(os.environ,MOCKDIR=W,HOME=W+'/home',CLAUDE_CONFIG_DIR=W+'/cfg',ANTHROPIC_BASE_URL='http://127.0.0.1:4590',ANTHROPIC_API_KEY='sk-ant-fake-tui-test-key-0000000000',PRECOST_CONFIG=W+'/cfg.json',PRECOST_STATE=W+'/state',TERM='xterm-256color',ANTHROPIC_MODEL='claude-sonnet-5.5')
json.dump({"model":"claude-sonnet-5.5","limitUsd":5},open(W+'/cfg.json','w'))
json.dump({"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":f"node {R}/adapters/claude-code/userpromptsubmit.js","timeout":20}]}]}},open(W+'/settings.json','w'))
json.dump({"hasCompletedOnboarding":True,"theme":"dark","customApiKeyResponses":{"approved":["sk-ant-fake-tui-test-key-0000000000"[-20:]],"rejected":[]},"projects":{W+'/proj':{"hasTrustDialogAccepted":True,"allowedTools":[]}}},open(W+'/cfg/.claude.json','w'))
subprocess.Popen(['node',R+'/scripts/mock-anthropic.mjs'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
pid,fd=pty.fork()
if pid==0:
    os.chdir(W+'/proj'); os.execvpe(os.environ.get('CLAUDE_BIN','claude'),['claude','--settings',W+'/settings.json'],env)
import fcntl,termios,struct
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',50,160,0,0))
buf=b''
def pump(t):
    global buf
    end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.3)
        if r:
            try: d=os.read(fd,65536)
            except OSError: return
            buf+=d
pump(12)

for ch in b'Refatorar o modulo inteiro de pagamentos e reescrever todos os testes':
    os.write(fd,bytes([ch])); pump(0.03)
pump(1); os.write(fd,b'\r'); pump(10)
txt=re.sub(rb'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07',b'',buf).decode('utf8','replace')
open(W+'/tui-out.txt','w').write(txt)
print('BLOCKED' in txt, 'MODEL NOT PROVEN' in txt, 'blocked by hook' in txt)
calls=W+'/mock-model-calls.log'; print('calls',open(calls).read().count('\n') if os.path.exists(calls) else 0)
os.kill(pid,signal.SIGKILL); os.system('pkill -f mock-anthropic.mjs')
