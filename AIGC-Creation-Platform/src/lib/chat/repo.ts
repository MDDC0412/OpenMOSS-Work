import { getDb, newId, nowMs } from '../db';

export interface ConversationRow {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  pack_ids: string | null;
  created_at: number;
}

export function listConversations(): ConversationRow[] {
  return getDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as unknown as ConversationRow[];
}

export function getConversation(id: string): ConversationRow | null {
  const r = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  return r ? (r as unknown as ConversationRow) : null;
}

export function createConversation(input: {
  title: string;
  providerId: string | null;
  modelId: string | null;
}): ConversationRow {
  const id = newId();
  const t = nowMs();
  getDb()
    .prepare('INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.title, input.providerId, input.modelId, t, t);
  return getConversation(id)!;
}

export function touchConversation(id: string, input: { title?: string; providerId?: string; modelId?: string }): void {
  const cur = getConversation(id);
  if (!cur) throw new Error('会话不存在');
  getDb()
    .prepare('UPDATE conversations SET title = ?, provider_id = ?, model_id = ?, updated_at = ? WHERE id = ?')
    .run(input.title ?? cur.title, input.providerId ?? cur.provider_id, input.modelId ?? cur.model_id, nowMs(), id);
}

export function deleteConversation(id: string): void {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listMessages(conversationId: string): MessageRow[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId) as unknown as MessageRow[];
}

export function addMessage(input: {
  conversationId: string;
  role: MessageRow['role'];
  content: string;
  packIds?: string[];
}): MessageRow {
  const id = newId();
  getDb()
    .prepare('INSERT INTO messages (id, conversation_id, role, content, pack_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.conversationId, input.role, input.content, input.packIds?.length ? JSON.stringify(input.packIds) : null, nowMs());
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow;
}

// 流式中途被打断时把已收到的半截回答落盘，历史里不至于留一条空白
export function setMessageContent(id: string, content: string): void {
  getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
}