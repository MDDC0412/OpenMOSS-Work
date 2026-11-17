import { describe, expect, it } from 'vitest';
import { normalizeHttpError, parseErrorBody, statusToKind } from './errors';

// 错误翻译是体检与日常调用共用的判据，两家网关外壳不同，这里钉死核心行为防回归。
describe('parseErrorBody —— 两家网关的错误外壳', () => {
  it('String AI 扁平外壳 {code,message}', () => {
    expect(parseErrorBody('{"code":"API_KEY_REQUIRED","message":"key missing"}')).toEqual({
      message: 'key missing',
      code: 'API_KEY_REQUIRED',
      type: undefined,
    });
  });

  it('New API 嵌套外壳 {error:{...}}', () => {
    expect(parseErrorBody('{"error":{"code":"invalid_api_key","message":"Incorrect API key","type":"new_api_error"}}')).toEqual({
      message: 'Incorrect API key',
      code: 'invalid_api_key',
      type: 'new_api_error',
    });
  });

  it('不是 JSON 时返回空对象而不抛', () => {
    expect(parseErrorBody('<html>502 Bad Gateway</html>')).toEqual({});
  });
});

describe('statusToKind —— HTTP 码归因', () => {
  // 401/403 都算密钥被拒；404/405/410 算地址不对；5xx 算供应商出错
  const cases: [number, string][] = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'url'],
    [408, 'timeout'],
    [429, 'ratelimit'],
    [500, 'upstream'],
    [503, 'upstream'],
    [418, 'error'],
  ];
  for (const [status, kind] of cases) {
    it(`HTTP ${status} → ${kind}`, () => {
      expect(statusToKind(status)).toBe(kind);
    });
  }
});

describe('normalizeHttpError —— 翻译成给用户的人话', () => {
  it('401 判 auth 且带上供应商原文', () => {
    const n = normalizeHttpError(401, '{"error":{"message":"Incorrect API key provided."}}');
    expect(n.kind).toBe('auth');
    expect(n.httpStatus).toBe(401);
    expect(n.message).toContain('密钥没通过');
    expect(n.message).toContain('Incorrect API key provided.');
  });

  it('原文超长时截断到 2000 字以内', () => {
    const n = normalizeHttpError(500, 'x'.repeat(5000));
    expect(n.detail!.length).toBeLessThanOrEqual(2000);
  });
});