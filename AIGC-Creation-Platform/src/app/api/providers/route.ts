import { z } from 'zod';
import { HttpError, json, readJson, route } from '~/lib/http';
import { runCheck } from '~/lib/providers/check';
import { toPublic } from '~/lib/providers/public';
import { insertProvider, listProviders } from '~/lib/providers/repo';

// node:sqlite 只能在 Node 运行时跑，Edge 运行时没有这个内置模块
export const runtime = 'nodejs';
// 供应商列表带体检状态，必须每次现读，不能被 Next 缓存
export const dynamic = 'force-dynamic';

// 名称/地址/密钥必填；模型列表接口地址可以留空——留空表示这家供应商没有这个接口，
// 体检会跳过拉取，模型全靠手工加。
const createSchema = z.object({
  name: z.string().trim().min(1, '要填个名字').max(60, '名字太长了'),
  base_url: z.string().trim().min(1, '要填 Base URL'),
  api_key: z.string().trim().min(1, '要填 API Key'),
  models_endpoint: z.string().trim().default('/v1/models'),
  gateway_hint: z.enum(['auto', 'string', 'newapi']).default('auto'),
});

export async function GET(): Promise<Response> {
  return route(async () => json({ providers: listProviders().map(toPublic) }));
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, createSchema);
    const row = insertProvider(input);
    // 建完立刻体检：用户填完三项就能马上知道 Key/BaseURL/网络到底通不通，
    // 不用再点一次按钮。体检失败也保留这条记录，方便回去改。
    const check = await runCheck(row);
    const fresh = listProviders().find((p) => p.id === row.id);
    if (!fresh) throw new HttpError(500, '刚建的供应商读不回来');
    return json({ provider: toPublic(fresh), check }, 201);
  });
}