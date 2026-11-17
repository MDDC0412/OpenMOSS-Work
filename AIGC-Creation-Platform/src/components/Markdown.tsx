'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 模型回答按 markdown 渲染（含表格/删除线）。样式集中在 globals.css 的 .md 下，
// 这里只负责解析，不掺视觉逻辑。
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}