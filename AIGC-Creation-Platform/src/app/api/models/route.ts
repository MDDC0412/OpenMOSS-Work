import { json, route } from '~/lib/http';
import { listModels, listProviders } from '~/lib/providers/repo';
import type { ModelKind } from '~/lib/providers/classify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 跨供应商的模型总表，带供应商名字。对话/生图页的选择器一次请求就能拿到全部候选，
// 不用为每家供应商各拉一遍清单。
export async function GET(req: Request): Promise<Response> {
  return route(async () => {
    const kind = new URL(req.url).searchParams.get('kind') as ModelKind | null;
    const providers = listProviders();
    const rows = providers.flatMap((p) =>
      listModels(p.id)
        .filter((m) => !kind || m.kind === kind)
        .map((m) => ({
          provider_id: p.id,
          provider_name: p.name,
          model_id: m.model_id,
          display_name: m.display_name,
          kind: m.kind,
        })),
    );
    return json({ models: rows });
  });
}