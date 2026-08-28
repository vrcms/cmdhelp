import { spawn, type SpawnOptions } from 'node:child_process';

const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 20_000;
const MAX_LINES = 200;

export async function fetchHelp(command: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const cmd =
      '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      `Get-Help ${command} -Full | Out-String -Width 200`;
    return runProcess('powershell', ['-NoProfile', '-Command', cmd], {});
  }
  return runProcess(
    'man',
    [command],
    { env: { ...process.env, MANPAGER: 'cat', MANWIDTH: '120' } },
  );
}

function runProcess(
  file: string,
  args: string[],
  extra: SpawnOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    let stdout = '';
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
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_BUFFER) child.kill();
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
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