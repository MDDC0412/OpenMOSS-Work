import { DatabaseSync } from 'node:sqlite';
import { dbPath, ensureDirs } from './paths';

// 建表语句集中在一处，改结构时只看这里。
// 用 CREATE TABLE IF NOT EXISTS，启动即自动建库，不需要单独的迁移命令。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  base_url             TEXT NOT NULL,
  api_key              TEXT NOT NULL,
  models_endpoint      TEXT NOT NULL,
  gateway_hint         TEXT NOT NULL DEFAULT 'auto',
  last_check_at        INTEGER,
  last_check_status    TEXT,
  last_check_message   TEXT,
  last_check_latency_ms INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- 模型用途有三个来源，优先级 manual > provider > guess。
-- 体检刷新时只覆盖 provider/guess 的行，手工改过的行永不被冲掉。
CREATE TABLE IF NOT EXISTS models (
  provider_id   TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  display_name  TEXT,
  owned_by      TEXT,
  raw_type      TEXT,
  kind          TEXT NOT NULL,
  kind_source   TEXT NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  provider_id TEXT,
  model_id    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  pack_ids        TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  params       TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  bytes        INTEGER,
  source_image TEXT,
  created_at   INTEGER NOT NULL
);

-- 提示词包有两种来源：url（外链文本，靠抓取）与 local（本地文件，导入即缓存）。
-- 包体就是文本，不做任何解析拆条。local 包没有网址，url 留空、file_name 记原文件名。
CREATE TABLE IF NOT EXISTS prompt_packs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'url',
  file_name     TEXT,
  content       TEXT,
  content_bytes INTEGER,
  fetch_status  TEXT NOT NULL DEFAULT 'never',
  fetch_message TEXT,
  fetched_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 记住每个用途上次选的供应商与模型，省掉单独的设置页
CREATE TABLE IF NOT EXISTS preferences (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// HMR 会反复执行模块，用 globalThis 缓存连接，否则开发期会开出一堆句柄把库锁住。
const globalForDb = globalThis as unknown as { __aigcDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__aigcDb) return globalForDb.__aigcDb;
  ensureDirs();
  const db = new DatabaseSync(dbPath());
  // WAL 让读写不互相阻塞：一边流式写消息一边刷作品库时不会撞锁
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  globalForDb.__aigcDb = db;
  return db;
}

// 迁移数据目录前调用：先把 WAL 收进主文件再关连接，
// 否则 Windows 上 -wal / -shm 句柄不释放，目录搬不动。
export function closeDb(): void {
  const db = globalForDb.__aigcDb;
  if (!db) return;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  globalForDb.__aigcDb = undefined;
}

// CREATE TABLE IF NOT EXISTS 不会给已存在的表补列。本地文件导入是后加的功能，
// 老库里可能没有 source / file_name 这两列，这里按需补上，重复执行无副作用。
function migrate(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(prompt_packs)').all() as unknown as { name: string }[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('source')) db.exec("ALTER TABLE prompt_packs ADD COLUMN source TEXT NOT NULL DEFAULT 'url'");
  if (!have.has('file_name')) db.exec('ALTER TABLE prompt_packs ADD COLUMN file_name TEXT');
}

export function nowMs(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}