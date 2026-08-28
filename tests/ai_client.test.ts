import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complete, type AiError } from '../src/ai_client.js';
import type { Config } from '../src/config.js';

const config: Config = { base_url: 'http://127.0.0.1:11434/v1/', api_key: '', model: 'llama3.1' };
const messages = [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'u' }];

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('complete', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('成功解析 choices[0].message.content', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '  ### 功能\n 内容  ' } }] }));
    const out = await complete(config, messages);
    expect(out).toBe('### 功能\n 内容');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('llama3.1');
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(600);
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('有 api_key 时携带 Bearer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'x' } }] }));
    await complete({ ...config, api_key: 'sk-test' }, messages);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('HTTP 429 后重试一次并成功', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }));
    const out = await complete(config, messages);
    expect(out).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('连续失败后抛出带 status 的错误', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}));
    await expect(complete(config, messages)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('网络错误重试后仍抛出', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(complete(config, messages)).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('响应缺少 content 时抛出', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [] }));
    await expect(complete(config, messages)).rejects.toThrow('缺少内容');
  });

  it('非重试状态（400）不重试直接抛出', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, {}));
    const err = (await complete(config, messages).catch((e: AiError) => e)) as AiError;
    expect(err.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('可携带自定义头（free 模式 x-opencode-client）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }));
    await complete(config, messages, { headers: { 'x-opencode-client': 'desktop' } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-opencode-client']).toBe('desktop');
  });

  it('maxAttempts 覆盖重试次数（429 重试到上限后抛出）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    await expect(complete(config, messages, { maxAttempts: 3 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15_000);
});