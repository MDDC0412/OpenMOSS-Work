import { z } from 'zod';
import { changeDataDir } from '~/lib/dataDir';
import { HttpError, json, readJson, route } from '~/lib/http';
import { dataRoot, defaultDataRoot } from '~/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return route(async () => json({ dir: dataRoot(), defaultDir: defaultDataRoot() }));
}

const schema = z.object({ dir: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const { dir } = await readJson(req, schema);
    try {
      return json({ dir: changeDataDir(dir) });
    } catch (err) {
      // 迁移的拒绝理由都是写给人看的，直接透传成 400
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  });
}