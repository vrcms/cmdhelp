import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  getFreeChannel: vi.fn(),
  setFreeChannel: vi.fn(),
}));
vi.mock('../src/ai_client.js', () => ({ complete: vi.fn() }));

import { getFreeChannel, setFreeChannel } from '../src/config.js';
import { complete } from '../src/ai_client.js';
import { completeFree } from '../src/free_client.js';

const getFreeChannelMock = vi.mocked(getFreeChannel);
const setFreeChannelMock = vi.mocked(setFreeChannel);
const completeMock = vi.mocked(complete);

const config = { base_url: 'https://opencode.ai/zen/v1', api_key: 'public', model: 'big-pickle' };
const messages = [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'u' }];

function fail(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status });
}

describe('completeFree', () => {
  beforeEach(() => {
    getFreeChannelMock.mockReset();
    setFreeChannelMock.mockReset();
    completeMock.mockReset();
    getFreeChannelMock.mockReturnValue('public');
  });

  it('public 通道成功：返回文本，不切换通道', async () => {
    completeMock.mockResolvedValueOnce('解释');
    const out = await completeFree(config, messages);
    expect(out).toBe('解释');
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(setFreeChannelMock).not.toHaveBeenCalled();
  });

  it('public 429 后切换 anon 成功：记住 anon 供下次使用', async () => {
    completeMock.mockRejectedValueOnce(fail(429)).mockResolvedValueOnce('匿名解释');
    const out = await completeFree(config, messages);
    expect(out).toBe('匿名解释');
    expect(completeMock).toHaveBeenCalledTimes(2);
    const [, , opts] = completeMock.mock.calls[1] as unknown as [object, object, { headers: Record<string, string>; maxAttempts: number }];
    expect(opts.headers).toMatchObject({
      'User-Agent': 'opencode',
      'HTTP-Referer': 'https://hermes-agent.nousresearch.com',
      'X-Title': 'Hermes Agent',
    });
    expect(opts.headers.Authorization).toBeUndefined();
    expect(setFreeChannelMock).toHaveBeenCalledWith('anon');
  });

  it('两通道均 429：抛错；已记录 anon（默认）时无需写回', async () => {
    getFreeChannelMock.mockReturnValue('anon');
    completeMock.mockRejectedValue(fail(429));
    await expect(completeFree(config, messages)).rejects.toMatchObject({ status: 429 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(setFreeChannelMock).not.toHaveBeenCalled();
  });

  it('记录为 public 且两通道均 429：抛错并回退写回 anon', async () => {
    getFreeChannelMock.mockReturnValue('public');
    completeMock.mockRejectedValue(fail(429));
    await expect(completeFree(config, messages)).rejects.toMatchObject({ status: 429 });
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(setFreeChannelMock).toHaveBeenCalledWith('anon');
  });

  it('上次通道为 anon 时优先走 anon', async () => {
    getFreeChannelMock.mockReturnValue('anon');
    completeMock.mockResolvedValueOnce('anon 解释');
    const out = await completeFree(config, messages);
    expect(out).toBe('anon 解释');
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [, , opts] = completeMock.mock.calls[0] as unknown as [object, object, { headers: Record<string, string> }];
    expect(opts.headers['User-Agent']).toBe('opencode');
    expect(setFreeChannelMock).not.toHaveBeenCalled();
  });

  it('非限流错误（网络失败）不切换通道直接抛出', async () => {
    completeMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(completeFree(config, messages)).rejects.toBeInstanceOf(TypeError);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(setFreeChannelMock).not.toHaveBeenCalled();
  });
});