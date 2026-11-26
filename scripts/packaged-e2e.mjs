// Pacote INSTALADO, multiplataforma (sem bash): npm pack -> instala o .tgz em diretorio limpo (com as dependencias do npm)
// -> confirma que @opencode-ai/plugin veio junto -> roda o E2E nativo A PARTIR DO PACOTE INSTALADO, nao do checkout.
// Clientes reais (Claude Code 2.1.332, opencode-ai 1.19.6) contra servidores falsos locais, sem gasto.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, cwd) => { const r = spawnSync(cmd, { shell: true, cwd, stdio: 'inherit' }); if (r.status !== 0) { console.error(`FALHOU: ${cmd} (exit ${r.status})`); process.exit(1); } };
const out = mkdtempSync(join(tmpdir(), 'precost-pack-'));
sh(`npm pack --pack-destination "${out}" --silent`, R);
const tgz = readdirSync(out).find((f) => f.endsWith('.tgz'));
if (!tgz) { console.error('FALHOU: npm pack nao gerou .tgz'); process.exit(1); }
const inst = join(out, 'inst'); mkdirSync(inst);
writeFileSync(join(inst, 'package.json'), '{"name":"precost-install-check","version":"1.0.0","private":true}');
sh(`npm install --silent "${join(out, tgz)}"`, inst);
const pkg = join(inst, 'node_modules', 'opencode-precost');
if (!existsSync(join(inst, 'node_modules', '@opencode-ai', 'plugin'))) { console.error('FALHOU: @opencode-ai/plugin nao foi instalado com o pacote'); process.exit(1); }
console.log(`ok   pacote ${tgz} instalado com @opencode-ai/plugin; node ${process.version} ${process.platform}/${process.arch}`);
cpSync(join(R, 'scripts'), join(pkg, 'scripts'), { recursive: true });
sh('node scripts/e2e-native.mjs', pkg);
rmSync(out, { recursive: true, force: true });
