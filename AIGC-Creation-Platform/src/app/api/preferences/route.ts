import { z } from 'zod';
import { HttpError, json, readJson, route } from '~/lib/http';
import { getPreference, setPreference } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 记住"上次用的供应商+模型"，键名由调用方约定，例如 last:chat / last:image
const putSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(500),
});

export async function GET(req: Request): Promise<Response> {
  return route(async () => {
    const key = new URL(req.url).searchParams.get('key');
    if (!key) throw new HttpError(400, '要带上 key 参数');
    return json({ key, value: getPreference(key) });
  });
}

export async function PUT(req: Request): Promise<Response> {
  return route(async () => {
    const { key, value } = await readJson(req, putSchema);
    setPreference(key, value);
    return json({ ok: true });
  });
}