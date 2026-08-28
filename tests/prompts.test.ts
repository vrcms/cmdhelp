import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../src/prompts.js';

describe('buildSystemPrompt', () => {
  it('包含三段输出结构与来源标注约束', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('### 功能');
    expect(p).toContain('### 常用参数');
    expect(p).toContain('### 示例');
    expect(p).toContain('本地帮助不可用');
  });
});

describe('buildUserPrompt', () => {
  it('帮助可用时携带本地帮助原文', () => {
    const p = buildUserPrompt('rm', 'RM(1)  manual page');
    expect(p).toContain('命令名：rm');
    expect(p).toContain('【本地帮助】');
    expect(p).toContain('RM(1)  manual page');
  });

  it('帮助不可用时标记回退分支', () => {
    const p = buildUserPrompt('foo', null);
    expect(p).toContain('命令名：foo');
    expect(p).toContain('【本地帮助不可用】');
  });
});