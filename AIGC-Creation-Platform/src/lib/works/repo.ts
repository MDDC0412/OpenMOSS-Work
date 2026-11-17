import { getDb, newId, nowMs } from '../db';

export interface WorkRow {
  id: string;
  provider_id: string;
  model_id: string;
  kind: 'image';
  prompt: string;
  params: string;
  file_name: string;
  mime_type: string;
  bytes: number | null;
  source_image: string | null;
  created_at: number;
}

export interface WorkListItem extends WorkRow {
  provider_name: string | null;
}

// 作品库列表连供应商名字一起取：供应商被删后作品仍要能看，所以用 LEFT JOIN
export function listWorks(): WorkListItem[] {
  return getDb()
    .prepare(
      `SELECT w.*, p.name AS provider_name
       FROM works w LEFT JOIN providers p ON p.id = w.provider_id
       ORDER BY w.created_at DESC`,
    )
    .all() as unknown as WorkListItem[];
}

export function getWork(id: string): WorkListItem | null {
  const r = getDb()
    .prepare(
      `SELECT w.*, p.name AS provider_name
       FROM works w LEFT JOIN providers p ON p.id = w.provider_id
       WHERE w.id = ?`,
    )
    .get(id);
  return r ? (r as unknown as WorkListItem) : null;
}

export function insertWork(input: Omit<WorkRow, 'created_at'>): WorkListItem {
  getDb()
    .prepare(
      `INSERT INTO works (id, provider_id, model_id, kind, prompt, params, file_name, mime_type, bytes, source_image, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.provider_id,
      input.model_id,
      input.kind,
      input.prompt,
      input.params,
      input.file_name,
      input.mime_type,
      input.bytes,
      input.source_image,
      nowMs(),
    );
  return getWork(input.id)!;
}

export function deleteWork(id: string): void {
  getDb().prepare('DELETE FROM works WHERE id = ?').run(id);
}

export { newId };