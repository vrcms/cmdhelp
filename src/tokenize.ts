export function extractCommand(input: string): string | null {
  const token = readFirstToken(input);
  if (!token) return null;
  if (token.startsWith('-')) return null;
  if (token.length > 64) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token)) return null;
  return token;
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