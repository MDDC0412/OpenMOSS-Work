import { z } from 'zod';
import { HttpError, json, readJson, route } from '~/lib/http';
import { fetchPack, MAX_BYTES } from '~/lib/packs/fetch';
import { insertLocalPack, insertPack, listPacks } from '~/lib/packs/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 两种来源共用一个名字字段：url 包要外链地址，local 包要文件名 + 已读好的文本。
// 用 superRefine 按来源分别校验，避免把"本地包没填 url"误判成错误。
const createSchema = z
  .object({
    name: z.string().trim().min(1, '要填个名字').max(60),
    source: z.enum(['url', 'local']).default('url'),
    url: z.string().trim().optional(),
    fileName: z.string().trim().optional(),
    content: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.source === 'url') {
      if (!v.url) ctx.addIssue({ code: 'custom', message: '要填外链地址', path: ['url'] });
    } else {
      if (!v.fileName) ctx.addIssue({ code: 'custom', message: '缺文件名', path: ['fileName'] });
      if (!v.content || !v.content.trim()) ctx.addIssue({ code: 'custom', message: '本地文件是空的', path: ['content'] });
    }
  });

export async function GET(): Promise<Response> {
  return route(async () => json({ packs: listPacks() }));
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, createSchema);

    // 本地文件：文本已在浏览器读好，这里只做字节上限把关，落库即可用，不发网络请求。
    if (input.source === 'local') {
      const content = input.content!;
      const bytes = new TextEncoder().encode(content).byteLength;
      if (bytes > MAX_BYTES) {
        throw new HttpError(413, `文件太大：${bytes} 字节，超过 ${MAX_BYTES} 字节（5MB）上限`);
      }
      const pack = insertLocalPack(input.name, input.fileName!, content, bytes);
      return json({ pack, fetch: { status: 'ok', message: `本地导入：${bytes} 字节` } }, 201);
    }

    // 外链：建完立刻抓一次，用户马上能看到这个地址到底是不是可用的文本
    const pack = insertPack(input.name, input.url!);
    const outcome = await fetchPack(pack.id);
    return json({ pack: outcome.pack, fetch: { status: outcome.status, message: outcome.message } }, 201);
  });
}