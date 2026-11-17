import { HttpError, json, paramId, route } from '~/lib/http';
import { fetchPack } from '~/lib/packs/fetch';
import { getPack } from '~/lib/packs/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

// 重新抓取：外链内容更新后点一下，缓存就换成新的
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    if (!getPack(id)) throw new HttpError(404, '这个提示词包不存在');
    const outcome = await fetchPack(id);
    return json({ pack: outcome.pack, fetch: { status: outcome.status, message: outcome.message } });
  });
}