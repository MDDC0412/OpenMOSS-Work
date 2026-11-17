import { z } from 'zod';
import { HttpError, json, paramId, readJson, route } from '~/lib/http';
import { addModelManually, getProvider, listModels, removeModel, setModelKind } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kindSchema = z.object({
  model_id: z.string().min(1),
  kind: z.enum(['chat', 'image', 'video', 'other']),
});

const addSchema = z.object({
  model_id: z.string().trim().min(1, '要填模型 ID').max(200, '模型 ID 太长了'),
  kind: z.enum(['chat', 'image', 'video', 'other']).default('chat'),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    return json({ models: listModels(id) });
  });
}

// 手工改用途会写 kind_source='manual'，之后每次体检都不会覆盖它
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    const { model_id, kind } = await readJson(req, kindSchema);
    setModelKind(id, model_id, kind);
    return json({ models: listModels(id) });
  });
}

// 手工加模型：供应商没有 /v1/models 或列表里缺型号时，直接填模型 ID 加进来。
// 写 kind_source='manual'，所以下一次体检既不会改它的用途，也不会把它删掉。
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    const { model_id, kind } = await readJson(req, addSchema);
    addModelManually(id, model_id, kind);
    return json({ models: listModels(id) }, 201);
  });
}

// 删除走 query 而不是请求体：浏览器 fetch 允许 DELETE 带 body，但 api.del 统一不带，
// 为此扩一个只为一处用的重载不值得。
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getProvider(id)) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    const modelId = new URL(req.url).searchParams.get('model_id')?.trim();
    if (!modelId) throw new HttpError(400, '要指定要移除的模型 ID');
    removeModel(id, modelId);
    return json({ models: listModels(id) });
  });
}
