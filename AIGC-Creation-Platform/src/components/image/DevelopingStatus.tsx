'use client';

import { useEffect, useState } from 'react';

// 显影状态条：生成中挂在结果区顶部，实时走秒，让等待有可读的进度感。
// 组件只在 generating 期间挂载，计时自然从本次生成开始、结束即销毁。
export default function DevelopingStatus({ pending }: { pending: number }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-line-soft bg-ink-950 px-3 py-2">
      <span className="lamp-live inline-block size-1.5 shrink-0 rounded-full bg-amber text-amber" />
      <span className="text-[12px] text-bone-dim">
        {pending > 0 ? `显影中 · ${pending} 张待出，慢的模型一张要几分钟` : '显影中 · 收尾落盘'}
      </span>
      <span className="mono ml-auto text-[11px] text-amber">{clock}</span>
    </div>
  );
}