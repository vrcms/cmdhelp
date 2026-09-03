import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CacheEntry {
  command: string;
  lang: string;
  mode: string;
  /** Windows 同名解析后实际选定的完整路径（按名查询/旧缓存为 null） */
  source?: string | null;
  help: string | null;
  explanation: string;
  helpHash: string;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  changed: boolean;
}

export function cacheKey(command: string, lang: string, mode: string): string {
  return `${command}__${lang}__${mode}`;
}

export function hashHelp(help: string | null): string {
  return createHash('sha1').update(help ?? '').digest('hex').slice(0, 12);
}

export function cacheDir(): string {
  return process.env.CMDHELP_CACHE_DIR ?? join(homedir(), '.cmdhelp', 'cache');
}

function cacheFile(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

export function readCache(key: string): CacheEntry | null {
  try {
    const raw = JSON.parse(readFileSync(cacheFile(key), 'utf8')) as Partial<CacheEntry>;
    if (typeof raw.explanation !== 'string' || typeof raw.helpHash !== 'string') return null;
    return raw as CacheEntry;
  } catch {
    return null;
  }
}

export function writeCache(entry: CacheEntry): void {
  mkdirSync(cacheDir(), { recursive: true });
  const file = cacheFile(cacheKey(entry.command, entry.lang, entry.mode));
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
}

export function clearCache(command?: string): number {
  // 有命令：删除该命令（任意语言/模式）的全部缓存；无命令：清空整个缓存目录
  let removed = 0;
  try {
    const dir = cacheDir();
    const files = readdirSync(dir);
    const prefix = command ? `${command}__` : '';
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      if (!command || name.startsWith(prefix)) {
        rmSync(join(dir, name), { force: true });
        removed += 1;
      }
    }
  } catch {
    // 目录不存在即视为 0 条
  }
  return removed;
}