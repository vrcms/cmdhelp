import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 20_000;
const MAX_LINES = 200;
// 直接读取脚本型命令（.bat/.cmd/.ps1）时同样截断，避免超大文件撑爆上下文
const MAX_SCRIPT_BYTES = 64_000;
// 允许被解析/执行的 Windows 可执行扩展名白名单
const EXEC_EXTS = new Set(['.exe', '.bat', '.cmd', '.ps1', '.com']);

/** Windows 同名命令候选（where / Get-Command 解析结果，只做元数据查询，不执行目标） */
export interface CommandCandidate {
  /** 完整路径（Application）或空（别名/函数等无路径类型时会被过滤掉） */
  source: string;
  /** Get-Command 的 CommandType，如 Application/Alias/Function/Cmdlet */
  commandType: string;
  product?: string;
  fileVersion?: string;
}

export interface HelpDetail {
  /** 送 AI 的本地帮助原文（脚本内容 / /? 输出 / 按名查到的帮助都可能） */
  help: string | null;
  /** Windows 下解析到的全部候选（POSIX 为空数组） */
  candidates: CommandCandidate[];
  /** 本次实际选定的完整路径（未选定时为 null） */
  chosenSource: string | null;
  /** 给 AI 的【命令解析】备注：候选列表+选定项+帮助归属警告 */
  sourceNote: string | null;
  /** help 是否来自所选程序本身（脚本读取 / /? 执行），false 表示是按名查到的、可能属于另一个同名程序 */
  authoritative: boolean;
}

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

/**
 * 解析 Windows 同名命令：`where` 给出 PATH 顺序的全部路径，
 * `Get-Command -All` 补充别名/函数/cmdlet 信息。两个都是元数据查询，不执行目标程序。
 * 非 Windows 直接返回空数组。
 */
export async function resolveWindowsCommand(command: string): Promise<CommandCandidate[]> {
  if (process.platform !== 'win32') return [];
  const merged = new Map<string, CommandCandidate>();

  // Tier 0a: where（按 PATH 顺序，第一个就是 cmd 输入命令名实际会跑的那个）
  const fromWhere = await runProcess('where', [command], { windowsHide: true });
  for (const line of (fromWhere ?? '').split('\n')) {
    const p = line.trim();
    if (!p || p.toLowerCase().startsWith('info:')) continue;
    const key = p.toLowerCase();
    if (!merged.has(key) && merged.size < 8) {
      merged.set(key, { source: p, commandType: 'Application' });
    }
  }

  // Tier 0b: Get-Command -All（看得到 where 看不到的别名/函数，Source 为空的会被过滤）
  const ps =
    '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
    `Get-Command ${command} -All -ErrorAction SilentlyContinue | ForEach-Object { "$($_.CommandType)|$($_.Source)" }`;
  const fromGc = await runProcess('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
  for (const line of (fromGc ?? '').split('\n')) {
    const t = line.trim();
    if (!t || !t.includes('|')) continue;
    const sep = t.indexOf('|');
    const type = t.slice(0, sep).trim() || 'Unknown';
    const src = t.slice(sep + 1).trim();
    if (!src) continue; // 别名/函数无路径，无法定位文件，跳过
    const key = src.toLowerCase();
    if (!merged.has(key) && merged.size < 8) {
      merged.set(key, { source: src, commandType: type });
    }
  }
  return [...merged.values()];
}

/** 批量取候选文件的产品名/版本（Get-Item 只读元数据，不执行），用于重名二选一时展示 */
export async function fetchVersionInfo(sources: string[]): Promise<Map<string, { product: string; version: string }>> {
  const result = new Map<string, { product: string; version: string }>();
  const targets = sources.slice(0, 8);
  if (process.platform !== 'win32' || targets.length === 0) return result;
  const list = targets.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
  const ps =
    '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
    `${list} | ForEach-Object { $v=(Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue).VersionInfo; ` +
    `"$_|$($v.ProductName)|$($v.FileVersion)" }`;
  const out = await runProcess('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
  for (const line of (out ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const [path, product, version] = t.split('|');
    if (path) result.set(path, { product: (product ?? '').trim(), version: (version ?? '').trim() });
  }
  return result;
}

/** 校验完整路径是否可作为查询目标（存在、是文件、扩展名在白名单内） */
export function validateExecutablePath(fullPath: string): { ok: boolean; reason?: string } {
  if (!existsSync(fullPath)) return { ok: false, reason: '文件不存在' };
  try {
    if (!statSync(fullPath).isFile()) return { ok: false, reason: '不是文件' };
  } catch {
    return { ok: false, reason: '无法访问该文件' };
  }
  if (!EXEC_EXTS.has(extname(fullPath).toLowerCase())) {
    return { ok: false, reason: `仅支持 ${[...EXEC_EXTS].join('/')} 类型的程序` };
  }
  return { ok: true };
}

/** 脚本型命令直接读文件内容当帮助（.bat/.cmd/.ps1），不执行 */
export function readScriptHelp(fullPath: string): string | null {
  const ext = extname(fullPath).toLowerCase();
  if (ext !== '.bat' && ext !== '.cmd' && ext !== '.ps1') return null;
  try {
    if (statSync(fullPath).size > MAX_SCRIPT_BYTES) return null;
    const text = readFileSync(fullPath, 'utf8').split('\n').slice(0, MAX_LINES).join('\n').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * 最小可启动环境：程序启动可能依赖 System32/USERPROFILE（如 agy 缺了就直接崩），
 * 但不继承用户完整 PATH（防同目录 DLL 劫持之外的意外）与业务环境变量。
 */
function helpEnv(cwd: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return {
    SystemRoot: systemRoot,
    SystemDrive: process.env.SystemDrive ?? 'C:',
    windir: process.env.windir ?? systemRoot,
    OS: 'Windows_NT',
    PATH: `${systemRoot}\\System32;${systemRoot}`,
    PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
    TEMP: cwd,
    TMP: cwd,
    USERPROFILE: process.env.USERPROFILE ?? '',
  };
}

/** 单次加固执行：stdout+stderr 合并（clap 类把 --help 放 stdout、把 /? 报错放 stderr），非零退出也认输出 */
function runHelpOnce(file: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: helpEnv(cwd),
      windowsHide: true,
    });
    let out = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const push = (chunk: Buffer): void => {
      out += chunk.toString('utf8');
      if (out.length > MAX_BUFFER) child.kill();
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (_code, signal) => {
      clearTimeout(timer);
      // 超时被杀但已吐出大量输出：取已捕获前段；输出少则视为失败
      if (signal === 'SIGTERM') {
        finish(out.length > MAX_BUFFER ? normalize(out) : null);
        return;
      }
      finish(normalize(out)); // 不看退出码：/? 常 exit 2 但 stderr 里有可用信息
    });
  });
}

/**
 * 加固执行 `<完整路径> [--help] [/?]` 取帮助并择优返回。
 * 显式请求（cmdhelp <命令> /? / 完整路径 pin）时才调用：spawn 不经 shell、
 * stdin 忽略、空临时目录当 cwd、最小环境变量、5s 超时、20k 截断。
 * 注意：设计不良的程序可能忽略参数直接执行，Windows 纯 Node 无法做到文件级拦截，
 * 因此该函数绝不在后台/静默路径被调用。
 */
export async function runExeHelp(fullPath: string): Promise<string | null> {
  const check = validateExecutablePath(fullPath);
  if (!check.ok) return null;
  const ext = extname(fullPath).toLowerCase();
  if (ext !== '.exe' && ext !== '.com') return null; // 脚本走读文件，不执行
  let cwd = '';
  try {
    cwd = mkdtempSync(join(tmpdir(), 'cmdhelp-'));
  } catch {
    return null;
  }
  // 两种帮助约定都试一次，取更长的（现代 CLI 认 --help 并 exit 0，老程序认 /?；
  // clap 类对 /? 只回一句 exit 2 的报错，不能让它盖掉 --help 的全文）
  const got = await Promise.all([runHelpOnce(fullPath, ['--help'], cwd), runHelpOnce(fullPath, ['/?'], cwd)]);
  const [helpDash, helpSlash] = got;
  if (helpDash && helpSlash) return helpDash.length >= helpSlash.length ? helpDash : helpSlash;
  return helpDash ?? helpSlash;
}

/** 拼给 AI 的【命令解析】备注：候选是谁、选了谁、帮助是否权威 */
export function buildSourceNote(
  name: string,
  candidates: CommandCandidate[],
  chosenSource: string | null,
  authoritative: boolean,
): string | null {
  if (candidates.length <= 1 && !chosenSource) return null;
  const lines = candidates.map((c, i) => {
    const extra = [c.commandType, c.product, c.fileVersion].filter(Boolean).join('，');
    const mark = chosenSource && c.source.toLowerCase() === chosenSource.toLowerCase() ? '（本次所选）' : '';
    return `${i + 1}) ${c.source}${extra ? `（${extra}）` : ''}${mark}`;
  });
  const warn = authoritative
    ? '以下本地帮助来自所选程序本身，可直接依据。'
    : '以下本地帮助是按命令名查到的，可能属于另一个同名程序；回答必须以本次所选程序为准，若帮助与所选明显不符请忽略帮助并明确说明。';
  return `【命令解析】本机找到 ${candidates.length} 个同名命令 ${name}：\n${lines.join('\n')}\n${warn}`;
}

/**
 * 带解析的帮助获取（Windows 同名问题的入口）。
 * 规则：pin 脚本→读文件；pin 的 exe + runHelp→加固跑 /?；
 * 单候选 + runHelp→跑该候选 /?；其余全部走传统三级（不执行目标）。
 */
export async function fetchHelpDetailed(
  name: string,
  opts: { pinnedPath?: string; runHelp?: boolean } = {},
): Promise<HelpDetail> {
  const empty: HelpDetail = { help: null, candidates: [], chosenSource: null, sourceNote: null, authoritative: false };
  if (process.platform !== 'win32') {
    return { ...empty, help: await fetchHelp(name) };
  }
  const candidates = opts.pinnedPath
    ? [{ source: opts.pinnedPath, commandType: 'Application' } as CommandCandidate]
    : await resolveWindowsCommand(name);
  const chosen = opts.pinnedPath ?? (candidates.length === 1 ? candidates[0]!.source : null);

  // 脚本 pin：读文件即权威帮助，不执行
  if (chosen) {
    const script = readScriptHelp(chosen);
    if (script) {
      const note = buildSourceNote(name, candidates, chosen, true);
      return { help: script, candidates, chosenSource: chosen, sourceNote: note, authoritative: true };
    }
  }
  // 显式 /?：只对选定的 exe 跑加固 /?
  if (opts.runHelp && chosen) {
    const out = await runExeHelp(chosen);
    if (out) {
      const note = buildSourceNote(name, candidates, chosen, true);
      return { help: out, candidates, chosenSource: chosen, sourceNote: note, authoritative: true };
    }
  }
  // 传统三级（不执行目标）；多候选时挂备注防 AI 被带偏
  const help = await fetchHelp(name);
  const note =
    candidates.length > 1 ? buildSourceNote(name, candidates, chosen, false) : chosen ? buildSourceNote(name, candidates, chosen, false) : null;
  return { help, candidates, chosenSource: chosen, sourceNote: note, authoritative: false };
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