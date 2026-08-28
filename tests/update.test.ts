import { describe, expect, it } from 'vitest';
import { isNewer } from '../src/update.js';

describe('isNewer', () => {
  it('新版本大于当前版本时返回 true', () => {
    expect(isNewer('0.1.3', '0.1.2')).toBe(true);
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
  });

  it('相同或更旧版本返回 false', () => {
    expect(isNewer('0.1.2', '0.1.2')).toBe(false);
    expect(isNewer('0.1.1', '0.1.2')).toBe(false);
    expect(isNewer('0.1.2', '0.2.0')).toBe(false);
  });

  it('处理不同长度的版本号', () => {
    expect(isNewer('0.1.2.1', '0.1.2')).toBe(true);
    expect(isNewer('0.1.2', '0.1.2.1')).toBe(false);
  });
});
