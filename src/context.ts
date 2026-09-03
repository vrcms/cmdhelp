import type { ChatMessage } from './ai_client.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

// 参考 opencode packages/core/src/util/token.ts
// CHARS_PER_TOKEN = 4
const CHARS_PER_TOKEN = 4;
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN));
}
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return estimateTokens(JSON.stringify(messages));
}

// 参考 opencode 真正逻辑：
// overflow.ts: usable = model.limit.context - reserved
//   reserved = min(COMPACTION_BUFFER 20k tokens, maxOutputTokens)
// compaction.ts: preserveRecentBudget = min(15k, max(2k, floor(usable*0.25)))
// 之前把 12k chars 当成整个 context 是看错了，COMPACTION_BUFFER 是预留不是上限
// 常见模型 65k/128k/200k，按 128k 基准；cmdhelp help 约 5k chars，几十轮都不会超
const MODEL_CONTEXT_TOKENS = 128_000;
const COMPACTION_BUFFER_TOKENS = 20_000;
const RESERVED_TOKENS = 4_000; // 覆盖 MAX_TOKENS 1500 + 开销，对齐 maxOutputTokens
const USABLE_TOKENS = MODEL_CONTEXT_TOKENS - Math.min(COMPACTION_BUFFER_TOKENS, RESERVED_TOKENS);
const TAIL_TOKENS = Math.min(15_000, Math.max(2_000, Math.floor(USABLE_TOKENS * 0.25))); // 15k tokens
const MAX_CONTEXT_TOKENS = MODEL_CONTEXT_TOKENS;
const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
const USABLE_CHARS = USABLE_TOKENS * CHARS_PER_TOKEN;
const TAIL_CHARS = TAIL_TOKENS * CHARS_PER_TOKEN;
const MIN_TAIL_TURNS = 2;
const MAX_TAIL_TURNS = 20; // 128k 下保留 20 轮绰绰有余，之前 6 轮是按 8k 误设

export interface ChatContext {
  command: string;
  help: string | null;
  lang: string;
  systemPrompt: string;
  helpPrompt: string; // buildUserPrompt 的结果，作为不可丢弃的 base
  history: ChatMessage[]; // 仅存 user/assistant 来回，不含 system/help
}

export function createContext(
  command: string,
  help: string | null,
  lang: string,
  initialExplanation: string,
  sourceNote?: string | null,
): ChatContext {
  return {
    command,
    help,
    lang,
    systemPrompt: buildSystemPrompt(lang),
    helpPrompt: buildUserPrompt(command, help, sourceNote ?? null),
    history: [{ role: 'assistant', content: initialExplanation }],
  };
}

export function pushTurn(ctx: ChatContext, user: string, assistant: string): void {
  ctx.history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
}

/** 按 opencode turns 思想裁剪：保留 head(base) + 最近 tail，中间丢弃 */
export function buildMessages(ctx: ChatContext, newQuestion?: string): ChatMessage[] {
  const base: ChatMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: ctx.helpPrompt },
  ];
  const baseTokens = estimateMessagesTokens(base);
  const tailBudgetTokens = TAIL_TOKENS;
  // 128k 下 tailBudget 15k tokens 约 60k chars，help 5k + 20轮(20*1k)也仅 25k，基本不裁
  void baseTokens;
  const tailBudget = TAIL_CHARS;
  // 选择尾部历史：从最新往前累计，直至 budget 或轮数上限
  const keep: ChatMessage[] = [];
  let used = 0;
  for (let i = ctx.history.length - 1; i >= 0; ) {
    const turn: ChatMessage[] = [];
    if (i >= 0) {
      turn.unshift(ctx.history[i]!);
      used += estimateTokens(ctx.history[i]!.content);
      i--;
    }
    if (i >= 0 && ctx.history[i]!.role === 'user') {
      turn.unshift(ctx.history[i]!);
      used += estimateTokens(ctx.history[i]!.content);
      i--;
    }
    if (used > tailBudget && keep.length >= MIN_TAIL_TURNS * 2) break;
    keep.unshift(...turn);
    if (keep.length >= MAX_TAIL_TURNS * 2) break;
    if (used > tailBudget && keep.length > 0) break;
  }
  const messages: ChatMessage[] = [...base, ...keep];
  if (newQuestion) messages.push({ role: 'user', content: newQuestion });
  // 兜底：只有总 tokens 真超 128k 才丢弃（基本不会触发）
  while (estimateMessagesTokens(messages) > MAX_CONTEXT_TOKENS && keep.length > 2) {
    keep.splice(0, 2);
    messages.splice(2, 2);
  }
  return messages;
}

/** 调试用：估算当前上下文占用 */
export function contextStats(ctx: ChatContext): string {
  const msgs = buildMessages(ctx);
  const chars = JSON.stringify(msgs).length;
  return `ctx ${estimateTokens(JSON.stringify(msgs))} tokens≈${chars} chars，history ${ctx.history.length} 条`;
}
