import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(),
  configPath: vi.fn(() => 'C:/fake/.cmdhelp/config.json'),
  saveConfig: vi.fn(),
}));
vi.mock('../src/help_source.js', () => ({ fetchHelp: vi.fn() }));
vi.mock('../src/ai_client.js', () => ({ complete: vi.fn() }));

import { loadConfig } from '../src/config.js';
import { fetchHelp } from '../src/help_source.js';
import { complete } from '../src/ai_client.js';
import { run } from '../src/cli.js';

const loadConfigMock = vi.mocked(loadConfig);
const fetchHelpMock = vi.mocked(fetchHelp);
const completeMock = vi.mocked(complete);

const CONFIG = { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model: 'llama3.1' };

function capture(prefix: string): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((line: string) => {
    lines.push(`${prefix}${line}`);
    return true;
  }) as never);
  return [lines, spy, errSpy] as unknown as string[];
}

describe('run', () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    fetchHelpMock.mockReset();
    completeMock.mockReset();
  });

  it('坏输入：拒绝并解释白名单规则', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['-rf', '/']);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('不是有效的命令名');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('成功流：帮助可用 + AI 成功 → 直接输出解释', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### 功能\n删除文件');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm', '-rf', '/']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toBe('### 功能\n删除文件');
    expect(fetchHelpMock).toHaveBeenCalledWith('rm');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('帮助不可用 + AI 成功 → 加注通用知识提示', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue(null);
    completeMock.mockResolvedValue('### 功能\n推测');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['foo']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('本地帮助不可用');
    expect(lines.join('\n')).toContain('### 功能\n推测');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('AI 失败但帮助可用 → 打印本地帮助原文并报错', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockRejectedValue(new Error('connection reset'));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('RM(1) manual');
    expect(lines.join('\n')).toContain('AI 调用失败');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('双重失败 → 仅友好报错', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue(null);
    completeMock.mockRejectedValue(new Error('timeout'));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['foo']);
    expect(code).toBe(1);
    expect(lines.join('\n')).not.toContain('manual');
    expect(lines.join('\n')).toContain('AI 调用失败');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('未配置（非 TTY）→ 提示环境变量并退出 3', async () => {
    loadConfigMock.mockReturnValue(null);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(3);
    expect(lines.join('\n')).toContain('CMDHELP_BASE_URL');
    spy.mockRestore();
    errSpy.mockRestore();
  });
});