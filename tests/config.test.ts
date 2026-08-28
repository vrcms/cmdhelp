import { describe, expect, it } from 'vitest';
import { mergeConfig } from '../src/config.js';

const base = { base_url: 'https://api.openai.com/v1', api_key: 'sk-1', model: 'gpt-4o-mini' };

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