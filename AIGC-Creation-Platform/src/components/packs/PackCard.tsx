'use client';

import { App, Button, Popconfirm, Tooltip } from 'antd';
import { ChevronDown, ExternalLink, FileText, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { StatusDot, statusMeta } from '~/components/CheckStatus';
import FailureNote from '~/components/FailureNote';
import { api, ApiError } from '~/lib/client/api';
import type { PackRow } from '~/lib/packs/repo';

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// 抓取状态比体检多一个 'never'（还没抓过），单独给个中性标签；
// 其余 ok / 各类失败直接复用体检那套颜色与短标签，全站口径一致。
function packMeta(status: PackRow['fetch_status']) {
  if (status === 'never') return { label: '未抓取', color: '#6f665a' };
  if (status === 'ok') return { label: '已抓取', color: '#79c3a0' };
  return statusMeta(status);
}

// 一个提示词包一张卡片：名字与外链、抓取结论、可展开的缓存文本。
// 抓取/删除后就地刷新列表，卡片实例按 id 保持稳定，展开状态不会丢。
export default function PackCard({
  pack,
  onEdit,
  onDeleted,
  onRefresh,
}: {
  pack: PackRow;
  onEdit: () => void;
  onDeleted: () => void;
  onRefresh: () => void;
}) {
  const { message } = App.useApp();
  const [fetching, setFetching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = packMeta(pack.fetch_status);
  const isLocal = pack.source === 'local';
  // 本地包导入即缓存，成功标签叫"已导入"而不是"已抓取"
  const statusLabel = isLocal && pack.fetch_status === 'ok' ? '已导入' : meta.label;
  const hasContent = pack.fetch_status === 'ok' && pack.content != null;

  async function refetch() {
    setFetching(true);
    try {
      const { fetch } = await api.post<{ fetch: { status: 'ok' | 'error'; message: string } }>(
        `/api/packs/${pack.id}/fetch`,
      );
      if (fetch.status === 'ok') message.success(fetch.message);
      else message.warning(fetch.message);
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setFetching(false);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/packs/${pack.id}`);
      message.success(`已删除「${pack.name}」`);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    }
  }

  return (
    <section className="panel overflow-hidden">
      {/* ── 卡头：状态灯 + 名字 + 外链 + 动作 ── */}
      <div className="flex items-start gap-4 px-5 pt-4.5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={pack.fetch_status === 'never' ? null : pack.fetch_status} pending={fetching} size={9} />
            <h2 className="display text-[17px] leading-none text-bone">{pack.name}</h2>
            <span className="text-[11.5px]" style={{ color: meta.color }}>
              {fetching ? '正在抓取…' : statusLabel}
            </span>
          </div>
          {isLocal ? (
            // 本地包没有网址：显示原文件名 + 「本地文件」标记，不做成链接
            <div className="mono mt-2 flex items-center gap-1.5 text-[11.5px] text-bone-faint" title={pack.file_name ?? ''}>
              <FileText size={11} className="shrink-0" />
              <span className="truncate">{pack.file_name ?? '本地文件'}</span>
              <span className="rounded border border-line px-1.5 py-px text-[9.5px] text-bone-faint">本地文件</span>
            </div>
          ) : (
            <a
              href={pack.url}
              target="_blank"
              rel="noreferrer"
              className="mono mt-2 flex items-center gap-1 text-[11.5px] text-bone-faint transition-colors hover:text-amber-bright"
              title={pack.url}
            >
              <ExternalLink size={11} className="shrink-0" />
              <span className="truncate">{pack.url}</span>
            </a>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* 本地包没有外链可抓，换文件走「编辑」里的重新导入，这里不显示抓取按钮 */}
          {!isLocal ? (
            <Button size="small" icon={<RefreshCw size={13} />} loading={fetching} onClick={refetch}>
              {pack.fetch_status === 'never' ? '抓取' : '重新抓取'}
            </Button>
          ) : null}
          <Tooltip title={isLocal ? '编辑 / 重新导入' : '编辑'}>
            <Button size="small" type="text" icon={<Pencil size={14} />} onClick={onEdit} />
          </Tooltip>
          <Popconfirm
            title={`删除「${pack.name}」？`}
            description="只删这个包的配置与缓存，已经发出去的历史消息不受影响。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={remove}
          >
            <Tooltip title="删除">
              <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
            </Tooltip>
          </Popconfirm>
        </div>
      </div>

      <div className="px-5 pb-4">
        {/* 抓取结论三态：成功一句绿字带字节数与时间；未抓取给下一步；失败用统一的可操作横幅 */}
        {pack.fetch_status === 'ok' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="text-jade">{pack.fetch_message ?? '抓取成功'}</span>
            <span className="mono text-[10.5px] text-bone-faint">
              {formatBytes(pack.content_bytes)} · {formatTime(pack.fetched_at)}
            </span>
          </div>
        ) : pack.fetch_status === 'never' ? (
          <div className="text-[12px] text-bone-faint">还没抓过，点「抓取」把这个外链的文本拉下来缓存到本机。</div>
        ) : (
          <FailureNote status={pack.fetch_status} message={pack.fetch_message ?? meta.label} />
        )}

        {/* 缓存文本折叠区：只有抓成功才有内容可看 */}
        {hasContent ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3.5 flex w-full items-center gap-2 border-t border-line-soft pt-3 text-[12.5px] text-bone-dim transition-colors hover:text-amber-bright"
            >
              <ChevronDown size={14} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
              查看缓存文本
              <span className="ml-auto text-[11px] text-bone-faint">@ 引用的就是这段</span>
            </button>
            {expanded ? (
              <pre className="code-block mt-3 max-h-64 rounded-md border border-line-soft bg-ink-950 p-3 whitespace-pre-wrap">
                {pack.content}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}