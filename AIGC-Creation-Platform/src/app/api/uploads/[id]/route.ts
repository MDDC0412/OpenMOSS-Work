import { HttpError, paramId, route } from '~/lib/http';
import { readUpload, sniffMime } from '~/lib/works/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// 原图回显。safeChildPath 会把文件名压成 basename，../ 一类穿越拿不到目录外的东西
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const name = await paramId(ctx);
    let buf: Uint8Array<ArrayBuffer>;
    try {
      buf = await readUpload(name);
    } catch {
      throw new HttpError(404, '这张原图不在本机了');
    }
    return new Response(buf, {
      headers: { 'Content-Type': sniffMime(buf).mime, 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  });
}