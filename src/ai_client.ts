import type { Config } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiError extends Error {
  status?: number;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 600;
const TEMPERATURE = 0.3;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export async function complete(config: Config, messages: ChatMessage[]): Promise<string> {
  const url = `${config.base_url.replace(/\/+$/, '')}/chat/completions`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(url, config, messages);
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(2_000);
        continue;
      }
      throw err as AiError;
    }
  }
  throw new Error('unreachable');
}

async function requestOnce(
  url: string,
  config: Config,
  messages: ChatMessage[],
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw asAiError(err);
  }
  if (!response.ok) {
    const e = new Error(`AI 服务返回 HTTP ${response.status}`) as AiError;
    e.status = response.status;
    throw e;
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim() === '') {
    throw new NotRetryableError('AI 响应缺少内容字段');
  }
  return content.trim();
}

class NotRetryableError extends Error {}

function isRetryable(err: unknown): boolean {
  if (err instanceof NotRetryableError) return false;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return true;
  }
  const e = err as AiError;
  return e.status === undefined || RETRYABLE_STATUS.has(e.status);
}

function asAiError(err: unknown): AiError {
  if (err instanceof Error) return err as AiError;
  return new Error(String(err));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}