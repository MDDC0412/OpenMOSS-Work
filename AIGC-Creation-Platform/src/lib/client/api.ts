import type { NormalizedError } from '~/lib/errors';

// 前端统一的失败对象：message 已经是后端翻译好的人话，直接弹给用户即可
export class ApiError extends Error {
  constructor(
    public readonly kind: NormalizedError['kind'],
    message: string,
    public readonly detail?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: Partial<NormalizedError>;
}

// 所有请求都走这里，保证失败时不会把 HTML 错误页或原始堆栈甩到界面上
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // multipart 的 boundary 必须由浏览器自己生成，手写 Content-Type 会让后端解不开表单
  const isForm = init?.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers ?? {}) },
    });
  } catch {
    // 本机服务没起来或被关掉时 fetch 直接抛，给一句能操作的提示
    throw new ApiError('network', '连不上本机服务：确认 npm run dev 还在运行，然后刷新页面');
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const env = (body ?? {}) as ErrorEnvelope;
    const e = env.error;
    throw new ApiError(
      e?.kind ?? 'error',
      e?.message ?? `请求失败（HTTP ${res.status}）`,
      e?.detail ?? (text || undefined),
      e?.httpStatus ?? res.status,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) => request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  upload: <T>(url: string, form: FormData) => request<T>(url, { method: 'POST', body: form }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

// 记住上次用的供应商与模型：值统一存成 JSON 字符串，读的时候解不出来就当没存过
export interface LastUsed {
  providerId: string;
  modelId: string;
}

export async function loadLastUsed(key: string): Promise<LastUsed | null> {
  const { value } = await api.get<{ value: string | null }>(`/api/preferences?key=${encodeURIComponent(key)}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as LastUsed;
    return parsed.providerId && parsed.modelId ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLastUsed(key: string, value: LastUsed): Promise<void> {
  await api.put('/api/preferences', { key, value: JSON.stringify(value) });
}