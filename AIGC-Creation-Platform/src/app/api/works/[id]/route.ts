import { HttpError, json, paramId, route } from '~/lib/http';
import { removeGenerated } from '~/lib/works/files';
import { toPublicWork } from '~/lib/works/public';
import { deleteWork, getWork } from '~/lib/works/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const work = getWork(await paramId(ctx));
    if (!work) throw new HttpError(404, '这件作品不存在');
    return json({ work: toPublicWork(work) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    const work = getWork(id);
    if (!work) throw new HttpError(404, '这件作品不存在');
    try {
      await removeGenerated(work.file_name);
    } catch (err) {
      // 生成目录被手工清过、文件已经不在了，不算错误；占用/权限一类问题要报出来
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    deleteWork(id);
    return json({ ok: true });
  });
}