'use client';

import { App, Button, Segmented, Spin } from 'antd';
import { Images, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '~/components/PageHeader';
import WorkCard from '~/components/works/WorkCard';
import { api, ApiError } from '~/lib/client/api';
import type { PublicWork } from '~/lib/works/public';

type ModeFilter = 'all' | 'generate' | 'edit';

// 作品库：本机存档的总览。卡片与生图页的"本次结果"共用 WorkCard，
// 这里只多一层方式筛选与删除后的刷新，不重复造卡片。
export default function WorksView() {
  const { message } = App.useApp();
  const router = useRouter();
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ModeFilter>('all');

  const load = useCallback(async () => {
    try {
      const { works: rows } = await api.get<{ works: PublicWork[] }>('/api/works');
      setWorks(rows);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  // 文生图/改图按作品记录的 mode 分；params 已是解开的对象，mode 必有值
  const shown = useMemo(() => works.filter((w) => filter === 'all' || w.params.mode === filter), [works, filter]);

  async function remove(id: string) {
    try {
      await api.del(`/api/works/${id}`);
      message.success('已删除，图片文件一起清掉了');
      await load();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Works · 存档"
        title="作品库"
        description="生成的图都落在本机项目目录之外，随时回看当时的提示词与参数、重新下载。删除会连图片文件一起删掉，无法恢复。"
        actions={
          <Button icon={<RefreshCw size={15} />} onClick={() => void load()}>
            刷新
          </Button>
        }
      />

      {loading ? (
        <div className="panel grid place-items-center py-20">
          <Spin />
        </div>
      ) : works.length === 0 ? (
        /* 空状态给一条明确的下一步：去生图页创作，结果会自动收进来 */
        <div className="panel rise px-8 py-14 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border border-line bg-ink-800">
            <Images size={20} className="text-bone-faint" strokeWidth={1.5} />
          </div>
          <h2 className="display mt-4 text-[19px] text-bone">还没有作品</h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-[13px] text-bone-dim">去生图页创作第一张，结果会自动收进这里。</p>
          <Link href="/image" className="mt-6 inline-block">
            <Button type="primary">去生图</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* 工具条：方式筛选 + 计数。作品多了以后按文生图/改图分开看 */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              value={filter}
              onChange={(v) => setFilter(v as ModeFilter)}
              options={[
                { label: '全部', value: 'all' },
                { label: '文生图', value: 'generate' },
                { label: '改图', value: 'edit' },
              ]}
            />
            <span className="mono text-[11.5px] text-bone-faint">
              {shown.length} / {works.length} 件
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="panel rise px-8 py-12 text-center text-[13px] text-bone-dim">这个分类下还没有作品</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((w, i) => (
                // 入场错峰封顶 12 格，作品很多时不至于让最后一排等太久才浮现
                <div key={w.id} className="rise" style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}>
                  <WorkCard
                    work={w}
                    onDelete={() => void remove(w.id)}
                    onEdit={() => router.push(`/image?edit=${w.id}`)}
                    onUpscale={() => router.push(`/upscale?work=${w.id}`)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}