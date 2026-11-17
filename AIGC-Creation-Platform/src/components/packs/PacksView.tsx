'use client';

import { App, Button, Spin } from 'antd';
import { Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '~/components/PageHeader';
import { api, ApiError } from '~/lib/client/api';
import type { PackRow } from '~/lib/packs/repo';
import PackCard from './PackCard';
import PackForm, { type FetchInfo } from './PackForm';

// 提示词包管理：跨模态共用的一批文本（外链或本地文件）。列表 + 新建/编辑弹窗，
// 结构与供应商页一致（卡片自带动作，父层只管取数与刷新）。
export default function PacksView() {
  const { message } = App.useApp();
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PackRow | null>(null);

  const load = useCallback(async () => {
    try {
      const { packs: rows } = await api.get<{ packs: PackRow[] }>('/api/packs');
      setPacks(rows);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(p: PackRow) {
    setEditing(p);
    setFormOpen(true);
  }

  function onSaved(_pack: PackRow, fetch: FetchInfo) {
    setFormOpen(false);
    void load();
    // 抓取结论直接弹给用户：成功绿、失败黄，和新建供应商体检后的反馈一致
    if (fetch.status === 'ok') message.success(fetch.message);
    else message.warning(fetch.message);
  }

  return (
    <>
      <PageHeader
        eyebrow="Packs · 共用"
        title="提示词包"
        description="一段纯文本，可以填外链地址，也可以直接导入本地文件。在对话或生图里 @ 某个包，发送时就把它的文本追加进 prompt。对话、图片、视频共用同一批包，改一处到处生效。"
        actions={
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>
            添加提示词包
          </Button>
        }
      />

      {loading ? (
        <div className="panel grid place-items-center py-20">
          <Spin />
        </div>
      ) : packs.length === 0 ? (
        /* 空状态解释清楚"包是什么、怎么用"，再给一个添加入口 */
        <div className="panel rise px-8 py-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border border-line bg-ink-800">
            <Sparkles size={20} className="text-bone-faint" strokeWidth={1.5} />
          </div>
          <h2 className="display mt-4 text-[19px] text-bone">还没有提示词包</h2>
          <p className="mx-auto mt-2 max-w-[56ch] text-[13px] text-bone-dim">
            把常用提示词放在一段文本里：填个外链（自己的笔记、GitHub raw 文件都行）抓一次，或直接导入本地的 .txt / .md 文件，之后 @ 一下就能复用。
          </p>
          <Button type="primary" icon={<Plus size={15} />} className="mt-6" onClick={openCreate}>
            添加第一个包
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {packs.map((p, i) => (
            <div key={p.id} className="rise" style={{ animationDelay: `${i * 60}ms` }}>
              <PackCard pack={p} onEdit={() => openEdit(p)} onDeleted={load} onRefresh={load} />
            </div>
          ))}
        </div>
      )}

      <PackForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={onSaved} />
    </>
  );
}