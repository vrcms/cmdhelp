import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CacheEntry {
  command: string;
  lang: string;
  mode: string;
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