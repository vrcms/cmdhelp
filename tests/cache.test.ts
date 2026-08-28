import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, hashHelp, readCache, writeCache, type CacheEntry } from '../src/cache.js';

let tempDir: string;

function entry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    command: 'dir',
    lang: 'cn',
    mode: 'free',
    help: 'DIR(1) manual',
    explanation: '### 功能\n列出目录',
    helpHash: 'abc123',
    createdAt: 1000,
    updatedAt: 1000,
    lastCheckedAt: null,
    changed: false,
    ...overrides,
  };
}

describe('cache', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cmdhelp-cache-'));
    vi.stubEnv('CMDHELP_CACHE_DIR', tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('cacheKey 由命令+语言+模式构成（不同模式/语言互不串扰）', () => {
    expect(cacheKey('dir', 'cn', 'free')).toBe('dir__cn__free');
    expect(cacheKey('dir', 'cn', 'custom')).toBe('dir__cn__custom');
    expect(cacheKey('dir', 'ja', 'free')).toBe('dir__ja__free');
  });

  it('hashHelp 稳定且区分内容', () => {
    const a = hashHelp('manual A');
    expect(a).toBe(hashHelp('manual A'));
    expect(a).not.toBe(hashHelp('manual B'));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(hashHelp(null)).not.toBe(a);
  });

  it('写读回环：完整字段持久化', () => {
    const e = entry();
    writeCache(e);
    expect(readCache('dir__cn__free')).toEqual(e);
  });

  it('不存在的键返回 null', () => {
    expect(readCache('nope__cn__free')).toBeNull();
  });

  it('损坏或非法的缓存文件返回 null（不崩溃）', () => {
    writeFileSync(join(tempDir, 'dir__cn__free.json'), '{not json', 'utf8');
    expect(readCache('dir__cn__free')).toBeNull();

    writeFileSync(join(tempDir, 'bad__cn__free.json'), '{"help":"x"}', 'utf8');
    expect(readCache('bad__cn__free')).toBeNull();
  });
});