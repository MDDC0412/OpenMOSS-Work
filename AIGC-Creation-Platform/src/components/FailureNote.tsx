'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { statusMeta, type CheckStatus } from './CheckStatus';

// 失败提示统一版式：一句人话 + 可展开的供应商原文。
// 原文默认收起，因为里面常含英文错误码和请求 id，日常不需要看。
export default function FailureNote({
  status,
  message,
  detail,
  httpStatus,
}: {
  status: CheckStatus;
  message: string;
  detail?: string | null;
  httpStatus?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const meta = statusMeta(status);

  return (
    <div
      className="rounded-lg border px-3.5 py-3"
      style={{ borderColor: `${meta.color}3a`, background: `${meta.color}0f` }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {httpStatus ? <span className="mono text-[10.5px] text-bone-faint">HTTP {httpStatus}</span> : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-bone-dim">{message}</p>

          {detail ? (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-2 flex items-center gap-1 text-[11.5px] text-bone-faint transition-colors hover:text-bone-dim"
              >
                <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
                {open ? '收起原文' : '看供应商原文'}
              </button>
              {open ? (
                <pre className="code-block mt-2 max-h-52 rounded-md border border-line-soft bg-ink-950 p-3 whitespace-pre-wrap">
                  {detail}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}