import { HttpError, json, paramId, route } from '~/lib/http';
import { runCheck } from '~/lib/providers/check';
import { toPublic } from '~/lib/providers/public';
import { getProvider } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 体检最长等 20 秒，给路由留足余量，别让 Next 先把它掐掉
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const row = getProvider(await paramId(ctx));
    if (!row) throw new HttpError(404, '这个供应商不存在，可能已经被删掉了');
    const check = await runCheck(row);
    return json({ check, provider: toPublic(getProvider(row.id)!) });
  });
}