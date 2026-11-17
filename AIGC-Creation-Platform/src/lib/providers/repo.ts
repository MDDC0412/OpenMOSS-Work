import { getDb, newId, nowMs } from '../db';
import type { ModelKind } from './classify';
import { resolveKind } from './classify';
import type { CheckResult, GatewayHint, ModelRow, ProviderInput, ProviderRow } from './types';
import { normalizeBaseUrl } from './url';

// node:sqlite 返回的是 null-prototype 对象，字段齐全时可直接当结构体用
function rowToProvider(r: Record<string, unknown>): ProviderRow {
  return r as unknown as ProviderRow;
}

export function listProviders(): ProviderRow[] {
  return getDb()
    .prepare('SELECT * FROM providers ORDER BY created_at ASC')
    .all() as unknown as ProviderRow[];
}

export function getProvider(id: string): ProviderRow | null {
  const r = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id);
  return r ? rowToProvider(r as Record<string, unknown>) : null;
}

export function insertProvider(input: ProviderInput): ProviderRow {
  const id = newId();
  const t = nowMs();
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, base_url, api_key, models_endpoint, gateway_hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      normalizeBaseUrl(input.base_url),
      input.api_key,
      input.models_endpoint.trim(),
      input.gateway_hint ?? 'auto',
      t,
      t,
    );
  return getProvider(id)!;
}

// 密钥留空表示"不改"，这样编辑其他字段时不用把明文密钥回传到浏览器再传回来
export function updateProvider(id: string, input: Partial<ProviderInput>): void {
  const cur = getProvider(id);
  if (!cur) throw new Error('供应商不存在');
  getDb()
    .prepare(
      `UPDATE providers SET name = ?, base_url = ?, api_key = ?, models_endpoint = ?, gateway_hint = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.name ?? cur.name,
      normalizeBaseUrl(input.base_url ?? cur.base_url),
      input.api_key ? input.api_key : cur.api_key,
      (input.models_endpoint ?? cur.models_endpoint).trim(),
      (input.gateway_hint ?? cur.gateway_hint) as GatewayHint,
      nowMs(),
      id,
    );
}

export function deleteProvider(id: string): void {
  const db = getDb();
  db.exec('BEGIN');
  try {
    // 模型清单跟着供应商走；会话和作品保留，只是 provider_id 指向已删除的行，
    // 这样删供应商不会连带抹掉历史作品
    db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function saveCheckResult(id: string, result: CheckResult): void {
  getDb()
    .prepare(
      `UPDATE providers SET last_check_at = ?, last_check_status = ?, last_check_message = ?, last_check_latency_ms = ?
       WHERE id = ?`,
    )
    .run(nowMs(), result.status, result.message, result.latencyMs, id);
}

export interface IncomingModel {
  model_id: string;
  display_name: string | null;
  owned_by: string | null;
  raw_type: string | null;
}

// 体检成功后刷新模型清单。手工改过用途的行（kind_source='manual'）永不被覆盖，
// 这是用户明确要求的"改动不被下次体检冲掉"。
export function refreshModels(providerId: string, incoming: IncomingModel[]): number {
  const db = getDb();
  const t = nowMs();
  db.exec('BEGIN');
  try {
    const upsert = db.prepare(
      `INSERT INTO models (provider_id, model_id, display_name, owned_by, raw_type, kind, kind_source, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET
         display_name = excluded.display_name,
         owned_by     = excluded.owned_by,
         raw_type     = excluded.raw_type,
         last_seen_at = excluded.last_seen_at,
         kind         = CASE WHEN models.kind_source = 'manual' THEN models.kind ELSE excluded.kind END,
         kind_source  = CASE WHEN models.kind_source = 'manual' THEN 'manual'  ELSE excluded.kind_source END`,
    );
    for (const m of incoming) {
      const { kind, source } = resolveKind(m.model_id, m.raw_type);
      upsert.run(providerId, m.model_id, m.display_name, m.owned_by, m.raw_type, kind, source, t);
    }

    // 本次没出现的模型说明这把 Key 已经访问不到了，清掉避免界面列出用不了的模型。
    // 用 last_seen_at 早于本轮时间戳来判定，比拼 NOT IN 长列表稳。
    // 但手工行（kind_source='manual'）归用户所有，接口没返回也不能删——
    // 否则给「没有模型列表接口」的供应商手填的模型，会被下一次体检悄悄抹掉。
    db.prepare(
      "DELETE FROM models WHERE provider_id = ? AND last_seen_at < ? AND kind_source <> 'manual'",
    ).run(providerId, t);
    db.exec('COMMIT');
    return incoming.length;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listModels(providerId: string): ModelRow[] {
  return getDb()
    .prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY kind, model_id')
    .all(providerId) as unknown as ModelRow[];
}

export function countModels(providerId: string): number {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM models WHERE provider_id = ?').get(providerId) as
    | { n: number }
    | undefined;
  return r?.n ?? 0;
}

export function setModelKind(providerId: string, modelId: string, kind: ModelKind): void {
  getDb()
    .prepare("UPDATE models SET kind = ?, kind_source = 'manual' WHERE provider_id = ? AND model_id = ?")
    .run(kind, providerId, modelId);
}

// 手工加模型：给那些没有模型列表接口、或列表里缺型号的供应商用。
// kind_source 写 'manual'，体检刷新时既不覆盖用途也不删除这一行。
export function addModelManually(providerId: string, modelId: string, kind: ModelKind): void {
  getDb()
    .prepare(
      `INSERT INTO models (provider_id, model_id, display_name, owned_by, raw_type, kind, kind_source, last_seen_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, 'manual', ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET
         kind = excluded.kind,
         kind_source = 'manual'`,
    )
    .run(providerId, modelId, kind, nowMs());
}

export function removeModel(providerId: string, modelId: string): void {
  getDb().prepare('DELETE FROM models WHERE provider_id = ? AND model_id = ?').run(providerId, modelId);
}

export function getPreference(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setPreference(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}