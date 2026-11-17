'use client';

import { App, Button, Dropdown, Image, Modal, Popconfirm, Tooltip } from 'antd';
import { Download, FolderOpen, ImageUp, Info, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '~/lib/client/api';
import { aspectOf } from '~/lib/images/options';
import type { PublicWork } from '~/lib/works/public';

// 作品卡片：生图页的本次结果与作品库共用。
// 缩略图点开是 antd 的大图预览，右上角「详情」看提示词与当时用的参数。

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(n: number | null): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

// 详情里把几个参数显示成人话：方式翻中文、尺寸带上画幅、压缩率带百分号。
function paramText(key: string, value: unknown): string {
  if (key === 'mode') return value === 'edit' ? '改图' : '文生图';
  if (key === 'size') {
    const aspect = aspectOf(String(value));
    return aspect ? `${value} · ${aspect}` : String(value);
  }
  if (key === 'output_compression') return `${value}%`;
  return String(value);
}

const PARAM_LABELS: Record<string, string> = {
  mode: '方式',
  n: '张数',
  size: '尺寸',
  quality: '质量',
  background: '背景',
  style: '风格',
  complexity: '规划算力',
  output_format: '格式',
  output_compression: '压缩率',
};

export default function WorkCard({
  work,
  onDelete,
  onEdit,
  onUpscale,
}: {
  work: PublicWork;
  onDelete?: () => void;
  onEdit?: () => void;
  onUpscale?: () => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState(false);
  const params = Object.entries(work.params).filter(([, v]) => v != null && v !== '');

  // 右键菜单：让后端调系统文件管理器选中这张图，前端只转述成败
  async function reveal() {
    try {
      await api.post(`/api/works/${work.id}/reveal`, {});
      message.success('已在资源管理器中定位');
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <>
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [{ key: 'reveal', icon: <FolderOpen size={13} />, label: '在资源管理器打开' }],
          onClick: ({ key }) => {
            if (key === 'reveal') void reveal();
          },
        }}
      >
        <figure className="group relative overflow-hidden rounded-lg border border-line-soft bg-ink-950">
          <Image
            src={work.file_url}
            alt={work.prompt || work.model_id}
            className="aspect-square w-full object-cover"
            classNames={{ root: 'block w-full' }}
          />

          {/* 动作条悬停才浮出来，平时不挡画面；z-10 保证点击落在按钮上而不是触发大图预览 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            {onEdit ? (
              <Tooltip title="拿这张当原图去改图">
                <Button size="small" icon={<Pencil size={13} />} onClick={onEdit} />
              </Tooltip>
            ) : null}
            {onUpscale ? (
              <Tooltip title="把这张图放大到更高分辨率">
                <Button size="small" icon={<ImageUp size={13} />} onClick={onUpscale} />
              </Tooltip>
            ) : null}
            <Tooltip title="看提示词与参数">
              <Button size="small" icon={<Info size={13} />} onClick={() => setDetail(true)} />
            </Tooltip>
            <Tooltip title="下载到本机">
              <Button size="small" icon={<Download size={13} />} href={`${work.file_url}?download=1`} />
            </Tooltip>
            {onDelete ? (
              <span onClick={(e) => e.stopPropagation()}>
                <Popconfirm
                  title="删除这件作品？"
                  description="本机的图片文件会一起删掉，无法恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={onDelete}
                >
                  <Button size="small" danger icon={<Trash2 size={13} />} />
                </Popconfirm>
              </span>
            ) : null}
          </div>

          <figcaption className="border-t border-line-soft px-2.5 py-2">
            <div className="mono truncate text-[10.5px] text-bone-dim" title={work.model_id}>
              {work.model_id}
            </div>
            <div className="mono mt-0.5 flex items-center gap-1.5 text-[10px] text-bone-faint">
              <span>{formatTime(work.created_at)}</span>
              <span>·</span>
              <span>{formatBytes(work.bytes)}</span>
              {work.params.mode === 'edit' ? (
                <>
                  <span>·</span>
                  <span className="text-amber">改图</span>
                </>
              ) : null}
            </div>
          </figcaption>
        </figure>
      </Dropdown>

      <Modal
        title="作品详情"
        open={detail}
        onCancel={() => setDetail(false)}
        width={880}
        mask={{ closable: true, blur: true }}
        footer={
          <div className="flex items-center gap-2">
            <span className="mono mr-auto text-[11px] text-bone-faint">{work.id}</span>
            <Button icon={<Download size={14} />} href={`${work.file_url}?download=1`}>
              下载
            </Button>
            <Button onClick={() => setDetail(false)}>关闭</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:w-[58%]">
            {/* 详情里用原生 img：不再套一层预览，避免和外层 PreviewGroup 抢焦点 */}
            <img
              src={work.file_url}
              alt={work.prompt || work.model_id}
              className="max-h-[62vh] w-full rounded-lg border border-line-soft object-contain"
              style={{ background: '#0d0b0a' }}
            />
            {work.source_url ? (
              <div className="mt-3">
                <div className="eyebrow mb-1.5">改图用的原图</div>
                <img
                  src={work.source_url}
                  alt="原图"
                  className="max-h-40 rounded-md border border-line-soft object-contain"
                  style={{ background: '#0d0b0a' }}
                />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1.5">Prompt · 提示词</div>
            <p className="max-h-52 overflow-y-auto rounded-md border border-line-soft bg-ink-950 px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-bone-dim">
              {work.prompt || '（没记到提示词）'}
            </p>

            <div className="eyebrow mt-4 mb-1.5">Parameters · 当时的参数</div>
            <div className="rounded-md border border-line-soft">
              {params.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-bone-faint">这次没记到参数</div>
              ) : (
                params.map(([k, v], i) => (
                  <div
                    key={k}
                    className="flex items-center gap-3 px-3 py-1.5 text-[12px]"
                    style={i ? { borderTop: '1px solid #241f1a' } : undefined}
                  >
                    <span className="w-14 shrink-0 text-bone-faint">{PARAM_LABELS[k] ?? k}</span>
                    <span className="mono min-w-0 flex-1 truncate text-bone-dim">
                      {paramText(k, v)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="eyebrow mt-4 mb-1.5">Source · 来源</div>
            <div className="mono flex flex-col gap-1 text-[11.5px] text-bone-dim">
              <span className="truncate" title={work.model_id}>{work.model_id}</span>
              <span className="truncate text-bone-faint">{work.provider_name ?? '供应商已删除'}</span>
              <span className="text-bone-faint">{formatTime(work.created_at)}</span>
              <span className="text-bone-faint">
                {work.mime_type} · {formatBytes(work.bytes)}
              </span>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}