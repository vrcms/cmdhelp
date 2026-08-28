import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  base_url: string;
  api_key: string;
  model: string;
}

const ENV_NAMES: Record<keyof Config, string> = {
  base_url: 'CMDHELP_BASE_URL',
  api_key: 'CMDHELP_API_KEY',
  model: 'CMDHELP_MODEL',
};

export function configPath(): string {
  return join(homedir(), '.cmdhelp', 'config.json');
}

export function loadConfig(): Config | null {
  return mergeConfig(readFileConfig(), process.env);
}

export function mergeConfig(
  file: Partial<Config>,
  env: NodeJS.ProcessEnv,
): Config | null {
  const merged: Config = { ...file } as Config;
  for (const key of Object.keys(ENV_NAMES) as (keyof Config)[]) {
    const value = env[ENV_NAMES[key]];
    if (value) merged[key] = value;
  }
  if (!merged.base_url || !merged.model) return null;
  return merged;
}

function readFileConfig(): Partial<Config> {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Config): void {
  const dir = join(homedir(), '.cmdhelp');
  mkdirSync(dir, { recursive: true });
  const file = configPath();
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}