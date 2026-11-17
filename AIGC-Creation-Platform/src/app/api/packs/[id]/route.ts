import { z } from 'zod';
import { HttpError, json, paramId, readJson, route } from '~/lib/http';
import { MAX_BYTES } from '~/lib/packs/fetch';
import { deletePack, getPack, updateLocalPack, updatePack } from '~/lib/packs/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 外链包改名字/地址；本地包改名字或重新导入文本（带 content 即替换缓存）。
const urlPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: z.string().trim().min(1).optional(),
});
const localPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  fileName: z.string().trim().min(1).optional(),
  content: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    const pack = getPack(id);
    if (!pack) throw new HttpError(404, '这个提示词包不存在');

    if (pack.source === 'local') {
      const input = await readJson(req, localPatchSchema);
      let bytes: number | undefined;
      if (input.content !== undefined) {
        if (!input.content.trim()) throw new HttpError(400, '本地文件是空的');
        bytes = new TextEncoder().encode(input.content).byteLength;
        if (bytes > MAX_BYTES) throw new HttpError(413, `文件太大：${bytes} 字节，超过 ${MAX_BYTES} 字节上限`);
      }
      updateLocalPack(id, { ...input, bytes });
    } else {
      updatePack(id, await readJson(req, urlPatchSchema));
    }
    return json({ pack: getPack(id) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getPack(id)) throw new HttpError(404, '这个提示词包不存在');
    deletePack(id);
    return json({ ok: true });
  });
}