import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';

const REGISTRY_URL = 'https://registry.npmjs.org/cmdhelp';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 3000;

function updateCheckPath(): string {
  if (process.env.CMDHELP_CACHE_DIR) return join(process.env.CMDHELP_CACHE_DIR, 'last_update_check');
  return join(homedir(), '.cmdhelp', 'last_update_check');
}

function shouldCheck(): boolean {
  if (process.env.CMDHELP_NO_UPDATE === '1' || process.env.NO_UPDATE === '1') return false;
  const p = updateCheckPath();
  try {
    const raw = readFileSync(p, 'utf8').trim();
    const last = Number(raw);
    if (!Number.isNaN(last) && Date.now() - last < CHECK_INTERVAL_MS) return false;
  } catch {
    // no record, should check
  }
  return true;
}

function markChecked(): void {
  try {
    const p = updateCheckPath();
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, String(Date.now()), 'utf8');
  } catch {
    // ignore
  }
}

export function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => Number(n));
  const b = current.split('.').map((n) => Number(n));
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

async function fetchLatest(): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return data['dist-tags']?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isNpxRun(): boolean {
  // npx 会把包解到临时目录，argv[1] 包含 _npx 或 .npm/_npx
  const exec = process.argv[1] ?? '';
  if (exec.includes('_npx') || exec.includes('.npm')) return true;
  // npm 7+ 会设置 npm_execpath
  const npmExec = process.env.npm_execpath ?? '';
  if (npmExec.includes('npx')) return true;
  return false;
}

export async function checkAndNotify(): Promise<void> {
  if (!shouldCheck()) return;
  markChecked();
  const latest = await fetchLatest();
  if (!latest || !isNewer(latest, VERSION)) return;

  const current = VERSION;
  if (isNpxRun()) {
    process.stderr.write(`\n发现新版本 ${latest}（当前 ${current}），下次可用 npx cmdhelp@latest 直接使用最新版，或运行 npm i -g cmdhelp 更新。\n`);
    return;
  }

  // 全局安装：后台静默更新
  process.stderr.write(`\n发现新版本 ${latest}（当前 ${current}），正在后台自动更新…\n`);
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--do-update', latest], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // ignore
  }
}

// 当作为 detached 子进程被调用时，执行实际的 npm 更新
if (process.argv[2] === '--do-update') {
  const latest = process.argv[3];
  // 尝试 npm install -g，失败则静默
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install', '-g', `cmdhelp@${latest ?? 'latest'}`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
  } catch {
    // ignore
  }
}

export function spawnUpdateCheck(): void {
  if (!shouldCheck()) return;
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // ignore
  }
}

// 如果是直接作为 update 检查器运行（detached）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // 避免与 --do-update 冲突
  if (process.argv[2] !== '--do-update') {
    checkAndNotify().then(() => process.exit(0));
  }
}
