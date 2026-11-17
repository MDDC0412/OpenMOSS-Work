'use client';

import { Modal, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '~/lib/client/api';
import type { PublicWork } from '~/lib/works/public';

function shortTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 改图原图选择器：弹出作品库网格，点一张即交给调用方当原图。
// 只负责"选"，选中后怎么用（上传口 / 作品引用）由调用方决定。
export default function WorkPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (work: PublicWork) => void;
}) {
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开都重新拉：作品库可能在别处刚生成 / 删除过，缓存会选到已删的图
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .get<{ works: PublicWork[] }>('/api/works')
      .then(({ works: rows }) => setWorks(rows))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal
      title="从作品库选原图"
      open={open}
      onCancel={onClose}
      footer={null}
      width={780}
      styles={{ body: { background: '#100e0c' }, header: { background: '#16130f' } }}
    >
      {loading ? (
        <div className="grid min-h-60 place-items-center">
          <Spin />
        </div>
      ) : error ? (
        <div className="grid min-h-60 place-items-center text-[12.5px] text-coral">作品库没拉出来：{error}</div>
      ) : works.length === 0 ? (
        <div className="grid min-h-60 place-items-center text-center">
          <div>
            <div className="display text-[15px] text-bone-dim">作品库还是空的</div>
            <p className="mt-1 text-[12.5px] text-bone-faint">先去生成几张，再回来挑一张当原图</p>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-[11.5px] text-bone-faint">点一张当作改图原图；直接引用作品文件，不会重复拷贝。</p>
          <div className="grid max-h-[56vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
            {works.map((w) => (
              <button
                key={w.id}
                type="button"
                className="group overflow-hidden rounded-lg border border-line-soft bg-ink-950 text-left transition-colors hover:border-amber"
                onClick={() => {
                  onPick(w);
                  onClose();
                }}
              >
                <img src={w.file_url} alt={w.prompt || w.model_id} className="aspect-square w-full object-cover" />
                <div className="border-t border-line-soft px-2 py-1.5">
                  <div className="mono truncate text-[10px] text-bone-dim" title={w.model_id}>
                    {w.model_id}
                  </div>
                  <div className="mono mt-0.5 text-[9.5px] text-bone-faint">{shortTime(w.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}