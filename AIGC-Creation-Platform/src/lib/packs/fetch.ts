import { normalizeError, normalizeHttpError } from '../errors';
import { getPack, saveFetch, type PackRow } from './repo';

const FETCH_TIMEOUT_MS = 15_000;
// 提示词包文本上限 5MB（用户定的口径）。导出给建包/改包接口复用，
// 本地导入与外链抓取共用同一上限。
export const MAX_BYTES = 5 * 1024 * 1024;

export interface FetchOutcome {
  status: 'ok' | 'error';
  message: string;
  pack: PackRow;
}

// 抓外链文本并缓存。只认 http/https；返回非 2xx 或超限时按失败记录，
// 失败时保留上一次的成功缓存不动，避免一次抓失败就把能用的包弄没。
export async function fetchPack(id: string): Promise<FetchOutcome> {
  const pack = getPack(id);
  if (!pack) throw new Error('提示词包不存在');

  // 本地文件包没有外链可抓：直接拒绝，且绝不 saveFetch——失败分支会把 content 清成 null，
  // 那等于把用户已导入的文本弄没。这里原样返回，缓存不动。
  if (pack.source === 'local') {
    return { status: 'error', message: '本地文件包没有外链，点「重新导入」换个文件', pack };
  }

  let url: URL;
  try {
    url = new URL(pack.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    const message = '外链地址不合法：只支持 http/https 网址';
    saveFetch(id, { status: 'url', message });
    return { status: 'error', message, pack: getPack(id)! };
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/plain, text/*;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const norm = normalizeHttpError(res.status, await res.text());
      saveFetch(id, { status: norm.kind, message: norm.message });
      return { status: 'error', message: norm.message, pack: getPack(id)! };
    }

    // 先按字节限流读，避免一个超大文件把内存吃满
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      const message = `文件太大：${buf.byteLength} 字节，超过 ${MAX_BYTES} 字节（5MB）上限`;
      saveFetch(id, { status: 'badresponse', message });
      return { status: 'error', message, pack: getPack(id)! };
    }

    const content = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (!content.trim()) {
      const message = '抓到的是空文件：这个外链目前没有内容';
      saveFetch(id, { status: 'badresponse', message });
      return { status: 'error', message, pack: getPack(id)! };
    }

    const message = `抓取成功：${buf.byteLength} 字节`;
    saveFetch(id, { status: 'ok', message, content, bytes: buf.byteLength });
    return { status: 'ok', message, pack: getPack(id)! };
  } catch (err) {
    const norm = normalizeError(err);
    saveFetch(id, { status: norm.kind, message: norm.message });
    return { status: 'error', message: norm.message, pack: getPack(id)! };
  }
}

// 回放历史时只用缓存里的包内容，不再发网络请求：
// 历史消息的 prompt 要尽量还原当时发出去的样子，但不能因为回放而去抓外链。
export function cachedPackTexts(ids: string[]): { id: string; name: string; content: string }[] {
  const out: { id: string; name: string; content: string }[] = [];
  for (const id of ids) {
    const pack = getPack(id);
    if (pack && pack.fetch_status === 'ok' && pack.content != null) {
      out.push({ id: pack.id, name: pack.name, content: pack.content });
    }
  }
  return out;
}

// 发送对话/生图时把选中的包解析成要追加的文本。
// 没抓过的包在这里现抓一次，用户忘了点"抓取"也不会导致 @ 了个空包。
export async function resolvePackTexts(ids: string[]): Promise<{ id: string; name: string; content: string }[]> {
  const out: { id: string; name: string; content: string }[] = [];
  for (const id of ids) {
    let pack = getPack(id);
    if (!pack) continue;
    if (pack.fetch_status !== 'ok' || pack.content == null) {
      const outcome = await fetchPack(id);
      if (outcome.status !== 'ok') throw new Error(`提示词包「${pack.name}」抓不下来：${outcome.message}`);
      pack = outcome.pack;
    }
    out.push({ id: pack.id, name: pack.name, content: pack.content ?? '' });
  }
  return out;
}