'use client';

import { Button, Input, Popover, Tag, Tooltip, type GetRef } from 'antd';
import { AtSign, WandSparkles, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { PackRow } from '~/lib/packs/repo';

// 提示词输入框：所有模态共用。
// 输入 @ 弹出提示词包选择；选中的包以 chips 展示，发送时由后端把包文本追加进 prompt。
// 润色按钮交给父组件实现（要挑模型），这里只负责触发与转圈。
export default function PromptBox({
  value,
  onChange,
  packs,
  packIds,
  onPackIdsChange,
  onPolish,
  polishing = false,
  placeholder = '写点什么… 输入 @ 引用提示词包',
  rows = 4,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  packs: PackRow[];
  packIds: string[];
  onPackIdsChange: (ids: string[]) => void;
  onPolish?: () => void;
  polishing?: boolean;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null);
  const areaRef = useRef<GetRef<typeof Input.TextArea>>(null);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return packs.filter((p) => !packIds.includes(p.id) && (!q || p.name.toLowerCase().includes(q)));
  }, [mention, packs, packIds]);

  // 光标前的最后一个 @token 决定是否弹菜单；@ 后跟空格或换行就视为普通字符。
  // 光标位置从事件目标上读，antd 的 ref 拿不到原生 selectionStart。
  function handleChange(next: string, caret: number) {
    onChange(next);
    const prefix = next.slice(0, caret);
    const m = /@([^\s@]*)$/.exec(prefix);
    setMention(m ? { query: m[1], start: m.index, end: caret } : null);
  }

  function pickPack(id: string) {
    if (!mention) return;
    // 把 "@query" 这段从文本里删掉，包改以 chip 形式存在，避免 prompt 里留个半截 @
    const next = value.slice(0, mention.start) + value.slice(mention.end);
    onChange(next);
    onPackIdsChange([...packIds, id]);
    setMention(null);
    areaRef.current?.focus();
  }

  const selected = packs.filter((p) => packIds.includes(p.id));

  const menu = (
    <div className="max-h-64 w-72 overflow-y-auto py-1">
      {candidates.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-bone-faint">
          {packs.length === 0 ? '还没有提示词包，去「提示词包」页加一个外链' : '没有匹配的包，或都已经选上了'}
        </div>
      ) : (
        candidates.map((p) => (
          <button
            key={p.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pickPack(p.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-amber/10"
          >
            <AtSign size={13} className="shrink-0 text-amber" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-bone">{p.name}</span>
            <span className="mono shrink-0 text-[10px] text-bone-faint">
              {p.fetch_status === 'ok' ? `${p.content_bytes ?? 0}B` : '未抓取'}
            </span>
          </button>
        ))
      )}
    </div>
  );

  return (
    <div className={disabled ? 'form-locked' : undefined}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11.5px] text-bone-faint">输入 @ 引用提示词包，发送时包内文本会追加进 prompt</span>
        {onPolish ? (
          <Tooltip title="用对话模型把这段草稿改写得更好">
            <Button
              size="small"
              type="text"
              className="ml-auto"
              icon={<WandSparkles size={13} />}
              loading={polishing}
              disabled={disabled || !value.trim()}
              onClick={onPolish}
            >
              润色
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <Popover
        open={mention !== null && !disabled}
        content={menu}
        trigger={[]}
        placement="topLeft"
        arrow={false}
        styles={{ content: { padding: 0, background: '#221d19', border: '1px solid #2e2822' } }}
      >
        <Input.TextArea
          ref={areaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            if (mention && e.key === 'Escape') setMention(null);
            if (mention && e.key === 'Enter' && candidates.length > 0) {
              e.preventDefault();
              pickPack(candidates[0].id);
            }
          }}
          placeholder={placeholder}
          autoSize={{ minRows: rows, maxRows: 14 }}
          disabled={disabled}
        />
      </Popover>

      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <Tag
              key={p.id}
              variant="filled"
              style={{ color: '#f2be79', background: 'rgba(224,164,88,0.12)' }}
              closeIcon={<X size={11} />}
              onClose={() => onPackIdsChange(packIds.filter((id) => id !== p.id))}
            >
              @{p.name}
            </Tag>
          ))}
        </div>
      ) : null}
    </div>
  );
}