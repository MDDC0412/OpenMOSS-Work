'use client';

// 显影框：生成中每张待出图的占位动画。
// 扫描线 / 呼吸光 / 四角标记按序号错峰，多张同时生成时不整齐划一地闪，更像暗房里逐张显影。
export default function DevelopingFrame({ index }: { index: number }) {
  // 错峰上限 5 档：n 最大 10，再大的延迟会让后几张看起来"没开始"
  const delay = `${(index % 5) * 0.45}s`;
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border border-line-soft bg-ink-950">
      <div className="develop-glow absolute inset-0" style={{ animationDelay: delay }} />
      <div className="develop-grain absolute inset-0" />
      <div className="develop-scan absolute inset-x-0" style={{ animationDelay: delay }} />
      <span className="develop-corner left-1.5 top-1.5 border-l border-t" style={{ animationDelay: delay }} />
      <span className="develop-corner right-1.5 top-1.5 border-r border-t" style={{ animationDelay: delay }} />
      <span className="develop-corner bottom-1.5 left-1.5 border-b border-l" style={{ animationDelay: delay }} />
      <span className="develop-corner bottom-1.5 right-1.5 border-b border-r" style={{ animationDelay: delay }} />
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <span className="lamp-live inline-block size-1.5 rounded-full bg-amber text-amber" />
          <div className="mono mt-2 text-[10.5px] text-bone-faint">显影中 #{index + 1}</div>
        </div>
      </div>
    </div>
  );
}