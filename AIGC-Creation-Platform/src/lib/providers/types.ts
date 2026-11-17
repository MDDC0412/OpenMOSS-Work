import type { ModelKind, KindSource } from './classify';
import type { FailureKind } from '../errors';

export type GatewayHint = 'auto' | 'string' | 'newapi';

// 内部行：含明文密钥，只在服务端流转，绝不直接序列化给浏览器
export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  models_endpoint: string;
  gateway_hint: GatewayHint;
  last_check_at: number | null;
  last_check_status: FailureKind | 'ok' | null;
  last_check_message: string | null;
  last_check_latency_ms: number | null;
  created_at: number;
  updated_at: number;
}

// 对外行：密钥打码。前端要改密钥时重新填，不做"回填原值"
export interface ProviderPublic extends Omit<ProviderRow, 'api_key'> {
  api_key_masked: string;
  models_url_resolved: string;
  model_count: number;
}

export interface ModelRow {
  provider_id: string;
  model_id: string;
  display_name: string | null;
  owned_by: string | null;
  raw_type: string | null;
  kind: ModelKind;
  kind_source: KindSource;
  last_seen_at: number;
}

export interface ProviderInput {
  name: string;
  base_url: string;
  api_key: string;
  models_endpoint: string;
  gateway_hint?: GatewayHint;
}

export interface CheckResult {
  status: 'ok' | FailureKind;
  message: string;
  detail?: string;
  latencyMs: number;
  httpStatus?: number;
  modelsUrl: string;
  modelCount?: number;
}

export function maskKey(key: string): string {
  if (!key) return '';
  // 只留头尾各 4 位，中间一律星号；短密钥整条打码，避免短 Key 被猜出大半
  if (key.length <= 12) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}${'*'.repeat(Math.max(4, key.length - 10))}${key.slice(-4)}`;
}