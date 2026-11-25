// Diretorios por plataforma. Linux/macOS mantem os caminhos da v0.2.0; Windows usa APPDATA/LOCALAPPDATA.
// Variaveis PRECOST_STATE / PRECOST_CONFIG continuam mandando em todas as plataformas.
import { homedir } from 'node:os';
import { join } from 'node:path';

const isWin = (platform) => platform === 'win32';
const roaming = (env) => env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
const local = (env) => env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');

export const stateDir = (env = process.env, platform = process.platform) =>
  env.PRECOST_STATE ?? (isWin(platform) ? join(local(env), 'precost', 'state') : join(homedir(), '.cache', 'precost'));
export const configPath = (env = process.env, platform = process.platform) =>
  env.PRECOST_CONFIG ?? (isWin(platform) ? join(roaming(env), 'precost', 'config.json') : join(homedir(), '.config', 'precost', 'config.json'));
export const ledgerPath = (env = process.env, platform = process.platform) =>
  isWin(platform) ? join(local(env), 'precost', 'sessions.json') : join(homedir(), '.local', 'share', 'precost', 'sessions.json');
// Tabela de precos atualizada pelo usuario (precost update-prices). Fica ao lado da config.
export const userPricesPath = (env = process.env, platform = process.platform) =>
  env.PRECOST_PRICES ?? join(configPath(env, platform), '..', 'prices.json');
// Id de sessao vira nome de arquivo: troca o que Windows/macOS nao aceitam em nomes.
export const safeId = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
export const claudeConfigDir = (env = process.env) => env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
export const opencodeConfigDir = (env = process.env) => join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode');
