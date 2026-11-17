'use client';

import { Button, Tag } from 'antd';
import { Braces, Undo2 } from 'lucide-react';
import { Input } from 'antd';

// 原始请求面板：默认只读，展示表单即将发出的 JSON。
// 点「修改原始请求」后可编辑，同时父组件把表单置灰；点「放弃修改」丢弃手改回到表单。
export default function RawRequestPanel({
  formJson,
  override,
  onOverride,
}: {
  formJson: string;
  override: string | null;
  onOverride: (v: string | null) => void;
}) {
  const editing = override !== null;

  let invalid = false;
  if (editing) {
    try {
      JSON.parse(override);
    } catch {
      invalid = true;
    }
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <Braces size={14} className="text-bone-faint" />
        <span className="eyebrow">Raw Request · 原始请求</span>
        <Tag variant="filled" style={editing ? { color: '#e0a458', background: 'rgba(224,164,88,0.12)' } : undefined}>
          {editing ? '手工修改中' : '由表单生成'}
        </Tag>
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <Button size="small" icon={<Undo2 size={13} />} onClick={() => onOverride(null)}>
              放弃修改，回到表单
            </Button>
          ) : (
            <Button size="small" icon={<Braces size={13} />} onClick={() => onOverride(formJson)}>
              修改原始请求
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="p-3">
          <Input.TextArea
            className="code-input"
            value={override}
            onChange={(e) => onOverride(e.target.value)}
            autoSize={{ minRows: 8, maxRows: 22 }}
            spellCheck={false}
          />
          <div className="mt-2 text-[11.5px]" style={{ color: invalid ? '#e2705f' : '#6f665a' }}>
            {invalid
              ? '这段 JSON 现在还解不开，修好之前发送按钮是灰的'
              : '改完直接发送；上面的表单选项此刻不参与请求'}
          </div>
        </div>
      ) : (
        <pre className="code-block max-h-72 px-4 py-3">{formJson}</pre>
      )}
    </div>
  );
}