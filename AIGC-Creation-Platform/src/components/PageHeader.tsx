import type { ReactNode } from 'react';

// 页头统一版式：等宽小字眉标 + Bahnschrift 标题 + 一句说明 + 右侧动作区。
// 每一页都用它，避免各页标题字号/间距各写一套。
export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="rise mb-7 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display mt-1.5 text-[27px] leading-tight text-bone">{title}</h1>
        {description ? <p className="mt-2 max-w-[68ch] text-[13px] text-bone-dim">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 md:pt-5">{actions}</div> : null}
    </header>
  );
}