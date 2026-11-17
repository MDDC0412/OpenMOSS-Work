import { z } from 'zod';
import { HttpError, json, paramId, readJson, route } from '~/lib/http';
import { deleteConversation, getConversation, listMessages, touchConversation } from '~/lib/chat/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    const conversation = getConversation(id);
    if (!conversation) throw new HttpError(404, '这个会话不存在');
    return json({ conversation, messages: listMessages(id) });
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getConversation(id)) throw new HttpError(404, '这个会话不存在');
    touchConversation(id, await readJson(req, patchSchema));
    return json({ conversation: getConversation(id) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getConversation(id)) throw new HttpError(404, '这个会话不存在');
    deleteConversation(id);
    return json({ ok: true });
  });
}