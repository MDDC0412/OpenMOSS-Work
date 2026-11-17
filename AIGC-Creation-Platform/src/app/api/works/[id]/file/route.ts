import { HttpError, paramId, route } from '~/lib/http';
import { readGenerated } from '~/lib/works/files';
import { getWork } from '~/lib/works/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// 取图。?download=1 按附件下载，否则内嵌显示；作品库的缩略图与大图共用这个地址。
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const id = await paramId(ctx);
    const work = getWork(id);
    if (!work) throw new HttpError(404, '这件作品不存在');
    let buf: Uint8Array<ArrayBuffer>;
    try {
      buf = await readGenerated(work.file_name);
    } catch {
      throw new HttpError(404, '图片文件不在本机了，生成目录可能被清理过');
    }
    const download = new URL(req.url).searchParams.get('download') === '1';
    return new Response(buf, {
      headers: {
        'Content-Type': work.mime_type,
        'Cache-Control': 'private, max-age=31536000, immutable',
        // file_name 是 uuid.扩展名，不含引号或换行，直接拼进头是安全的
        ...(download ? { 'Content-Disposition': `attachment; filename="${work.file_name}"` } : {}),
      },
    });
  });
}