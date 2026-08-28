const ANSI = {
  green: '\u001b[32;1m',
  yellow: '\u001b[33;1m',
  blue: '\u001b[34;1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
} as const;

const RESET = '\u001b[0m';

export type ColorKind = keyof typeof ANSI;

export function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return process.stdout.isTTY === true && process.env.TERM !== 'dumb';
}

export function paint(kind: ColorKind, text: string): string {
  return colorEnabled() ? `${ANSI[kind]}${text}${RESET}` : text;
}