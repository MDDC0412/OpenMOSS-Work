import { getDb, newId, nowMs } from '../db';
import type { FailureKind } from '../errors';

export interface PackRow {
  id: string;
  name: string;
  url: string;
  // url：外链文本，靠抓取；local：本地文件，导入即缓存，没有网址
  source: 'url' | 'local';
  file_name: string | null;
  content: string | null;
  content_bytes: number | null;
  fetch_status: 'never' | 'ok' | FailureKind;
  fetch_message: string | null;
  fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

export function listPacks(): PackRow[] {
  return getDb().prepare('SELECT * FROM prompt_packs ORDER BY created_at ASC').all() as unknown as PackRow[];
}

export function getPack(id: string): PackRow | null {
  const r = getDb().prepare('SELECT * FROM prompt_packs WHERE id = ?').get(id);
  return r ? (r as unknown as PackRow) : null;
}

export function insertPack(name: string, url: string): PackRow {
  const id = newId();
  const t = nowMs();
  getDb()
    .prepare('INSERT INTO prompt_packs (id, name, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, url, t, t);
  return getPack(id)!;
}

// 本地文件包：文本在浏览器就读好了，落库即视为"已抓取"，没有外链可抓。
// url 留空满足 NOT NULL；来源记 local，原文件名记 file_name 供卡片显示。
export function insertLocalPack(name: string, fileName: string, content: string, bytes: number): PackRow {
  const id = newId();
  const t = nowMs();
  getDb()
    .prepare(
      `INSERT INTO prompt_packs (id, name, url, source, file_name, content, content_bytes, fetch_status, fetch_message, fetched_at, created_at, updated_at)
       VALUES (?, ?, '', 'local', ?, ?, ?, 'ok', ?, ?, ?, ?)`,
    )
    .run(id, name, fileName, content, bytes, `本地导入：${bytes} 字节`, t, t, t);
  return getPack(id)!;
}

export function updatePack(id: string, input: { name?: string; url?: string }): void {
  const cur = getPack(id);
  if (!cur) throw new Error('提示词包不存在');
  const urlChanged = input.url !== undefined && input.url !== cur.url;
  getDb()
    .prepare('UPDATE prompt_packs SET name = ?, url = ?, updated_at = ? WHERE id = ?')
    .run(input.name ?? cur.name, input.url ?? cur.url, nowMs(), id);
  // 换了外链，旧缓存就不再代表这个地址的内容，清掉并标记为待抓取
  if (urlChanged) {
    getDb()
      .prepare("UPDATE prompt_packs SET content = NULL, content_bytes = NULL, fetch_status = 'never', fetch_message = NULL, fetched_at = NULL WHERE id = ?")
      .run(id);
  }
}

export function deletePack(id: string): void {
  getDb().prepare('DELETE FROM prompt_packs WHERE id = ?').run(id);
}

// 本地包编辑：只改名时不动缓存；带了新 content 就是"重新导入"，整体替换文本与字节数。
export function updateLocalPack(
  id: string,
  input: { name?: string; fileName?: string; content?: string; bytes?: number },
): void {
  const cur = getPack(id);
  if (!cur) throw new Error('提示词包不存在');
  const t = nowMs();
  if (input.content === undefined) {
    getDb().prepare('UPDATE prompt_packs SET name = ?, updated_at = ? WHERE id = ?').run(input.name ?? cur.name, t, id);
    return;
  }
  const bytes = input.bytes ?? 0;
  getDb()
    .prepare(
      `UPDATE prompt_packs SET name = ?, file_name = ?, content = ?, content_bytes = ?, fetch_status = 'ok', fetch_message = ?, fetched_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.name ?? cur.name, input.fileName ?? cur.file_name, input.content, bytes, `本地导入：${bytes} 字节`, t, t, id);
}

export function saveFetch(
  id: string,
  result: { status: 'ok' | FailureKind; message: string; content?: string; bytes?: number },
): void {
  getDb()
    .prepare(
      `UPDATE prompt_packs SET fetch_status = ?, fetch_message = ?, content = ?, content_bytes = ?, fetched_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      result.status,
      result.message,
      result.status === 'ok' ? (result.content ?? null) : null,
      result.status === 'ok' ? (result.bytes ?? null) : null,
      nowMs(),
      nowMs(),
      id,
    );
}