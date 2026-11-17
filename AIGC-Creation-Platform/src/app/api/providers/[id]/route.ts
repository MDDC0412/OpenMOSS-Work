import { z } from 'zod';
import { HttpError, json, paramId, readJson, route } from '~/lib/http';
import { toPublic } from '~/lib/providers/public';
import { deleteProvider, getProvider, updateProvider } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 全部可选：只传要改的字段。api_key 传空字符串等于"不改"，
// 所以编辑表单不需要把明文密钥回传给浏览器再传回来。
// models_endpoint 允许空串：表示这家供应商没有模型列表接口，模型全靠手工加。
const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  base_url: z.string().trim().min(1).optional(),
  api_key: z.string().trim().optional(),
  models_endpoint: z.string().trim().optional(),
  gateway_hint: z.enum(['auto', 'string', 'newapi']).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const row = getProvider(await paramId(ctx));
    if (!row) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    return json({ provider: toPublic(row) });
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    const input = await readJson(req, patchSchema);
    updateProvider(id, input);
    return json({ provider: toPublic(getProvider(id)!) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    // 只删供应商和它的模型清单；会话与作品保留，删配置不等于删历史
    deleteProvider(id);
    return json({ ok: true });
  });
}