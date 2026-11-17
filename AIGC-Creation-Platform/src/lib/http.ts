import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { normalizeError, type NormalizedError } from './errors';

// 所有接口共用一个失败外壳：{ error: { kind, message, detail?, httpStatus? } }。
// 前端只看 message（已经是人话），detail 折叠展示，这样两家网关的报错差异不会漏到界面上。
export interface ApiErrorBody {
  error: NormalizedError;
}

// 参数校验失败属于用户输入问题，用 400 而不是 502，避免前端把它当成"供应商挂了"
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // 把每个字段的问题拼成一句，用户能直接看出是哪一格填错了
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '请求体'}：${i.message}`).join('；');
    throw new HttpError(400, `填写内容有问题 —— ${detail}`);
  }
  return parsed.data;
}

// 路由统一包一层：业务里抛出的异常都翻译成人话再返回，绝不让堆栈或密钥进响应体
export async function route(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: { kind: 'error', message: err.message } satisfies NormalizedError }, err.status);
    }
    const norm = normalizeError(err);
    // 502 表示"本机服务正常，是往上游发的这一跳失败了"
    return json({ error: norm } satisfies ApiErrorBody, 502);
  }
}

// 动态路由的 params 在 Next 15+ 是 Promise，这里统一解开
export async function paramId(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  return id;
}