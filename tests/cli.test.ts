import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(),
  configPath: vi.fn(() => 'C:/fake/.cmdhelp/config.json'),
  saveConfig: vi.fn(),
  getMode: vi.fn(),
  setMode: vi.fn(),
  getLang: vi.fn(() => 'cn'),
  setLang: vi.fn(),
  FREE_PRESET: {
    name: 'OpenCode AI 免费模型（big-pickle，无需注册）',
    base_url: 'https://opencode.ai/zen/v1',
    model: 'big-pickle',
    need_key: false,
    key_hint: '',
  },
  PRESETS: [
    { name: 'fake preset', base_url: 'http://fake/v1', model: 'm', need_key: false, key_hint: '' },
  ],
}));

vi.mock('../src/help_source.js', () => ({ fetchHelp: vi.fn() }));
vi.mock('../src/ai_client.js', () => ({ complete: vi.fn() }));
vi.mock('../src/free_client.js', () => ({ completeFree: vi.fn() }));

import { getLang, getMode, loadConfig, setLang, setMode } from '../src/config.js';
import { fetchHelp } from '../src/help_source.js';
import { complete } from '../src/ai_client.js';
import { completeFree } from '../src/free_client.js';
import { run } from '../src/cli.js';

const loadConfigMock = vi.mocked(loadConfig);
const fetchHelpMock = vi.mocked(fetchHelp);
const completeMock = vi.mocked(complete);
const completeFreeMock = vi.mocked(completeFree);
const getLangMock = vi.mocked(getLang);
const setLangMock = vi.mocked(setLang);
const getModeMock = vi.mocked(getMode);
const setModeMock = vi.mocked(setMode);

const CONFIG = { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model: 'llama3.1' };

function capture(prefix: string): unknown[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((line: string) => {
    lines.push(String(line));
    return true;
  }) as never);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((line: string) => {
    lines.push(`${prefix}${line}`);
    return true;
  }) as never);
  return [lines, spy, errSpy, stdoutSpy] as unknown as string[];
}

describe('run', () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    fetchHelpMock.mockReset();
    completeMock.mockReset();
    completeFreeMock.mockReset();
    getLangMock.mockReturnValue('cn');
    setLangMock.mockReset();
    getModeMock.mockReturnValue('custom');
    setModeMock.mockReset();
  });

  it('坏输入：拒绝并解释白名单规则', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['-rf', '/']);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('不是有效的命令名');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('成功流：帮助原文 + 分隔线 + AI 解释', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### 功能\n删除文件');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm', '-rf', '/']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('RM(1) manual');
    expect(out).toContain('────────');
    expect(out).toContain('### 功能\n删除文件');
    expect(out.indexOf('RM(1) manual')).toBeLessThan(out.indexOf('### 功能'));
    expect(fetchHelpMock).toHaveBeenCalledWith('rm');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('语言设置传入 AI（en 时提示词使用英文）', async () => {
    getLangMock.mockReturnValue('en');
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### Description\nDelete files');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('### Description');
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
    expect(lines.join('\n')).toContain('本地帮助原文');
    expect(lines.join('\n')).toContain('AI 调用失败');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('lang 查看当前语言', async () => {
    getLangMock.mockReturnValue('ja');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['lang']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('ja');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('lang 切换语言并持久化', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['lang', 'ja']);
    expect(code).toBe(0);
    expect(setLangMock).toHaveBeenCalledWith('ja');
    expect(lines.join('\n')).toContain('已切换为 ja');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('lang 拒绝非法代码', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['lang', 'e-1']);
    expect(code).toBe(2);
    expect(setLangMock).not.toHaveBeenCalled();
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

  it('setup 在非 TTY 环境报错并提示环境变量', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['setup']);
    expect(code).toBe(3);
    expect(lines.join('\n')).toContain('交互终端');
    expect(lines.join('\n')).toContain('CMDHELP_BASE_URL');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('--version 输出版本号', async () => {
    const [lines, spy, errSpy] = capture('');
    const code = await run(['--version']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/^\d+\.\d+\.\d+$/);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('--help 输出支持 opencode 的呼吁文案', async () => {
    const [lines, spy, errSpy] = capture('');
    const code = await run(['--help']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('请支持opencode，仅需10$');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('free on 持久化开启免费模式', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['free', 'on']);
    expect(code).toBe(0);
    expect(setModeMock).toHaveBeenCalledWith('free');
    expect(lines.join('\n')).toContain('已开启免费模式');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('free off 关闭免费模式', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['free', 'off']);
    expect(code).toBe(0);
    expect(setModeMock).toHaveBeenCalledWith('custom');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('free 无参数显示当前状态', async () => {
    getModeMock.mockReturnValue('free');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['free']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('已开启');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('free 后跟非法参数报用法', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['free', 'xxx']);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('free on | off');
    expect(setModeMock).not.toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('免费模式开启时查询自动走 OpenCode 免费池（通道切换）', async () => {
    getModeMock.mockReturnValue('free');
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeFreeMock.mockResolvedValue('### 功能\n免费解释');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('免费解释');
    expect(loadConfigMock).not.toHaveBeenCalled();
    const [config] = completeFreeMock.mock.calls[0] as unknown as [object];
    expect(config).toMatchObject({ base_url: 'https://opencode.ai/zen/v1', api_key: 'public', model: 'big-pickle' });
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('免费模式查询遇 429 给出限流专属提示', async () => {
    getModeMock.mockReturnValue('free');
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeFreeMock.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('免费模型当前限流');
    spy.mockRestore();
    errSpy.mockRestore();
  });
});