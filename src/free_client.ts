import { complete, type AiError, type ChatMessage } from './ai_client.js';
import { getFreeChannel, setFreeChannel, type Config } from './config.js';

const PUBLIC_HEADERS = { 'x-opencode-client': 'desktop' };
const ANON_HEADERS = {
  'x-opencode-client': 'desktop',
  'User-Agent': 'opencode',
  'HTTP-Referer': 'https://hermes-agent.nousresearch.com',
  'X-Title': 'Hermes Agent',
};
const CHANNELS = ['public', 'anon'] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_FAIL_STATUS = new Set([401, 403, 429]);
const ATTEMPTS_PER_CHANNEL = 1;

export async function completeFree(config: Config, messages: ChatMessage[]): Promise<string> {
  const start = getFreeChannel() === 'anon' ? 1 : 0;
  const tried = new Set<Channel>();
  let lastError: unknown = null;
  for (let i = 0; i < CHANNELS.length; i++) {
    const channel = CHANNELS[(start + i) % CHANNELS.length];
    if (tried.has(channel)) continue;
    tried.add(channel);
    try {
      const text = await complete(config, messages, {
        headers: channel === 'public' ? PUBLIC_HEADERS : ANON_HEADERS,
        maxAttempts: ATTEMPTS_PER_CHANNEL,
      });
      if (getFreeChannel() !== channel) setFreeChannel(channel);
      return text;
    } catch (err) {
      lastError = err;
      if (!isChannelFailure(err)) throw err as AiError;
    }
  }
  if (getFreeChannel() !== 'public') setFreeChannel('public');
  throw lastError as AiError;
}

function isChannelFailure(err: unknown): boolean {
  const e = err as AiError;
  return e.status !== undefined && CHANNEL_FAIL_STATUS.has(e.status);
}