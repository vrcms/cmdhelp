import { describe, expect, it } from 'vitest';
import { extractCommand } from '../src/tokenize.js';

describe('extractCommand', () => {
  it('取首个 token 并忽略其余参数', () => {
    expect(extractCommand('rm -rf /')).toBe('rm');
    expect(extractCommand('git  status --short')).toBe('git');
    expect(extractCommand('  ls   -l')).toBe('ls');
  });

  it('支持引号包裹的命令名', () => {
    expect(extractCommand("'ls'")).toBe('ls');
    expect(extractCommand('"grep"')).toBe('grep');
  });

  it('拒绝以 - 开头的 token', () => {
    expect(extractCommand('--help')).toBeNull();
    expect(extractCommand('-rf /')).toBeNull();
  });

  it('拒绝含分隔符或特殊字符的 token', () => {
    expect(extractCommand('a;b')).toBeNull();
    expect(extractCommand('./x')).toBeNull();
    expect(extractCommand('C:\\x')).toBeNull();
    expect(extractCommand('ls|more')).toBeNull();
  });

  it('拒绝引号内含空白的命令名', () => {
    expect(extractCommand('"my cmd"')).toBeNull();
  });

  it('拒绝空输入与超长命令名', () => {
    expect(extractCommand('')).toBeNull();
    expect(extractCommand('   ')).toBeNull();
    expect(extractCommand('a'.repeat(65))).toBeNull();
  });

  it('接受正常的命令名', () => {
    expect(extractCommand('man')).toBe('man');
    expect(extractCommand('python3.12')).toBe('python3.12');
    expect(extractCommand('docker-compose')).toBe('docker-compose');
  });
});