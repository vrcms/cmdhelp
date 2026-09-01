import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/update.js', () => ({ spawnUpdateCheck: vi.fn() }));

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
vi.mock('../src/cache.js', async () => {
  const actual = await import('../src/cache.js');
  return {
    ...actual,
    readCache: vi.fn(),
    writeCache: vi.fn(),
    clearCache: vi.fn(),
  };
});
vi.mock('node:child_process', async () => {
  const actual = await import('node:child_process');
  return { ...actual, spawn: vi.fn(() => ({ unref: vi.fn() })) };
});

import { getLang, getMode, loadConfig, setLang, setMode } from '../src/config.js';
import { fetchHelp } from '../src/help_source.js';
import { complete } from '../src/ai_client.js';
import { completeFree } from '../src/free_client.js';
import { readCache, writeCache, clearCache, hashHelp } from '../src/cache.js';
import { spawn } from 'node:child_process';
import { run } from '../src/cli.js';

const loadConfigMock = vi.mocked(loadConfig);
const fetchHelpMock = vi.mocked(fetchHelp);
const completeMock = vi.mocked(complete);
const completeFreeMock = vi.mocked(completeFree);
const getLangMock = vi.mocked(getLang);
const setLangMock = vi.mocked(setLang);
const getModeMock = vi.mocked(getMode);
const setModeMock = vi.mocked(setMode);
const readCacheMock = vi.mocked(readCache);
const writeCacheMock = vi.mocked(writeCache);
const clearCacheMock = vi.mocked(clearCache);
const spawnMock = vi.mocked(spawn);

const CONFIG = { base_url: 'http://127.0.0.1:11434/v1', api_key: '', model: 'llama3.1' };const CACHED = {
  command: 'rm',
  lang: 'cn',
  mode: 'custom',
  help: 'RM(1) manual',
  explanation: '### 功能\n删除文件（缓存版）\n' + '### 帮助原文逐行对照翻译\nRM(1) manual\n删除文件手册',
  helpHash: 'oldhash',
  createdAt: 1000,
  updatedAt: 1000,
  lastCheckedAt: null,
  changed: false,
};

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
    readCacheMock.mockReset();
    writeCacheMock.mockReset();
    clearCacheMock.mockReset();
    spawnMock.mockReset();
  });

  it('坏输入：拒绝并解释白名单规则', async () => {
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['-rf', '/']);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('不是有效的命令名');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('成功流：只输出 AI 解释（含翻译对照，不再展示独立原版帮助）', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue(
      '### 帮助原文逐行对照翻译\nRM(1) manual\n删除文件手册\n' +
        '### 功能\n删除文件\n' +
        '### 常用范例\n示例',
    );
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm', '-rf', '/']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('### 功能\n删除文件');
    expect(out).toContain('删除文件手册');
    expect(out).not.toContain('────────'); // 不再有分隔线，也不再单独展示原版帮助
    expect(fetchHelpMock).toHaveBeenCalledWith('rm');
    expect(writeCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'rm', lang: 'cn', mode: 'custom', helpHash: expect.any(String), changed: false }),
    );
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('缓存命中（无变化）→ 秒出缓存并后台 spawn refresh', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue({ ...CACHED, helpHash: hashHelp('RM(1) manual') });
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('删除文件（缓存版）');
    expect(out).toContain('### 帮助原文逐行对照翻译'); // 缓存解释自带翻译小节
    expect(out).toContain('缓存');
    expect(out).toContain('后台校验');
    expect(completeMock).not.toHaveBeenCalled();
    expect(fetchHelpMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]![1]).toEqual(expect.arrayContaining([expect.stringContaining('refresh'), 'rm']));
    expect(spawnMock.mock.calls[0]![2]).toMatchObject({ detached: true, windowsHide: true, stdio: 'ignore' });
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('缓存命中但后台已检测到变化 → 直接输出新结果并清除 changed 标记', async () => {
    readCacheMock.mockReturnValue({
      ...CACHED,
      changed: true,
      explanation: '### 帮助原文逐行对照翻译\nRM(1) manual\n新翻译\n### 功能\n新解释',
    });
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('新解释');
    expect(out).toContain('有更新');
    expect(writeCacheMock).toHaveBeenCalledWith(expect.objectContaining({ changed: false }));
    expect(fetchHelpMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('缓存缺失时查到的帮助写入缓存（hash 基于帮助原文）', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### 功能\n删除文件');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const entry = writeCacheMock.mock.calls[0]![0];
    expect(entry.helpHash).toBe(hashHelp('RM(1) manual'));
    expect(entry.explanation).toBe('### 功能\n删除文件');
    expect(entry.createdAt).toBeGreaterThan(0);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('refresh：帮助无变化 → 仅更新 lastCheckedAt 且不重写解释', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue({ ...CACHED, helpHash: hashHelp('RM(1) manual') });
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['refresh', 'rm']);
    expect(code).toBe(0);
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
    const entry = writeCacheMock.mock.calls[0]![0];
    expect(entry.changed).toBe(false);
    expect(entry.lastCheckedAt).toBeGreaterThan(0);
    expect(completeMock).not.toHaveBeenCalled();
    expect(fetchHelpMock).toHaveBeenCalledWith('rm');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('refresh：帮助有变化 → 重新生成解释并标记 changed', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue({ ...CACHED, helpHash: 'oldhash' });
    fetchHelpMock.mockResolvedValue('RM(1) manual v2');
    completeMock.mockResolvedValue('### 功能\n新版本解释');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['refresh', 'rm', 'x']);
    expect(code).toBe(0);
    const entry = writeCacheMock.mock.calls[0]![0];
    expect(entry.changed).toBe(true);
    expect(entry.help).toBe('RM(1) manual v2');
    expect(entry.explanation).toBe('### 功能\n新版本解释');
    expect(entry.helpHash).not.toBe('oldhash');
    expect(completeMock).toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('refresh：无缓存时静默退出', async () => {
    readCacheMock.mockReturnValue(null);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['refresh', 'rm']);
    expect(code).toBe(0);
    expect(fetchHelpMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('刷新期间 AI 失败 → 保留旧缓存仅记录检查时间', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue({ ...CACHED, helpHash: 'oldhash' });
    fetchHelpMock.mockResolvedValue('RM(1) manual v2');
    completeMock.mockRejectedValue(new Error('boom'));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['refresh', 'rm']);
    expect(code).toBe(0);
    const entry = writeCacheMock.mock.calls[0]![0];
    expect(entry.changed).toBe(false);
    expect(entry.explanation).toContain('删除文件（缓存版）');
    expect(entry.help).toBe('RM(1) manual');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('首次查询显示两阶段进度反馈（stderr）', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### 功能\n删除文件');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('正在查询本地帮助（rm）…');
    expect(out).toContain('正在生成 AI 通俗解释…');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('语言设置传入 AI（en 时提示词使用英文）', async () => {
    getLangMock.mockReturnValue('en');
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### Description\nDelete files');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('### Description');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('帮助不可用 + AI 成功 → 直接输出 AI 解释', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    fetchHelpMock.mockResolvedValue(null);
    completeMock.mockResolvedValue('### 功能\n推测');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['foo']);
    expect(code).toBe(0);
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

  it('clear 指定命令 → 删除该命令全部语言/模式缓存', async () => {
    clearCacheMock.mockReturnValue(2);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['clear', 'ssh']);
    expect(code).toBe(0);
    expect(clearCacheMock).toHaveBeenCalledWith('ssh');
    expect(lines.join('\n')).toContain('已清除 ssh 的缓存（2 条');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('-clear 别名同样可用（用户提议的写法）', async () => {
    clearCacheMock.mockReturnValue(1);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['-clear', 'ssh']);
    expect(code).toBe(0);
    expect(clearCacheMock).toHaveBeenCalledWith('ssh');
    expect(lines.join('\n')).toContain('已清除 ssh 的缓存');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('clear 不带参数 → 清空全部缓存', async () => {
    clearCacheMock.mockReturnValue(5);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['clear']);
    expect(code).toBe(0);
    expect(clearCacheMock).toHaveBeenCalledWith();
    expect(lines.join('\n')).toContain('已清除全部缓存（5 条）');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('clear 目标命令无缓存 → 友好提示', async () => {
    clearCacheMock.mockReturnValue(0);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['clear', 'nope']);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('没有找到 nope 的缓存');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('clear 非法命令名 → 报错并退出 2', async () => {
    clearCacheMock.mockReturnValue(0);
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['clear', '-rf', '/']);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('不是有效的命令名');
    expect(clearCacheMock).not.toHaveBeenCalled();
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

  it('帮助原文超长时，仅完整帮助交给 AI，输出不再显示原版帮助', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    const longHelp = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n');
    fetchHelpMock.mockResolvedValue(longHelp);
    completeMock.mockResolvedValue('### 功能\n删除文件');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).not.toContain('line 1');      // 输出不展示原版帮助
    expect(out).not.toContain('此处仅显示前 60 行');
    expect(fetchHelpMock).toHaveBeenCalledWith('rm'); // 完整帮助已交给 AI
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('AI 解释失败时兜底展示截断的帮助原文', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    const longHelp = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n');
    fetchHelpMock.mockResolvedValue(longHelp);
    completeMock.mockRejectedValue(new Error('boom'));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(1);
    const out = lines.join('\n');
    expect(out).toContain('line 1');
    expect(out).toContain('line 60');
    expect(out).not.toContain('line 61');
    expect(out).toContain('此处仅显示前 60 行');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('帮助原文 60 行以内协底完整显示不截断', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    const shortHelp = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    fetchHelpMock.mockResolvedValue(shortHelp);
    completeMock.mockRejectedValue(new Error('boom'));
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(1);
    const out = lines.join('\n');
    expect(out).toContain('line 30');
    expect(out).not.toContain('此处仅显示前 60 行');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('旧版缓存（无翻译小节）被视为失效，强制用新格式重新生成', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue({ ...CACHED, explanation: '### 功能\n旧版内容' });
    fetchHelpMock.mockResolvedValue('RM(1) manual');
    completeMock.mockResolvedValue('### 帮助原文逐行对照翻译\nRM(1) manual\n翻译\n### 功能\n新版内容');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['rm']);
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('旧版缓存');
    expect(out).toContain('新版内容');
    expect(out).not.toContain('旧版内容');
    expect(writeCacheMock).toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('自然语言提问（中文）直接走 AI，不查本地帮助', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    completeMock.mockResolvedValue('### 功能\n列目录的核心是 ls/dir');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['如何列目录']);
    expect(code).toBe(0);
    expect(fetchHelpMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    const messages = completeMock.mock.calls[0]![1] as Array<{ content: string }>;
    expect(messages[1].content).toContain('如何列目录');
    expect(lines.join('\n')).toContain('列目录');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('自然语言提问（英文 how to）直接走 AI', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    readCacheMock.mockReturnValue(null);
    completeMock.mockResolvedValue('### 功能\nList files');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['how', 'to', 'list', 'files?']);
    expect(code).toBe(0);
    expect(fetchHelpMock).not.toHaveBeenCalled();
    const messages = completeMock.mock.calls[0]![1] as Array<{ content: string }>;
    expect(messages[1].content).toContain('how to list files?');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('自然语言提问在免费模式下走免费池', async () => {
    getModeMock.mockReturnValue('free');
    completeFreeMock.mockResolvedValue('### 功能\n免费回答');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['如何列目录']);
    expect(code).toBe(0);
    expect(completeFreeMock).toHaveBeenCalled();
    expect(fetchHelpMock).not.toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('含中文的长句即使首 token 合法也视为提问', async () => {
    loadConfigMock.mockReturnValue(CONFIG);
    completeMock.mockResolvedValue('### 功能\n回答');
    const [lines, spy, errSpy] = capture('ERR:');
    const code = await run(['如何', '使用', 'git', 'clone']);
    expect(code).toBe(0);
    expect(fetchHelpMock).not.toHaveBeenCalled();
    spy.mockRestore();
    errSpy.mockRestore();
  });
});