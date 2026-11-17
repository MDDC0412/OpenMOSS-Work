'use client';

import { App, Button, Select, Tag, Upload } from 'antd';
import { ArrowRight, Images, ImageUp, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ModelPicker, { type ModelChoice } from '~/components/ModelPicker';
import PageHeader from '~/components/PageHeader';
import { useImageJob } from '~/components/image/ImageJobProvider';
import WorkPicker from '~/components/works/WorkPicker';
import { api, ApiError } from '~/lib/client/api';
import { IMAGE_RESOLUTIONS, RESOLUTION_LONG_EDGE, type ImageResolution } from '~/lib/images/options';
import type { PublicWork } from '~/lib/works/public';

interface SourceImage {
  fileName: string;
  mime: string;
  bytes: number;
  url: string;
  label: string;
  workId?: string;
}

function sourceFromWork(w: PublicWork): SourceImage {
  return {
    fileName: w.file_name,
    mime: w.mime_type,
    bytes: w.bytes ?? 0,
    url: w.file_url,
    label: `作品库 · ${w.model_id}`,
    workId: w.id,
  };
}

export default function UpscaleView() {
  const { message: toast } = App.useApp();
  const job = useImageJob();
  const [source, setSource] = useState<SourceImage | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [resolution, setResolution] = useState<ImageResolution>('4K');
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const handled = useRef(false);
  const running = job.generating;
  // 队列里最近一个完成的超分任务，用来展示结果
  const lastDone = [...job.tasks]
    .reverse()
    .find((t) => t.kind === 'upscale' && t.status === 'done' && t.works.length > 0);

  // 从作品库点「超分」跳过来时带 ?work=<id>
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const id = new URLSearchParams(window.location.search).get('work');
    if (!id) return;
    void api
      .get<{ work: PublicWork }>(`/api/works/${id}`)
      .then(({ work }) => setSource(sourceFromWork(work)))
      .catch(() => toast.warning('带过来的作品没找到，可能已被删除'));
  }, [toast]);

  async function uploadSource(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { file: saved } = await api.post<{
        file: { fileName: string; mime: string; bytes: number; url: string };
      }>('/api/uploads', form);
      setSource({ ...saved, label: file.name });
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function run() {
    if (!source) {
      toast.warning('先选一张图');
      return;
    }
    if (!choice) {
      toast.warning('先选一个本地 MOSS 模型（超分要用它的服务地址）');
      return;
    }
    // 不再同步等待：丢进队列，等调度器按顺序处理
    job.enqueueUpscale(
      {
        providerId: choice.providerId,
        sourceWorkId: source.workId ?? null,
        sourceFileName: source.workId ? null : source.fileName,
        targetEdge: RESOLUTION_LONG_EDGE[resolution],
      },
      `超分 ${source.label} → ${RESOLUTION_LONG_EDGE[resolution]}px`,
    );
    toast.success('已加入队列，可在右上角「队列」里看进度');
  }

  return (
    <>
      <PageHeader
        eyebrow="Upscale · 超分"
        title="超分"
        description="把已有图片放大到更高分辨率。4 倍放大后按所选档位缩放，最高 4K。注意：超分只补细节，不会修正图里写错的字。"
        actions={
          <Link href="/works">
            <Button icon={<ArrowRight size={15} />}>作品库</Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel rise p-4">
          <div className="eyebrow pb-2">原图</div>
          {source ? (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.url} alt={source.label} className="size-24 rounded-md border border-line-soft object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-bone">{source.label}</div>
                <div className="mono mt-0.5 text-[10.5px] text-bone-faint">
                  {source.mime} · {Math.round(source.bytes / 1024)} KB
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button size="small" icon={<Images size={13} />} onClick={() => setPickerOpen(true)}>
                    换一张
                  </Button>
                  <Button size="small" onClick={() => setSource(null)}>
                    清除
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Upload.Dragger
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                multiple={false}
                disabled={uploading}
                beforeUpload={(file) => {
                  void uploadSource(file);
                  return false;
                }}
                className="!border-line-soft !bg-ink-950"
              >
                <p className="py-6 text-[12.5px] text-bone-dim">{uploading ? '正在存到本机…' : '把图拖进来，或点击选择'}</p>
              </Upload.Dragger>
              <Button size="small" icon={<Images size={13} />} onClick={() => setPickerOpen(true)}>
                或从作品库选一张
              </Button>
            </div>
          )}
        </section>

        <section className="panel rise p-4" style={{ animationDelay: '40ms' }}>
          <div className="eyebrow pb-2">目标</div>
          <div className="mb-3">
            <div className="mb-1.5 text-[12.5px] text-bone-dim">本地 MOSS 服务（用它的地址调超分）</div>
            <ModelPicker kind="image" prefKey="last:image" value={choice} onChange={setChoice} />
          </div>
          <div className="mb-3">
            <div className="mb-1.5 text-[12.5px] text-bone-dim">目标分辨率（长边）</div>
            <Select
              className="!w-full"
              value={resolution}
              onChange={setResolution}
              options={IMAGE_RESOLUTIONS.map((t) => ({ value: t, label: `${t} · 长边 ${RESOLUTION_LONG_EDGE[t]}px` }))}
            />
          </div>
          <Button type="primary" block disabled={!source || !choice} onClick={() => void run()} icon={<Sparkles size={15} />}>
            加入队列
          </Button>
          <p className="mono mt-2 text-[10.5px] leading-relaxed text-bone-faint">
            4 倍放大后缩放到目标尺寸。768×576 放大到 4K 约 10-20 秒。提交后在右上角「任务队列」里看进度。
          </p>
        </section>
      </div>

      {lastDone ? (
        <section className="panel rise mt-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Tag color="success">最近完成</Tag>
            <span className="mono text-[11px] text-bone-faint">
              {(lastDone.works[0].bytes ?? 0) / 1024 > 1024
                ? `${((lastDone.works[0].bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`
                : `${Math.round((lastDone.works[0].bytes ?? 0) / 1024)} KB`}
            </span>
            <a className="mono ml-auto text-[11px] text-amber" href={`${lastDone.works[0].file_url}?download=1`}>
              下载
            </a>
          </div>
          <img src={lastDone.works[0].file_url} alt="超分结果" className="w-full rounded-md border border-line-soft" />
        </section>
      ) : null}

      <WorkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(w) => {
          setSource(sourceFromWork(w));
          setPickerOpen(false);
        }}
      />
    </>
  );
}
