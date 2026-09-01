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

// 参考 opencode session/overflow.ts + compaction.ts 的 preserveRecentBudget
// big-pickle 未公布 context，按 8k 保守估算；可用区 = context - reserved(max_tokens/预留)
// 单次交互只保留最近若干轮，避免每次都重发 help 全文
const MAX_CONTEXT_CHARS = 12_000; // 约 3k tokens，留足输入+输出
const RESERVED_CHARS = 6_000; // 约 1.5k tokens 给输出
const USABLE_CHARS = MAX_CONTEXT_CHARS - RESERVED_CHARS;
const MIN_TAIL_TURNS = 2;
const MAX_TAIL_TURNS = 6;

export interface ChatContext {
  command: string;
  help: string | null;
  lang: string;
  systemPrompt: string;
  helpPrompt: string; // buildUserPrompt 的结果，作为不可丢弃的 base
  history: ChatMessage[]; // 仅存 user/assistant 来回，不含 system/help
}

export function createContext(command: string, help: string | null, lang: string, initialExplanation: string): ChatContext {
  return {
    command,
    help,
    lang,
    systemPrompt: buildSystemPrompt(lang),
    helpPrompt: buildUserPrompt(command, help),
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
  const tailBudget = USABLE_CHARS - estimateMessagesTokens(base);
  // 选择尾部历史：从最新往前累计，直至 budget 或轮数上限
  const keep: ChatMessage[] = [];
  let used = 0;
  // history 已经是 [assistant, user, assistant, ...] 交替，取整轮
  // 为简化：从尾部每次取 2 条（一问一答），最后可能剩单条 assistant
  for (let i = ctx.history.length - 1; i >= 0; ) {
    const turn: ChatMessage[] = [];
    // 取 assistant
    if (i >= 0) {
      turn.unshift(ctx.history[i]!);
      used += estimateTokens(ctx.history[i]!.content);
      i--;
    }
    // 取对应的 user
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
  // 兜底：若仍超限，丢弃最早的 keep 轮次（opencode prune 思想简化版）
  while (estimateMessagesTokens(messages) * CHARS_PER_TOKEN > MAX_CONTEXT_CHARS && keep.length > 2) {
    // 每次丢 2 条
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
