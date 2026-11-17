import { normalizeError, normalizeHttpError } from '../errors';
import { refreshModels, saveCheckResult, type IncomingModel } from './repo';
import type { CheckResult, ProviderRow } from './types';
import { resolveModelsUrl } from './url';

const CHECK_TIMEOUT_MS = 20_000;

// 从模型列表响应里取出条目。标准是 {object:"list",data:[...]}，
// 但不同网关可能返回裸数组或 {models:[...]}，三种都认，认不出才算 badresponse。
function extractItems(json: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (Array.isArray(obj.models)) return obj.models as Record<string, unknown>[];
  }
  return null;
}

function toIncoming(items: Record<string, unknown>[]): IncomingModel[] {
  const out: IncomingModel[] = [];
  for (const it of items) {
    // 没有 id 的条目无法调用，直接跳过而不是塞个空模型进界面
    if (typeof it.id !== 'string' || !it.id) continue;
    out.push({
      model_id: it.id,
      display_name: typeof it.display_name === 'string' ? it.display_name : null,
      owned_by: typeof it.owned_by === 'string' ? it.owned_by : null,
      // String AI 额外给的 type 字段；New API 没有这个字段，取到 null 就走名字规则
      raw_type: typeof it.type === 'string' ? it.type : it.type == null ? null : String(it.type),
    });
  }
  return out;
}

// 把一次已经拿到手的 HTTP 响应翻译成体检结论。抽成纯函数是为了能单独测：
// 两家网关的错误外壳、非 JSON 网页、缺 data 数组这几种情况都不需要真网络就能验证。
export function interpretResponse(
  status: number,
  ok: boolean,
  text: string,
  latencyMs: number,
  modelsUrl: string,
): { result: CheckResult; incoming: IncomingModel[] } {
  if (!ok) {
    const norm = normalizeHttpError(status, text);
    return {
      incoming: [],
      result: {
        status: norm.kind,
        message: norm.message,
        detail: norm.detail,
        httpStatus: status,
        latencyMs,
        modelsUrl,
      },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      incoming: [],
      result: {
        status: 'badresponse',
        message: '返回内容看不懂：接口通了，但响应不是 JSON。这个地址可能指向了网页而不是模型列表接口',
        detail: text.slice(0, 500),
        latencyMs,
        modelsUrl,
        httpStatus: status,
      },
    };
  }

  const items = extractItems(json);
  if (!items) {
    return {
      incoming: [],
      result: {
        status: 'badresponse',
        message: '返回内容看不懂：是 JSON，但没有 data 数组，不像模型列表接口的响应',
        detail: text.slice(0, 500),
        latencyMs,
        modelsUrl,
        httpStatus: status,
      },
    };
  }

  const incoming = toIncoming(items);
  return {
    incoming,
    result: {
      status: 'ok',
      message: `连通正常，这把密钥能用 ${incoming.length} 个模型（耗时 ${latencyMs} 毫秒）`,
      latencyMs,
      modelsUrl,
      modelCount: incoming.length,
      httpStatus: status,
    },
  };
}

export async function runCheck(provider: ProviderRow): Promise<CheckResult> {
  // 留空表示这家供应商没有模型列表接口：不请求、不判红，模型全靠手工加。
  // ponytail: 直接算 ok 而不是新增一个 'skipped' 状态，因为界面只有绿/黄/红三档有意义。
  if (!provider.models_endpoint.trim()) {
    const result: CheckResult = {
      status: 'ok',
      message: '没配模型列表接口，跳过拉取；模型靠手工添加，加完就能用',
      latencyMs: 0,
      modelsUrl: '（未配置模型列表接口）',
    };
    saveCheckResult(provider.id, result);
    return result;
  }

  let modelsUrl: string;
  try {
    modelsUrl = resolveModelsUrl(provider.base_url, provider.models_endpoint);
    // 提前构造一次 URL，非法地址在这里就炸，归类成"地址不对"而不是"网络不通"
    new URL(modelsUrl);
  } catch {
    const result: CheckResult = {
      status: 'url',
      message: '地址写得不合法：Base URL 或模型列表接口地址不是有效的 http/https 网址',
      latencyMs: 0,
      modelsUrl: `${provider.base_url} + ${provider.models_endpoint}`,
    };
    saveCheckResult(provider.id, result);
    return result;
  }

  const started = Date.now();
  let result: CheckResult;
  let incoming: IncomingModel[] = [];

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        Accept: 'application/json',
      },
      // 20 秒还没回应就判超时：体检是给用户看结论的，不能一直转圈
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    const interpreted = interpretResponse(res.status, res.ok, text, latencyMs, modelsUrl);
    result = interpreted.result;
    incoming = interpreted.incoming;
  } catch (err) {
    const norm = normalizeError(err);
    result = {
      status: norm.kind,
      message: norm.message,
      detail: norm.detail,
      latencyMs: Date.now() - started,
      modelsUrl,
    };
  }

  // 只有体检通过才刷新模型清单，失败时保留上一次的清单，避免一次网络抖动就把界面清空
  if (result.status === 'ok') refreshModels(provider.id, incoming);
  saveCheckResult(provider.id, result);
  return result;
}