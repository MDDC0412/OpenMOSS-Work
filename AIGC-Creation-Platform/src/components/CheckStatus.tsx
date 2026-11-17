import type { FailureKind } from '~/lib/errors';

export type CheckStatus = FailureKind | 'ok';

// 体检结论的颜色与短标签集中在这里，卡片上的状态灯和详情里的横幅共用一套，
// 不会出现"灯是绿的、字说失败"这种对不上的情况。
export const STATUS_META: Record<CheckStatus, { label: string; color: string }> = {
  ok: { label: '连通正常', color: '#79c3a0' },
  network: { label: '网络不通', color: '#e2705f' },
  auth: { label: '密钥被拒', color: '#e2705f' },
  url: { label: '地址不对', color: '#e0a458' },
  timeout: { label: '超时', color: '#e0a458' },
  ratelimit: { label: '被限流', color: '#e0a458' },
  upstream: { label: '供应商出错', color: '#e2705f' },
  badresponse: { label: '响应看不懂', color: '#e0a458' },
  error: { label: '失败', color: '#e2705f' },
};

export function statusMeta(status: CheckStatus | null | undefined) {
  if (!status) return { label: '还没体检', color: '#6f665a' };
  return STATUS_META[status] ?? STATUS_META.error;
}

// 状态灯：一个小圆点 + 同色光晕。pending 时呼吸闪烁，其余常亮。
export function StatusDot({
  status,
  pending = false,
  size = 8,
}: {
  status: CheckStatus | null | undefined;
  pending?: boolean;
  size?: number;
}) {
  const meta = statusMeta(status);
  return (
    <span
      className={pending ? 'lamp-live inline-block shrink-0 rounded-full' : 'inline-block shrink-0 rounded-full'}
      style={{
        width: size,
        height: size,
        background: meta.color,
        color: meta.color,
        boxShadow: `0 0 0 3px ${meta.color}22`,
      }}
      title={meta.label}
    />
  );
}