import type { GatewayHint } from './types';

// 用户填的"模型列表接口地址"有三种写法，这里统一解析成真正要请求的 URL，
// 并把结果回显到界面上，让用户看得见到底会打哪儿，避免猜。
export function resolveModelsUrl(baseUrl: string, endpoint: string): string {
  const ep = endpoint.trim();
  if (/^https?:\/\//i.test(ep)) return ep;

  const base = baseUrl.trim().replace(/\/+$/, '');
  if (ep.startsWith('/')) {
    // 绝对路径：拼到 origin 上，所以填 /v1/models 时 base_url 写不写 /v1 都不影响
    const origin = new URL(base).origin;
    return `${origin}${ep}`;
  }
  // 相对路径：接在 base_url 后面，所以 base_url 到 /v1、endpoint 填 models 也能work
  return `${base}/${ep.replace(/^\/+/, '')}`;
}

// 网关识别只用于挑错误解析和分类策略，识别错了也不影响调用（两家都走 OpenAI 标准路径）。
// 显式指定优先，其次按 hostname 特征猜。
export function detectGateway(baseUrl: string, hint: GatewayHint): 'string' | 'newapi' | 'generic' {
  if (hint === 'string') return 'string';
  if (hint === 'newapi') return 'newapi';
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('string.ink')) return 'string';
  } catch {
    // base_url 非法时不在这里报错，交给体检去报"地址不对"
  }
  return 'generic';
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}