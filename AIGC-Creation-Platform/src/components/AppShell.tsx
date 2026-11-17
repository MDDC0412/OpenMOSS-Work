'use client';

import { FolderCog, Image as ImageIcon, ImageUp, Images, ListOrdered, MessageSquare, Server, Sparkles, Video } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import DataDirModal from '~/components/DataDirModal';
import QueueDrawer from '~/components/image/QueueDrawer';
import { useImageJob } from '~/components/image/ImageJobProvider';
import { api } from '~/lib/client/api';

// 导航分三段：日常创作、跨模态共用的提示词包、以及尚未开放的视频。
// 视频只留入口不做任何逻辑，点不动但看得见，符合"预留位置"的要求。
const MAIN = [
  { href: '/providers', label: '供应商', icon: Server, hint: '地址 · 密钥 · 体检' },
  { href: '/chat', label: '对话', icon: MessageSquare, hint: '流式 · 会话历史' },
  { href: '/image', label: '生图', icon: ImageIcon, hint: '文生图 · 改图' },
  { href: '/upscale', label: '超分', icon: ImageUp, hint: '放大 · 最高 4K' },
  { href: '/works', label: '作品库', icon: Images, hint: '本机存档' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const job = useImageJob();
  // 数据目录可被用户迁移，改成客户端现拉：迁移弹窗改完后广播事件，这里跟着刷新
  const [dataRoot, setDataRoot] = useState('');
  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const pendingCount = job.tasks.filter((t) => t.status === 'pending').length;
  const runningCount = job.tasks.filter((t) => t.status === 'running').length;

  useEffect(() => {
    const refresh = () => {
      api
        .get<{ dir: string }>('/api/settings/data-dir')
        .then(({ dir }) => setDataRoot(dir))
        .catch(() => {});
    };
    refresh();
    window.addEventListener('aigc-data-dir-changed', refresh);
    return () => window.removeEventListener('aigc-data-dir-changed', refresh);
  }, []);

  return (
    <div className="relative z-1 flex min-h-screen">
      {/* ── 左侧固定导轨 ── */}
      <aside
        className="fixed inset-y-0 left-0 z-20 flex flex-col border-r border-line bg-ink-950/80 backdrop-blur-sm"
        style={{ width: 'var(--rail-w)' }}
      >
        {/* 厂牌位：用等宽小字 + 琥珀方块，像仪器铭牌而不是网站 Logo */}
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <div className="grid size-9 place-items-center rounded-md border border-amber/35 bg-amber/10">
            <Sparkles size={17} className="text-amber" strokeWidth={1.6} />
          </div>
          <div className="leading-tight">
            <div className="display text-[16px] text-bone">创作台</div>
            <div className="eyebrow mt-0.5">AIGC · LOCAL</div>
          </div>
        </div>

        <div className="mx-5 h-px bg-line-soft" />

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="eyebrow px-3 pb-2">工作台</div>
          <div className="flex flex-col gap-0.5">
            {MAIN.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="nav-item" data-active={active}>
                  <Icon size={16} strokeWidth={1.7} className="shrink-0" />
                  <span className="flex-1 text-[13.5px]">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="eyebrow px-3 pt-6 pb-2">共用</div>
          <Link href="/packs" className="nav-item" data-active={pathname.startsWith('/packs')}>
            <Sparkles size={16} strokeWidth={1.7} className="shrink-0" />
            <span className="flex-1 text-[13.5px]">提示词包</span>
            <span className="mono text-[10px] text-bone-faint">@</span>
          </Link>

          <div className="eyebrow px-3 pt-6 pb-2">未开放</div>
          {/* 视频用 aria-disabled 而不是 disabled 属性：链接仍可聚焦，读屏能念出"第二期" */}
          <span className="nav-item" data-disabled="true" aria-disabled="true">
            <Video size={16} strokeWidth={1.7} className="shrink-0" />
            <span className="flex-1 text-[13.5px]">视频</span>
            <span className="mono rounded border border-line px-1.5 py-px text-[9.5px] text-bone-faint">第二期</span>
          </span>
        </nav>

        {/* 队列入口：显示排队/处理中的数量，点开是任务抽屉 */}
        <button
          type="button"
          className="group flex items-center gap-2 border-t border-line-soft px-5 py-3 text-left transition-colors hover:bg-ink-900/60"
          onClick={() => setQueueOpen(true)}
          title="查看任务队列"
        >
          <ListOrdered size={15} strokeWidth={1.7} className="shrink-0 text-bone-faint transition-colors group-hover:text-amber" />
          <span className="flex-1 text-[13px] text-bone-dim">任务队列</span>
          {runningCount > 0 ? (
            <span className="mono rounded border border-amber/40 bg-amber/10 px-1.5 py-px text-[9.5px] text-amber">
              运行中
            </span>
          ) : null}
          {pendingCount > 0 ? (
            <span className="mono rounded border border-line px-1.5 py-px text-[9.5px] text-bone-faint">
              {pendingCount}
            </span>
          ) : null}
        </button>

        {/* 数据落盘位置常驻显示：密钥和作品都在项目外，用户随时能核对；点开可迁移目录 */}
        <button
          type="button"
          className="group border-t border-line-soft px-5 py-4 text-left transition-colors hover:bg-ink-900/60"
          onClick={() => setDirModalOpen(true)}
          title="点击修改数据存放目录"
        >
          <div className="eyebrow flex items-center gap-1.5 pb-1.5">
            本机数据
            <FolderCog size={11} className="text-bone-faint transition-colors group-hover:text-amber" />
          </div>
          <div className="mono text-[10.5px] leading-relaxed break-all text-bone-faint" title={dataRoot}>
            {dataRoot || '读取中…'}
          </div>
        </button>
      </aside>

      {/* ── 主区：左侧留出导轨宽度，内容限宽以免在宽屏上拉成一条条长河 ── */}
      <main className="min-w-0 flex-1" style={{ marginLeft: 'var(--rail-w)' }}>
        <div className="mx-auto max-w-[1180px] px-8 py-8">{children}</div>
      </main>

      <DataDirModal open={dirModalOpen} onClose={() => setDirModalOpen(false)} />
      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  );
}