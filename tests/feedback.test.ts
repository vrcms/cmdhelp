import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSpinner } from '../src/feedback.js';

type Tty = { isTTY: boolean };

describe('startSpinner', () => {
  let stderrWrites: string[];
  let originalIsTTY: unknown;

  beforeEach(() => {
    stderrWrites = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((line: string) => {
      stderrWrites.push(String(line));
      return true;
    }) as never);
    originalIsTTY = (process.stderr as Tty).isTTY;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    (process.stderr as Tty).isTTY = originalIsTTY as boolean;
    vi.restoreAllMocks();
  });

  it('非 TTY：立即输出静态提示一行，stop 无副作用', () => {
    (process.stderr as Tty).isTTY = false;
    const stop = startSpinner('正在生成 AI 通俗解释…');
    vi.advanceTimersByTime(1000);
    expect(stderrWrites).toEqual(['正在生成 AI 通俗解释…\n']);
    stop();
    expect(stderrWrites).toHaveLength(1);
  });

  it('TTY：输出动画帧并在 stop 时清除当前行', () => {
    (process.stderr as Tty).isTTY = true;
    const stop = startSpinner('工作中…');
    vi.advanceTimersByTime(200);
    expect(stderrWrites.length).toBeGreaterThan(1);
    expect(stderrWrites[0]).toMatch(/^\r[|/\\-] 工作中…$/);
    stop();
    expect(stderrWrites.at(-1)).toBe('\r\x1b[2K');
    const frames = stderrWrites.length;
    vi.advanceTimersByTime(500);
    expect(stderrWrites).toHaveLength(frames);
  });
});