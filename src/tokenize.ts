export function extractCommand(input: string): string | null {
  const token = readFirstToken(input);
  if (!token) return null;
  if (token.startsWith('-')) return null;
  if (token.length > 64) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token)) return null;
  return token;
}

export interface CommandTarget {
  /** 传给 AI/缓存的命令名（路径输入时取 basename 去扩展名） */
  name: string;
  /** 用户是否给了完整路径（pin 到该文件，不再按名解析） */
  fullPath: string | null;
  /** 用户是否显式要求跑 /?（argv 里带 /?、-?、--help、--run-help） */
  runHelp: boolean;
}

/** 从 argv 解析查询目标：首 token 为命令名或完整路径，其余 token 只识别 /? 意图 */
export function extractTarget(argv: string[]): CommandTarget | null {
  if (argv.length === 0) return null;
  const first = readFirstToken(argv[0] ?? '');
  if (!first) return null;
  const rest = argv.slice(1).map((a) => a.trim().toLowerCase());
  const runHelp = rest.some((a) => a === '/?' || a === '-?' || a === '--help' || a === '--run-help' || a === '-h' || a === 'help');

  // 完整路径输入：含盘符/斜杠即视为路径（例："C:\tools\agy.exe"）
  if (/[\\/]/.test(first) || /^[A-Za-z]:/.test(first)) {
    if (first.length > 260) return null;
    if (first.includes('..')) return null; // 拒绝目录穿越，保持查询语义简单
    const base = first.split(/[\\/]/).pop() ?? '';
    const name = base.replace(/\.[A-Za-z0-9]+$/, '') || base;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
    return { name, fullPath: first, runHelp };
  }
  const name = extractCommand(first);
  if (!name) return null;
  return { name, fullPath: null, runHelp };
}

function readFirstToken(input: string): string | null {
  const n = input.length;
  let i = 0;
  while (i < n && isBlank(input[i])) i++;
  if (i >= n) return null;
  if (input[i] === '"' || input[i] === "'") {
    const quote = input[i++];
    let out = '';
    while (i < n && input[i] !== quote) out += input[i++];
    return out;
  }
  let out = '';
  while (i < n && !isBlank(input[i])) out += input[i++];
  return out;
}

function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}