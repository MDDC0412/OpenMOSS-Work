// 两家网关的报错外壳不一样，这里统一翻译成"给用户看的一句话 + 可折叠的原文"。
// String AI: 扁平 {"code":"API_KEY_REQUIRED","message":"..."}
// New API:   OpenAI 外壳 {"error":{"message":"...","type":"new_api_error","code":""}}

export type FailureKind =
  | 'network'
  | 'auth'
  | 'url'
  | 'timeout'
  | 'ratelimit'
  | 'upstream'
  | 'badresponse'
  | 'error';

export interface NormalizedError {
  kind: FailureKind;
  message: string;
  detail?: string;
  httpStatus?: number;
}

interface ParsedBody {
  message?: string;
  code?: string;
  type?: string;
}

// 两种外壳都试一遍，谁解出来用谁；解不出就把原文当 detail 留着
export function parseErrorBody(text: string): ParsedBody {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const inner = json.error;
    if (inner && typeof inner === 'object') {
      const e = inner as Record<string, unknown>;
      return {
        message: typeof e.message === 'string' ? e.message : undefined,
        code: e.code == null ? undefined : String(e.code),
        type: typeof e.type === 'string' ? e.type : undefined,
      };
    }
    return {
      message: typeof json.message === 'string' ? json.message : undefined,
      code: json.code == null ? undefined : String(json.code),
      type: typeof json.type === 'string' ? json.type : undefined,
    };
  } catch {
    return {};
  }
}

// 从 fetch 抛出的异常里挖出底层网络错误码。Node 把它藏在 cause 链里，可能套好几层。
function digErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const obj = cur as { code?: unknown; cause?: unknown; name?: unknown };
    if (typeof obj.code === 'string') return obj.code;
    if (obj.name === 'AbortError' || obj.name === 'TimeoutError') return 'ABORT';
    cur = obj.cause;
  }
  return undefined;
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function statusToKind(status: number): FailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 405 || status === 410) return 'url';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'ratelimit';
  if (status >= 500) return 'upstream';
  return 'error';
}

// 体检和日常调用共用这一套判据：用户看到的失败原因分类必须一致
export function kindToMessage(kind: FailureKind, httpStatus?: number, providerMessage?: string): string {
  const suffix = providerMessage ? `（供应商原文：${providerMessage}）` : '';
  switch (kind) {
    case 'network':
      return `网络不通：连不上这个地址。检查 Base URL 有没有写错、要不要带端口、本机网络是否能访问它${suffix}`;
    case 'auth':
      return `密钥没通过：地址是通的，但 API Key 被拒了。检查 Key 是否复制完整、是否过期、以及这把 Key 有没有权限访问该模型分组${suffix}`;
    case 'url':
      return `地址不对：服务器连上了，但这个路径不存在。模型列表接口地址可能多写或少写了 /v1，或者该网关没有这个接口${suffix}`;
    case 'timeout':
      return `超时：请求发出去了但迟迟没回应。可能是供应商繁忙，也可能是地址能连但服务卡住${suffix}`;
    case 'ratelimit':
      return `被限流：供应商拒绝了本次请求，通常是并发或额度限制。稍等再试${suffix}`;
    case 'upstream':
      return `供应商自己出错了（HTTP ${httpStatus ?? '5xx'}）：不是你的配置问题，稍后重试或看供应商公告${suffix}`;
    case 'badresponse':
      return `返回内容看不懂：接口通了，但响应不是预期的模型列表 JSON 结构${suffix}`;
    default:
      return `请求失败${httpStatus ? `（HTTP ${httpStatus}）` : ''}${suffix}`;
  }
}

export function normalizeError(err: unknown): NormalizedError {
  // openai SDK 的 APIError 带 status 和已解析的 error 体
  const anyErr = err as {
    status?: number;
    message?: string;
    error?: unknown;
    name?: string;
    cause?: unknown;
  };

  if (typeof anyErr?.status === 'number') {
    const kind = statusToKind(anyErr.status);
    const bodyText = typeof anyErr.error === 'string' ? anyErr.error : JSON.stringify(anyErr.error ?? null);
    const parsed = parseErrorBody(bodyText ?? '');
    return {
      kind,
      httpStatus: anyErr.status,
      message: kindToMessage(kind, anyErr.status, parsed.message ?? anyErr.message),
      detail: bodyText && bodyText !== 'null' ? bodyText : anyErr.message,
    };
  }

  const code = digErrorCode(err);
  if (code === 'ABORT') {
    return { kind: 'timeout', message: kindToMessage('timeout'), detail: String(anyErr?.message ?? err) };
  }
  if (code && NETWORK_CODES.has(code)) {
    return { kind: 'network', message: kindToMessage('network'), detail: `${code}: ${String(anyErr?.message ?? '')}` };
  }
  // fetch 在网络层失败时抛 TypeError('fetch failed')，错误码在 cause 里；上面没挖到就归为网络
  if (anyErr?.name === 'TypeError' && /fetch failed/i.test(anyErr.message ?? '')) {
    return { kind: 'network', message: kindToMessage('network'), detail: String(anyErr.message) };
  }

  return {
    kind: 'error',
    message: kindToMessage('error', undefined, anyErr?.message),
    detail: anyErr?.message ?? String(err),
  };
}

// HTTP 层已经拿到响应但状态码不对时走这里（体检用的是裸 fetch，不经过 SDK）
export function normalizeHttpError(status: number, bodyText: string): NormalizedError {
  const kind = statusToKind(status);
  const parsed = parseErrorBody(bodyText);
  return {
    kind,
    httpStatus: status,
    message: kindToMessage(kind, status, parsed.message),
    detail: bodyText.slice(0, 2000),
  };
}