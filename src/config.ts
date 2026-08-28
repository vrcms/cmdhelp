import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  base_url: string;
  api_key: string;
  model: string;
}

type Mode = 'free' | 'custom';
type FreeChannel = 'public' | 'anon';

interface Settings {
  mode?: Mode;
  free_channel?: FreeChannel;
  lang?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
}

export interface Preset {
  name: string;
  base_url: string;
  model: string;
  need_key: boolean;
  key_hint: string;
}

export const FREE_PRESET: Preset = {
  name: 'OpenCode AI 免费模型（big-pickle，无需注册）',
  base_url: 'https://opencode.ai/zen/v1',
  model: 'big-pickle',
  need_key: false,
  key_hint: '',
};

export const PRESETS: Preset[] = [
  FREE_PRESET,
  {
    name: '智谱 GLM-Flash（免费额度，国内直连）',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    need_key: true,
    key_hint: '在 https://open.bigmodel.cn 注册获取 API 密钥（免费模型长期开放）',
  },
  {
    name: 'Ollama 本地模型（完全免费，需已安装并拉取模型）',
    base_url: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    need_key: false,
    key_hint: '',
  },
  {
    name: 'DeepSeek（低价按量）',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    need_key: true,
    key_hint: '在 https://platform.deepseek.com 注册获取 API 密钥',
  },
  {
    name: '自定义 OpenAI 兼容接口',
    base_url: '',
    model: '',
    need_key: false,
    key_hint: '',
  },
];

const ENV_NAMES: Record<keyof Config, string> = {
  base_url: 'CMDHELP_BASE_URL',
  api_key: 'CMDHELP_API_KEY',
  model: 'CMDHELP_MODEL',
};

export function configPath(): string {
  return join(homedir(), '.cmdhelp', 'config.json');
}

export function loadConfig(): Config | null {
  return mergeConfig(fileConfig(), process.env);
}

export function getMode(): 'free' | 'custom' {
  return fileConfig().mode === 'free' ? 'free' : 'custom';
}

export function setMode(mode: 'free' | 'custom'): void {
  writeSettings({ ...fileConfig(), mode });
}

export function getFreeChannel(): 'public' | 'anon' {
  return fileConfig().free_channel === 'anon' ? 'anon' : 'public';
}

export function setFreeChannel(channel: 'public' | 'anon'): void {
  writeSettings({ ...fileConfig(), free_channel: channel });
}

const DEFAULT_LANG = 'cn';

export function getLang(): string {
  return process.env.CMDHELP_LANG ?? fileConfig().lang ?? DEFAULT_LANG;
}

export function setLang(lang: string): void {
  writeSettings({ ...fileConfig(), lang });
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

function fileConfig(): Settings {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Config): void {
  writeSettings({ ...cfg, mode: 'custom' });
}

function writeSettings(settings: Settings): void {
  const dir = join(homedir(), '.cmdhelp');
  mkdirSync(dir, { recursive: true });
  const file = configPath();
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}