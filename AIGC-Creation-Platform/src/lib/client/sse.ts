import { ApiError } from './api';

export interface SseEvent {
  event: string;
  data: unknown;
}

// 发起一个 SSE 请求。非 2xx 时后端返回的是普通 JSON 错误外壳，按 ApiError 抛；
// 2xx 才把 Response 交给 readSse 逐帧读。
export async function postSse(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('network', '连不上本机服务：确认 npm run dev 还在运行，然后刷新页面');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `请求失败（HTTP ${res.status}）`;
    let kind: ApiError['kind'] = 'error';
    let detail: string | undefined;
    try {
      const env = JSON.parse(text) as { error?: { kind?: ApiError['kind']; message?: string; detail?: string } };
      if (env.error?.message) message = env.error.message;
      if (env.error?.kind) kind = env.error.kind;
      detail = env.error?.detail;
    } catch {
      detail = text;
    }
    throw new ApiError(kind, message, detail, res.status);
  }
  return res;
}

// 逐帧读 SSE。后端保证每帧只有单行 data，所以按空行切帧、按前缀取字段即可。
export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1] ?? 'message';
      const dataLine = /^data: (.+)$/m.exec(frame)?.[1];
      if (!dataLine) continue;
      yield { event, data: JSON.parse(dataLine) };
    }
  }
}