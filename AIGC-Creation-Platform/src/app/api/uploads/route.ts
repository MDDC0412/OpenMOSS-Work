import { HttpError, json, route } from '~/lib/http';
import { detectImage, saveUpload } from '~/lib/works/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// 改图的原图上传：multipart 进，落盘到项目外的 uploads 目录，返回可回显的地址。
// 只收图片魔数能认出来的文件，避免把任意文件当原图存进来。
export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, '没收到文件：表单里要有名为 file 的附件');
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, '原图超过 20MB，先压缩再传');
    const buf = new Uint8Array(await file.arrayBuffer());
    // 先验魔数再落盘：sniffMime 有"认不出当 png"的兜底，用它验等于没验
    if (!detectImage(buf)) throw new HttpError(400, '这个文件不是能识别的图片格式（只收 png / jpeg / webp / gif）');
    const saved = await saveUpload(buf);
    return json({ ...saved, url: `/api/uploads/${saved.fileName}` }, 201);
  });
}