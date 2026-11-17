import { describe, expect, it } from 'vitest';
import { detectGateway, normalizeBaseUrl, resolveModelsUrl } from './url';

// 用户填的 endpoint 有三种写法，解析结果必须可预测——这是"到底会打哪儿"的唯一真值。
describe('resolveModelsUrl —— 三种 endpoint 写法', () => {
  it('绝对网址直接用，不拼 base', () => {
    expect(resolveModelsUrl('https://x.com/v1', 'https://other.com/models')).toBe('https://other.com/models');
  });

  it('绝对路径拼到 origin：base 写不写 /v1 都一样', () => {
    expect(resolveModelsUrl('https://x.com/v1', '/v1/models')).toBe('https://x.com/v1/models');
    expect(resolveModelsUrl('https://x.com', '/v1/models')).toBe('https://x.com/v1/models');
  });

  it('相对路径接在 base 后面', () => {
    expect(resolveModelsUrl('https://x.com/v1', 'models')).toBe('https://x.com/v1/models');
  });

  it('base 末尾多余斜杠先去掉再拼', () => {
    expect(resolveModelsUrl('https://x.com/v1/', 'models')).toBe('https://x.com/v1/models');
  });
});

describe('detectGateway —— 显式 hint 优先，其次 hostname', () => {
  it('显式 hint 覆盖 hostname 猜测', () => {
    expect(detectGateway('https://www.string.ink/v1', 'newapi')).toBe('newapi');
  });

  it('string.ink 自动识别为 string', () => {
    expect(detectGateway('https://www.string.ink/v1', 'auto')).toBe('string');
  });

  it('其他地址归 generic', () => {
    expect(detectGateway('http://103.236.98.145:28475', 'auto')).toBe('generic');
  });

  it('非法地址不在这里抛，归 generic 交给体检报错', () => {
    expect(detectGateway('not a url', 'auto')).toBe('generic');
  });
});

describe('normalizeBaseUrl', () => {
  it('去首尾空白与末尾斜杠', () => {
    expect(normalizeBaseUrl('  https://x.com/v1///  ')).toBe('https://x.com/v1');
  });
});