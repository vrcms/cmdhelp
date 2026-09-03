import { describe, expect, it } from 'vitest';
import { extractCommand, extractTarget } from '../src/tokenize.js';

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
describe('extractTarget', () => {
  it('普通命令：无路径、无 /? 意图', () => {
    expect(extractTarget(['agy'])).toEqual({ name: 'agy', fullPath: null, runHelp: false });
  });

  it('尾随 /?/-?/--help/--run-help 视为显式取帮助意图', () => {
    expect(extractTarget(['agy', '/?'])?.runHelp).toBe(true);
    expect(extractTarget(['agy', '-?'])?.runHelp).toBe(true);
    expect(extractTarget(['agy', '--help'])?.runHelp).toBe(true);
    expect(extractTarget(['agy', '--run-help'])?.runHelp).toBe(true);
    expect(extractTarget(['agy', '-p'])?.runHelp).toBe(false);
  });

  it('完整路径：pin 文件并取 basename 当命令名', () => {
    const t = extractTarget(['C:\\tools\\agy.exe']);
    expect(t?.fullPath).toBe('C:\\tools\\agy.exe');
    expect(t?.name).toBe('agy');
  });

  it('拒绝目录穿越与超长路径', () => {
    expect(extractTarget(['..\\agy.exe'])).toBeNull();
    expect(extractTarget([`C:\\${'a'.repeat(300)}.exe`])).toBeNull();
  });

  it('非法命令名仍拒绝', () => {
    expect(extractTarget(['-rf', '/'])).toBeNull();
    expect(extractTarget([])).toBeNull();
  });
});
