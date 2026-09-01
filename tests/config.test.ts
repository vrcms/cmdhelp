import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import {
  PRESETS,
  getFreeChannel,
  getLang,
  getMode,
  mergeConfig,
  setFreeChannel,
  setLang,
  setMode,
} from '../src/config.js';

const readMock = vi.mocked(readFileSync);
const writeMock = vi.mocked(writeFileSync);

const base = { base_url: 'https://api.openai.com/v1', api_key: 'sk-1', model: 'gpt-4o-mini' };

describe('PRESETS', () => {
  it('预设表非空且字段完整（供 setup 向导使用）', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.need_key).toBe('boolean');
      expect(typeof p.key_hint).toBe('string');
    }
  });

  it('首个预设为免费服务且 base_url/model 齐全', () => {
    const first = PRESETS[0];
    expect(first.base_url).toMatch(/^https?:\/\//);
    expect(first.model.length).toBeGreaterThan(0);
  });
});

describe('mergeConfig', () => {
  it('无环境变量时使用文件配置', () => {
    expect(mergeConfig(base, {})).toEqual(base);
  });

  it('环境变量覆盖文件配置', () => {
    const cfg = mergeConfig(base, {
      CMDHELP_BASE_URL: 'http://127.0.0.1:11434/v1',
      CMDHELP_MODEL: 'llama3.1',
    });
    expect(cfg).toEqual({ ...base, base_url: 'http://127.0.0.1:11434/v1', model: 'llama3.1' });
  });

  it('环境变量补全文件缺失字段', () => {
    const cfg = mergeConfig({ base_url: 'http://127.0.0.1:11434/v1' }, { CMDHELP_MODEL: 'qwen' });
    expect(cfg).toEqual({ base_url: 'http://127.0.0.1:11434/v1', api_key: undefined, model: 'qwen' });
  });

  it('base_url 或 model 缺失时视为未配置', () => {
    expect(mergeConfig({ api_key: 'k' }, {})).toBeNull();
    expect(mergeConfig({ base_url: 'http://x/v1' }, {})).toBeNull();
  });
});

describe('getMode / setMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无配置文件时默认为 custom 模式', () => {
    readMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getMode()).toBe('custom');
  });

  it('配置文件 mode=free 时返回 free', () => {
    readMock.mockReturnValue('{"mode":"free"}' as never);
    expect(getMode()).toBe('free');
  });

  it('setMode 保留已有配置字段并写入 mode', () => {
    readMock.mockReturnValue('{"base_url":"http://x/v1","model":"m"}' as never);
    setMode('free');
    const [, content] = writeMock.mock.calls[0] as unknown as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({ base_url: 'http://x/v1', model: 'm', mode: 'free' });
  });

  it('免费通道默认 anon（与 opencode 桌面端一致）', () => {
    readMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getFreeChannel()).toBe('anon');
  });

  it('免费通道读取自由通道记录', () => {
    readMock.mockReturnValue('{"free_channel":"anon"}' as never);
    expect(getFreeChannel()).toBe('anon');
  });

  it('setFreeChannel 保留 mode 与其他字段', () => {
    readMock.mockReturnValue('{"mode":"free","base_url":"http://x/v1","model":"m"}' as never);
    setFreeChannel('anon');
    const [, content] = writeMock.mock.calls[0] as unknown as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({ mode: 'free', base_url: 'http://x/v1', model: 'm', free_channel: 'anon' });
  });
});

describe('getLang / setLang', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('无配置无环境变量时默认中文 cn', () => {
    readMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getLang()).toBe('cn');
  });

  it('读配置文件语言', () => {
    readMock.mockReturnValue('{"lang":"ja"}' as never);
    expect(getLang()).toBe('ja');
  });

  it('环境变量 CMDHELP_LANG 覆盖文件配置', () => {
    readMock.mockReturnValue('{"lang":"ja"}' as never);
    vi.stubEnv('CMDHELP_LANG', 'en');
    expect(getLang()).toBe('en');
  });

  it('setLang 保留其他字段', () => {
    readMock.mockReturnValue('{"mode":"free","free_channel":"anon"}' as never);
    setLang('fr');
    const [, content] = writeMock.mock.calls[0] as unknown as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({ mode: 'free', free_channel: 'anon', lang: 'fr' });
  });
});