import { spawn, type SpawnOptions } from 'node:child_process';

const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 20_000;
const MAX_LINES = 200;

export async function fetchHelp(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    // Tier 1: help.exe —— 50ms 量级，覆盖 dir/copy/del 等 cmd 内部命令，不执行目标命令
    const fromHelp = await runProcess('help', [command], { windowsHide: true }, true);
    if (fromHelp && isValidHelp(fromHelp)) return fromHelp;

    // Tier 2: man —— Git for Windows 自带的 man，有就用（MANPAGER=cat 避免分页）
    const fromMan = await runProcess(
      'man',
      [command],
      { env: { ...process.env, MANPAGER: 'cat', MANWIDTH: '120' }, windowsHide: true },
    );
    if (fromMan) return fromMan;

    // Tier 3: Get-Help —— PowerShell cmdlet 兜底
    const cmd =
      '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      `Get-Help ${command} -Full | Out-String -Width 200`;
    return runProcess('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true });
  }
  return runProcess(
    'man',
    [command],
    { env: { ...process.env, MANPAGER: 'cat', MANWIDTH: '120' } },
  );
}

function isValidHelp(text: string): boolean {
  const lower = text.toLowerCase();
  // 中文系统：不支持该命令。请尝试 "xxx /?"
  if (text.includes('不支持') || text.includes('该命令')) return false;
  // 英文系统：This command is not supported by the help utility.
  if (lower.includes('not supported')) return false;
  // 兜底：help 失败时常带 "try \"xxx /?\"" 且正文很短
  // 但合法的 dir/copy 帮助也可能含 /?，所以仅当同时含不支持语义时才判无效，已在上面覆盖
  return true;
}

function runProcess(
  file: string,
  args: string[],
  extra: SpawnOptions,
  isHelp = false,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    let stdout = '';
    let decoder: TextDecoder | null = null;
    if (isHelp) {
      try {
        decoder = new TextDecoder('gbk');
      } catch {
        decoder = null;
      }
    }
    let settled = false;
    const finish = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const out = child.stdout;
    if (!out) {
      clearTimeout(timer);
      finish(null);
      return;
    }
    out.on('data', (chunk: Buffer) => {
      const text = decoder ? decoder.decode(chunk, { stream: true }) : chunk.toString('utf8');
      stdout += text;
      if (stdout.length > MAX_BUFFER) child.kill();
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (decoder) {
        try {
          stdout += decoder.decode();
        } catch {
          // ignore
        }
      }
      if (signal === 'SIGTERM') {
        finish(stdout.length > MAX_BUFFER ? normalize(stdout) : null);
        return;
      }
      finish(code === 0 ? normalize(stdout) : null);
    });
  });
}

function normalize(output: string): string | null {
  const text = output.split('\n').slice(0, MAX_LINES).join('\n').trim();
  return text.length > 0 ? text : null;
}