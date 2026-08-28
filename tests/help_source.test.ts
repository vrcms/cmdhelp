import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fetchHelp } from '../src/help_source.js';

const spawnMock = vi.mocked(spawn);

interface FakeChild {
  stdout: { on: (ev: string, cb: (chunk: Buffer) => void) => void };
  on: (ev: string, cb: (exit: number | null, signal: string | null) => void) => void;
  kill: ReturnType<typeof vi.fn> & { mock: unknown };
}

function makeChild(opts: {
  data?: string[];
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