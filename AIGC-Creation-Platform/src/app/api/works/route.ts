import { json, route } from '~/lib/http';
import { toPublicWork } from '~/lib/works/public';
import { listWorks } from '~/lib/works/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 作品库全量列表，按生成时间倒序。个人自用规模不大，分页交给界面做。
export async function GET(): Promise<Response> {
  return route(async () => json({ works: listWorks().map(toPublicWork) }));
}