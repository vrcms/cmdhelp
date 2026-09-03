import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSourceNote,
  fetchHelp,
  fetchHelpDetailed,
  resolveWindowsCommand,
  runExeHelp,
  validateExecutablePath,
} from '../src/help_source.js';

const spawnMock = vi.mocked(spawn);

interface FakeChild {
  stdout: { on: (ev: string, cb: (chunk: Buffer) => void) => void };
  stderr: { on: (ev: string, cb: (chunk: Buffer) => void) => void };
  on: (ev: string, cb: (exit: number | null, signal: string | null) => void) => void;
  kill: ReturnType<typeof vi.fn> & { mock: unknown };
}

function makeChild(opts: {
  data?: string[];
  errData?: string[];
  exitCode?: number | null;
  signal?: string | null;
  emitError?: boolean;
}): ChildProcess {
  let closeCb: ((exit: number | null, signal: string | null) => void) | null = null;
  const child = {
    stdout: {
      on: (_ev: string, cb: (chunk: Buffer) => void) => {
        if (opts.data) {
          for (const d of opts.data) cb(Buffer.from(d, 'utf8'));
        }
      },
    },
    stderr: {
      on: (_ev: string, cb: (chunk: Buffer) => void) => {
        if (opts.errData) {
          for (const d of opts.errData) cb(Buffer.from(d, 'utf8'));
        }
      },
    },
    on: (_ev: string, cb: (exit: number | null, signal: string | null) => void) => {
      if (_ev === 'error') {
        if (opts.emitError) cb(null, null);
      } else if (_ev === 'close') {
        closeCb = cb;
        if (!opts.emitError) cb(opts.exitCode ?? 0, opts.signal ?? null);
      }
    },
    kill: vi.fn(() => {
      if (closeCb) closeCb(null, opts.signal ?? 'SIGTERM');
    }),
  };
  return child as unknown as ChildProcess;
}

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('fetchHelp (POSIX)', () => {
  beforeEach(() => {
    setPlatform('linux');
    spawnMock.mockReset();
  });

  it('调用 man 并传 MANPAGER/MANWIDTH 环境', async () => {
    spawnMock.mockReturnValue(makeChild({ data: ['RM(1)  User Commands\n\nNAME\n  rm\n'], exitCode: 0 }));
    const help = await fetchHelp('rm');
    expect(help).toContain('RM(1)');
    const [file, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(file).toBe('man');
    expect(args).toEqual(['rm']);
    expect(opts.env.MANPAGER).toBe('cat');
    expect(opts.env.MANWIDTH).toBe('120');
  });

  it('无此命令（退出码非零且无输出）时返回 null', async () => {
    spawnMock.mockReturnValue(makeChild({ exitCode: 1 }));
    expect(await fetchHelp('nosuchcmd')).toBeNull();
  });

  it('spawn 失败（ENOENT）时返回 null', async () => {
    spawnMock.mockReturnValue(makeChild({ emitError: true }));
    expect(await fetchHelp('man')).toBeNull();
  });

  it('输出超限被 kill 时返回已捕获前段', async () => {
    const chunk = 'x'.repeat(1_000);
    spawnMock.mockReturnValue(makeChild({ data: Array(30).fill(chunk), exitCode: null, signal: 'SIGTERM' }));
    const help = await fetchHelp('bigcmd');
    expect(help).not.toBeNull();
    expect(help!.startsWith(chunk)).toBe(true);
    const child = spawnMock.mock.results[0].value as unknown as { kill: ReturnType<typeof vi.fn> };
    expect(child.kill).toHaveBeenCalled();
  });

  it('超时被杀（少量输出）时返回 null', async () => {
    spawnMock.mockReturnValue(makeChild({ data: ['partial'], exitCode: null, signal: 'SIGTERM' }));
    expect(await fetchHelp('slow')).toBeNull();
  });

  it('输出为空时返回 null', async () => {
    spawnMock.mockReturnValue(makeChild({ data: ['   \n\n'], exitCode: 0 }));
    expect(await fetchHelp('empty')).toBeNull();
  });

  it('退出码非零但 stdout 有内容时按失败处理', async () => {
    spawnMock.mockReturnValue(makeChild({ data: ['stray output'], exitCode: 2 }));
    expect(await fetchHelp('odd')).toBeNull();
  });
});

describe('fetchHelp (Windows)', () => {
  beforeEach(() => {
    setPlatform('win32');
    spawnMock.mockReset();
  });

  it('优先调用 help.exe，命中时短路不调 man/Get-Help', async () => {
    spawnMock.mockReturnValueOnce(makeChild({ data: ['DIR - Displays files\nDIR [drive:][path][filename]\n'], exitCode: 0 }));
    const help = await fetchHelp('dir');
    expect(help).toContain('DIR');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [file, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(file).toBe('help');
    expect(args).toEqual(['dir']);
    expect(opts.windowsHide).toBe(true);
  });

  it('help 返回不支持提示（exit 0）时视为未命中并回退 man', async () => {
    spawnMock.mockReturnValueOnce(
      makeChild({ data: ['This command is not supported by the help utility. Try "git /?".'], exitCode: 0 }),
    );
    spawnMock.mockReturnValueOnce(makeChild({ data: ['GIT(1) General Commands'], exitCode: 0 }));
    const help = await fetchHelp('git');
    expect(help).toContain('GIT(1)');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('help 未命中时回退 man，man 命中时不调 Get-Help', async () => {
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 1 }));
    spawnMock.mockReturnValueOnce(makeChild({ data: ['GIT(1) General Commands Manual\nNAME\n  git\n'], exitCode: 0 }));
    const help = await fetchHelp('git');
    expect(help).toContain('GIT(1)');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [file1] = spawnMock.mock.calls[0] as unknown as [string];
    const [file2, args2, opts2] = spawnMock.mock.calls[1] as unknown as [string, string[], { env: NodeJS.ProcessEnv; windowsHide: boolean }];
    expect(file1).toBe('help');
    expect(file2).toBe('man');
    expect(args2).toEqual(['git']);
    expect(opts2.env.MANPAGER).toBe('cat');
    expect(opts2.env.MANWIDTH).toBe('120');
    expect(opts2.windowsHide).toBe(true);
  });

  it('help/man 均未命中时回退 Get-Help 且命令名安全插值', async () => {
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 1 }));
    spawnMock.mockReturnValueOnce(makeChild({ emitError: true }));
    spawnMock.mockReturnValueOnce(makeChild({ data: ['NAME\n    Get-ChildItem\nSYNOPSIS\n    gets items\n'], exitCode: 0 }));
    const help = await fetchHelp('Get-ChildItem');
    expect(help).toContain('Get-ChildItem');
    expect(spawnMock).toHaveBeenCalledTimes(3);
    const [file, args, opts] = spawnMock.mock.calls[2] as unknown as [string, string[], Record<string, unknown>];
    expect(file).toBe('powershell');
    expect(args[0]).toBe('-NoProfile');
    expect(args[2]).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8');
    expect(args[2]).toContain('Get-Help Get-ChildItem -Full | Out-String -Width 200');
    expect(opts.windowsHide).toBe(true);
  });

  it('三级均失败时返回 null', async () => {
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 1 }));
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 1 }));
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 1 }));
    expect(await fetchHelp('nosuch123')).toBeNull();
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it('help 超限被 kill 时返回已捕获前段且不继续 man', async () => {
    const chunk = 'x'.repeat(1_000);
    spawnMock.mockReturnValueOnce(makeChild({ data: Array(30).fill(chunk), exitCode: null, signal: 'SIGTERM' }));
    const help = await fetchHelp('big');
    expect(help).not.toBeNull();
    expect(help!.startsWith(chunk)).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveWindowsCommand', () => {
  beforeEach(() => {
    setPlatform('win32');
    spawnMock.mockReset();
  });

  it('合并 where 与 Get-Command 并按路径去重', async () => {
    spawnMock.mockReturnValueOnce(
      makeChild({ data: ['C:\\old\\agy.exe\nC:\\new\\agy.exe\n'], exitCode: 0 }),
    );
    spawnMock.mockReturnValueOnce(
      makeChild({ data: ['Application|C:\\NEW\\agy.exe\nAlias|\n'], exitCode: 0 }),
    );
    const list = await resolveWindowsCommand('agy');
    expect(list.map((c) => c.source)).toEqual(['C:\\old\\agy.exe', 'C:\\new\\agy.exe']);
    expect(list[0]!.commandType).toBe('Application');
  });

  it('非 Windows 直接返回空数组且不 spawn', async () => {
    setPlatform('linux');
    expect(await resolveWindowsCommand('agy')).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('同名定位 helpers', () => {
  beforeEach(() => {
    setPlatform('win32');
    spawnMock.mockReset();
  });

  it('buildSourceNote：单候选无选定时返回 null，多候选含警告', () => {
    expect(buildSourceNote('agy', [{ source: 'C:\\a\\agy.exe', commandType: 'Application' }], null, false)).toBeNull();
    const note = buildSourceNote(
      'agy',
      [
        { source: 'C:\\old\\agy.exe', commandType: 'Application' },
        { source: 'C:\\new\\agy.exe', commandType: 'Application' },
      ],
      'C:\\new\\agy.exe',
      false,
    )!;
    expect(note).toContain('2 个同名命令');
    expect(note).toContain('本次所选');
    expect(note).toContain('可能属于另一个同名程序');
  });

  it('validateExecutablePath：不存在的文件不通过', () => {
    expect(validateExecutablePath('C:\\definitely\\not\\here\\agy.exe').ok).toBe(false);
  });

  it('fetchHelpDetailed pin 脚本：读文件即权威帮助，不 spawn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdhelp-test-'));
    const bat = join(dir, 'agy.bat');
    writeFileSync(bat, '@echo off\nantigravity --help\n', 'utf8');
    const detail = await fetchHelpDetailed('agy', { pinnedPath: bat });
    expect(detail.help).toContain('antigravity');
    expect(detail.authoritative).toBe(true);
    expect(detail.chosenSource).toBe(bat);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runExeHelp：两种帮助约定都试并择优（长者胜），cwd 隔离且 PATH 收敛', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdhelp-test-'));
    const exe = join(dir, 'agy.exe');
    writeFileSync(exe, 'MZ-fake', 'utf8');
    spawnMock.mockReturnValueOnce(makeChild({ data: ['ANTIGRAVITY v1\nUsage: agy --help\n'], exitCode: 0 }));
    spawnMock.mockReturnValueOnce(makeChild({ errData: ['Error: unexpected argument\n'], exitCode: 2 }));
    const out = await runExeHelp(exe);
    expect(out).toContain('ANTIGRAVITY');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [file, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string> }];
    expect(file).toBe(exe);
    expect(args).toEqual(['--help']);
    expect(opts.cwd).toContain('cmdhelp-');
    expect(opts.env.PATH).toContain('System32');
    expect(opts.env.PATH).not.toContain(dir);
    const [, args2] = spawnMock.mock.calls[1] as unknown as [string, string[]];
    expect(args2).toEqual(['/?']);
  });

  it('runExeHelp：stderr 输出也被合并（非零退出仍认输出）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdhelp-test-'));
    const exe = join(dir, 'old.exe');
    writeFileSync(exe, 'MZ-fake', 'utf8');
    spawnMock.mockReturnValueOnce(makeChild({ exitCode: 0 }));
    spawnMock.mockReturnValueOnce(makeChild({ errData: ['OLD TOOL usage: old /?\n'], exitCode: 2 }));
    const out = await runExeHelp(exe);
    expect(out).toContain('OLD TOOL');
  });
});