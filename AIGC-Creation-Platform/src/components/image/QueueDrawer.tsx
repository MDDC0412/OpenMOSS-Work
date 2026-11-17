'use client';

import { Button, Drawer, Empty, Tag, Tooltip } from 'antd';
import { CircleCheck, CircleX, Clock, Loader2, Square, Trash2, XCircle } from 'lucide-react';
import { useImageJob, type QueueTask } from '~/components/image/ImageJobProvider';

const STATUS_META: Record<
  QueueTask['status'],
  { label: string; color: string; icon: ReactNodeLike }
> = {
  pending: { label: '排队中', color: 'default', icon: Clock },
  running: { label: '处理中', color: 'processing', icon: Loader2 },
  done: { label: '已完成', color: 'success', icon: CircleCheck },
  failed: { label: '失败', color: 'error', icon: CircleX },
  canceled: { label: '已取消', color: 'warning', icon: XCircle },
};

type ReactNodeLike = typeof Clock;

function elapsed(from: number, to?: number): string {
  const ms = (to ?? Date.now()) - from;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}m${rest.toString().padStart(2, '0')}s`;
}

export default function QueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tasks, current, cancel, clearDone } = useImageJob();

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const finishedCount = tasks.filter(
    (t) => t.status === 'done' || t.status === 'failed' || t.status === 'canceled',
  ).length;

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <span>任务队列</span>
          {pendingCount > 0 ? <Tag color="processing">{pendingCount} 个待处理</Tag> : null}
          {current ? <Tag color="blue">1 个处理中</Tag> : null}
        </div>
      }
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      extra={
        finishedCount > 0 ? (
          <Tooltip title="清掉已完成/失败/取消的任务，不影响作品库">
            <Button size="small" icon={<Trash2 size={13} />} onClick={clearDone}>
              清理
            </Button>
          </Tooltip>
        ) : null
      }
    >
      <p className="mono mb-3 text-[10.5px] leading-relaxed text-bone-faint">
        严格串行：一次只处理 1 个。你的 GPU 只有一块，并发只会让后面的任务排队等到超时。
        关掉页面或刷新会清空队列，已经出完的图在作品库里不会丢。
      </p>

      {tasks.length === 0 ? (
        <Empty description="队列是空的，去生图或超分页添加任务" />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const meta = STATUS_META[t.status];
            const Icon = meta.icon;
            const canCancel = t.status === 'pending' || t.status === 'running';
            return (
              <div
                key={t.id}
                className="rounded-lg border border-line-soft bg-ink-950 p-2.5"
                data-status={t.status}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    size={14}
                    className={
                      t.status === 'running'
                        ? 'mt-0.5 shrink-0 animate-spin text-amber'
                        : 'mt-0.5 shrink-0 text-bone-faint'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Tag color={meta.color} className="!m-0 !text-[10px]">
                        {meta.label}
                      </Tag>
                      <span className="mono text-[10px] text-bone-faint">
                        {t.kind === 'image' ? '生图' : '超分'}
                      </span>
                      {t.works.length > 0 ? (
                        <span className="mono text-[10px] text-bone-faint">· {t.works.length} 张</span>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-bone-dim" title={t.label}>
                      {t.label}
                    </div>
                    <div className="mono mt-1 text-[10px] text-bone-faint">
                      {t.status === 'running' && t.startedAt
                        ? `已用 ${elapsed(t.startedAt)}`
                        : t.finishedAt
                          ? `用时 ${elapsed(t.startedAt ?? t.createdAt, t.finishedAt)}`
                          : '等待中'}
                      {t.error ? <span className="text-red-400"> · {t.error.slice(0, 60)}</span> : null}
                    </div>
                  </div>
                  {canCancel ? (
                    <Tooltip title={t.status === 'running' ? '停止当前任务' : '从队列移除'}>
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<Square size={12} />}
                        onClick={() => cancel(t.id)}
                      />
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
