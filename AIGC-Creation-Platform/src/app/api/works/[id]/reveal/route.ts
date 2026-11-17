import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, json, paramId, route } from '~/lib/http';
import { generatedDir, safeChildPath } from '~/lib/paths';
import { getWork } from '~/lib/works/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// 在系统文件管理器里定位作品文件：Windows 用 explorer /select 直接选中该文件，
// 其他平台退化为打开所在目录。参数走数组不经 shell，路径里的空格与特殊字符都安全。
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return route(async () => {
    const work = getWork(await paramId(ctx));
    if (!work) throw new HttpError(404, '这件作品不存在');
    const file = safeChildPath(generatedDir(), work.file_name);
    if (!fs.existsSync(file)) throw new HttpError(404, '图片文件不在本机了，可能已被手工删掉');

    if (process.platform === 'win32') {
      // explorer 不按标准规则解析命令行：整段加引号或逗号后带空格都会定位失败、
      // 兜底打开默认文件夹。必须是 /select,"路径" 原样拼进命令行，
      // 所以关掉 Node 的自动引号（windowsVerbatimArguments），只给路径部分加引号。
      spawn('explorer.exe', [`/select,"${file}"`], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      }).unref();
    } else {
      spawn('xdg-open', [path.dirname(file)], { detached: true, stdio: 'ignore' }).unref();
    }
    return json({ ok: true });
  });
}