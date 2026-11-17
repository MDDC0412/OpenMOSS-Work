import { z } from 'zod';
import { normalizeError } from '~/lib/errors';
import { HttpError, json, readJson, route } from '~/lib/http';
import { getProvider } from '~/lib/providers/repo';
import { readGenerated, readUpload, saveGenerated } from '~/lib/works/files';
import { getWork, insertWork, newId } from '~/lib/works/repo';
import { toPublicWork } from '~/lib/works/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 超分 4K 一般在 10-30 秒，但慢机器留足余量
export const maxDuration = 300;

const schema = z.object({
  providerId: z.string().min(1),
  // 二选一：作品库里的图，或上传目录里的图
  sourceWorkId: z.string().nullable().default(null),
  sourceFileName: z.string().nullable().default(null),
  targetEdge: z.number().int().min(256).max(8192),
  tile: z.number().int().min(64).max(1024).optional(),
});

// 本地服务的 base_url 通常写成 http://127.0.0.1:8188/v1，
// 超分接口挂在根下的 /v1/upscale，这里把两种情况都兜住。
function upscaleUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/upscale` : `${base}/v1/upscale`;
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, schema);
    const provider = getProvider(input.providerId);
    if (!provider) throw new HttpError(404, '供应商不存在，去供应商页看看是不是被删了');

    // 取源图字节
    let buf: Uint8Array<ArrayBuffer>;
    let sourceLabel: string;
    if (input.sourceWorkId) {
      const work = getWork(input.sourceWorkId);
      if (!work) throw new HttpError(404, '选中的作品已不在作品库，可能刚被删掉');
      buf = await readGenerated(work.file_name);
      sourceLabel = `work:${work.id}`;
    } else if (input.sourceFileName) {
      buf = await readUpload(input.sourceFileName);
      sourceLabel = input.sourceFileName;
    } else {
      throw new HttpError(400, '要先选一张图：上传，或从作品库挑一张');
    }

    const b64 = Buffer.from(buf).toString('base64');

    let res: Response;
    try {
      res = await fetch(upscaleUrl(provider.base_url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          image: b64,
          target_edge: input.targetEdge,
          ...(input.tile ? { tile: input.tile } : {}),
        }),
        signal: AbortSignal.timeout(maxDuration * 1000 - 5000),
      });
    } catch (err) {
      throw new HttpError(502, `连不上超分服务：${normalizeError(err).message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; detail?: string };
        detail = parsed.error?.message ?? parsed.detail ?? detail;
      } catch {
        // 非 JSON 就用原文
      }
      throw new HttpError(res.status, `超分服务返回 ${res.status}：${detail}`);
    }

    let parsed: { b64_json?: string; width?: number; height?: number };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new HttpError(502, '超分服务返回的不是 JSON');
    }
    if (!parsed.b64_json) throw new HttpError(502, '超分服务没返回图片数据');

    const outBuf = new Uint8Array(Buffer.from(parsed.b64_json, 'base64'));
    const id = newId();
    const saved = await saveGenerated(id, outBuf);

    const work = insertWork({
      id,
      provider_id: provider.id,
      model_id: 'upscale-4x',
      kind: 'image',
      prompt: '',
      params: JSON.stringify({
        mode: 'upscale',
        target_edge: input.targetEdge,
        width: parsed.width ?? null,
        height: parsed.height ?? null,
      }),
      file_name: saved.fileName,
      mime_type: saved.mime,
      bytes: saved.bytes,
      source_image: sourceLabel,
    });

    return json({ work: toPublicWork(work), width: parsed.width, height: parsed.height });
  });
}
