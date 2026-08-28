import { colorEnabled, paint } from './color.js';

export function formatExplanation(text: string): string {
  if (!colorEnabled()) return text;
  return text
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith('### 功能')) return paint('green', line);
      if (t.startsWith('### 常用参数')) return paint('yellow', line);
      if (t.startsWith('### 示例')) return paint('blue', line);
      if (t.startsWith('注：')) return paint('dim', line);
      return line.replace(/`([^`]+)`/g, (_match, code: string) => paint('cyan', code));
    })
    .join('\n');
}

export function dimLine(text: string): string {
  return paint('dim', text);
}