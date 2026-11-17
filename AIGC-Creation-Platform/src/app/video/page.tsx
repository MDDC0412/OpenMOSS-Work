import { Video } from 'lucide-react';
import PageHeader from '~/components/PageHeader';

// 视频这一期只留位置，不做任何逻辑：没有表单、没有请求。
// 纯静态服务端组件，点进来就是一句清楚的"第二期"，不摆假装能用的控件。
export default function VideoPage() {
  return (
    <>
      <PageHeader
        eyebrow="Video · 第二期"
        title="视频"
        description="视频生成排在第二期。这一期先把供应商接入、对话和生图打磨好，视频只留入口。"
      />

      <div className="panel rise overflow-hidden">
        <div className="flex flex-col items-center px-8 py-14 text-center">
          <div className="grid size-14 place-items-center rounded-xl border border-line bg-ink-800">
            <Video size={24} className="text-bone-faint" strokeWidth={1.5} />
          </div>
          <span className="mono mt-5 rounded border border-line px-2 py-0.5 text-[10.5px] text-bone-faint">第二期开放</span>
          <h2 className="display mt-3 text-[20px] text-bone">这里还不能用</h2>
          <p className="mx-auto mt-2 max-w-[54ch] text-[13px] text-bone-dim">
            两家供应商都供应视频模型，格式已经摸清。第二期会把视频做成和生图一样的可视化表单，这一期先不动它。
          </p>
        </div>

        {/* 规划清单：静态文字而非可点控件，避免让人误以为现在就能用 */}
        <div className="grid grid-cols-1 gap-px border-t border-line-soft bg-line-soft sm:grid-cols-3">
          {[
            { t: '文生视频', d: '写提示词，选模型与时长，出片' },
            { t: '图生视频', d: '上传一张图作为首帧，让它动起来' },
            { t: '参数可视化', d: '和生图一样，表单 + 原始请求面板' },
          ].map((x) => (
            <div key={x.t} className="bg-ink-850 px-5 py-4">
              <div className="display text-[14px] text-bone-dim">{x.t}</div>
              <div className="mt-1 text-[12px] text-bone-faint">{x.d}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}