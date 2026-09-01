import { describe, expect, it } from 'vitest';
import {
  buildQuestionPrompt,
  buildQuestionSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  languageName,
} from '../src/prompts.js';

describe('languageName', () => {
  it('常见语言代码映射为对应语言名', () => {
    expect(languageName('cn')).toBe('中文');
    expect(languageName('zh-CN')).toBe('中文');
    expect(languageName('EN')).toBe('英文（English）');
    expect(languageName('ja')).toBe('日语（日本語）');
    expect(languageName('ru')).toBe('俄语（Русский）');
  });

  it('未知代码原样返回', () => {
    expect(languageName('xx')).toBe('xx');
  });
});

describe('buildSystemPrompt', () => {
  it('包含五段输出结构（翻译在前，总结在后）', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('### 帮助原文逐行对照翻译');
    expect(p).toContain('### 功能');
    expect(p).toContain('### 常用参数');
    expect(p).toContain('### 常用范例');
    expect(p).toContain('### 特别提示');
    expect(p).toContain('本地帮助不可用');
    // 翻译小节在功能小节之前
    expect(p.indexOf('### 帮助原文逐行对照翻译')).toBeLessThan(p.indexOf('### 功能'));
  });

  it('按指定语言输出', () => {
    expect(buildSystemPrompt('en')).toContain('英文（English）');
    expect(buildSystemPrompt('ja')).toContain('日语（日本語）');
    expect(buildSystemPrompt('cn')).toContain('中文');
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

describe('buildQuestionPrompt', () => {
  it('自然语言提问携带用户问题', () => {
    const p = buildQuestionPrompt('如何列目录');
    expect(p).toContain('如何列目录');
    expect(p).toContain('用户问题');
  });

  it('自然语言系统提示词包含四段结构与语言', () => {
    const p = buildQuestionSystemPrompt('cn');
    expect(p).toContain('### 功能');
    expect(p).toContain('### 常用参数');
    expect(p).toContain('### 常用范例');
    expect(p).toContain('### 特别提示');
    expect(p).toContain('中文');
  });

  it('英文系统提示词正确', () => {
    expect(buildQuestionSystemPrompt('en')).toContain('英文（English）');
  });
});