import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dimLine, formatExplanation } from '../src/format.js';

const input = `### 功能
删除文件，常用 \`-rf\` 强制递归。

### 常用参数
- \`-r\` —— 递归删除
- \`-f\` —— 忽略不存在文件

### 示例
\`\`\`
rm -rf tmp
\`\`\`

注：以下基于通用知识，可能与当前系统版本有差异。`;

describe('formatExplanation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('非 TTY 环境不输出任何 ANSI 转义码', () => {
    const out = formatExplanation(input);
    expect(out).not.toContain('\u001b[');
    expect(out).toBe(input);
  });

  it('FORCE_COLOR=1 时分节标题着色', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    const out = formatExplanation(input);
    expect(out).toContain('\u001b[32;1m### 功能\u001b[0m');
    expect(out).toContain('\u001b[33;1m### 常用参数\u001b[0m');
    expect(out).toContain('\u001b[34;1m### 示例\u001b[0m');
  });

  it('FORCE_COLOR=1 时内联参数名与提示行着色', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    const out = formatExplanation(input);
    expect(out).toContain('\u001b[36m-r\u001b[0m');
    expect(out).toContain('\u001b[36m-rf\u001b[0m');
    expect(out).toContain('\u001b[2m注：以下基于通用知识');
  });

  it('NO_COLOR 优先于 FORCE_COLOR 强制无色', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    vi.stubEnv('NO_COLOR', '1');
    const out = formatExplanation(input);
    expect(out).not.toContain('\u001b[');
  });

  it('dimLine 非 TTY 无色，FORCE_COLOR 时置灰', () => {
    expect(dimLine('a')).toBe('a');
    vi.stubEnv('FORCE_COLOR', '1');
    expect(dimLine('a')).toBe('\u001b[2ma\u001b[0m');
  });
});