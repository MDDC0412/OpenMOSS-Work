'use client';

import { App, Button, Checkbox, Drawer, InputNumber, Segmented, Select, Tag, Tooltip, Upload } from 'antd';
import { ArrowRight, ImagePlus, Images, PanelRightOpen, Sparkles, Square, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FailureNote from '~/components/FailureNote';
import DevelopingFrame from '~/components/image/DevelopingFrame';
import DevelopingStatus from '~/components/image/DevelopingStatus';
import { useImageJob } from '~/components/image/ImageJobProvider';
import ModelPicker, { type ModelChoice } from '~/components/ModelPicker';
import PageHeader from '~/components/PageHeader';
import PromptBox from '~/components/PromptBox';
import RawRequestPanel from '~/components/RawRequestPanel';
import WorkCard from '~/components/works/WorkCard';
import WorkPicker from '~/components/works/WorkPicker';
import { api, ApiError } from '~/lib/client/api';
import type { FailureKind } from '~/lib/errors';
import {
  ASPECT_RATIOS,
  aspectOf,
  IMAGE_BACKGROUNDS,
  IMAGE_COMPLEXITIES,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  IMAGE_STYLES,
  RESOLUTION_LONG_EDGE,
  sizeFromAspectResolution,
  type ImageBackground,
  type ImageComplexity,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageResolution,
  type ImageStyle,
} from '~/lib/images/options';
import type { PackRow } from '~/lib/packs/repo';
import type { PublicWork } from '~/lib/works/public';

type Mode = 'generate' | 'edit';

interface Failure {
  kind: FailureKind;
  message: string;
  detail?: string;
}

interface SourceImage {
  fileName: string;
  mime: string;
  bytes: number;
  url: string;
  // 展示名：上传用原文件名，作品库引用用「作品库 · 模型名」，随机落盘名不适合给人看
  label: string;
  // 有值表示原图来自作品库，请求走 sourceWorkId 而不是 sourceFileName
  workId?: string;
}

type UploadedSource = Omit<SourceImage, 'label' | 'workId'>;

// 作品当原图的统一构造：选图弹窗、作品卡「拿去改图」、?edit= 跳转三处共用
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

const QUALITY_LABELS: Record<ImageQuality, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  standard: '标准（dall-e）',
  hd: '高清（dall-e-3）',
};
const BACKGROUND_LABELS: Record<ImageBackground, string> = {
  auto: '自动',
  transparent: '透明',
  opaque: '不透明',
};
const STYLE_LABELS: Record<ImageStyle, string> = { vivid: '鲜明', natural: '自然' };
const COMPLEXITY_LABELS: Record<ImageComplexity, string> = { low: '低', medium: '中', high: '高' };
const FORMAT_LABELS: Record<ImageOutputFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF' };

export default function ImageView() {
  const { message: toast } = App.useApp();
  const [mode, setMode] = useState<Mode>('generate');
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [polishChoice, setPolishChoice] = useState<ModelChoice | null>(null);
  const [prompt, setPrompt] = useState('');
  const [packIds, setPackIds] = useState<string[]>([]);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [n, setN] = useState(1);
  // 画幅（形状）与分辨率（清晰度档位）是两个独立概念，合起来换算成真正发出去的像素 size
  const [aspect, setAspect] = useState('1:1');
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  // 后超分：默认开启，否则选了 2K/4K 也只是被模型压回 960
  const [postUpscale, setPostUpscale] = useState(true);
  const [quality, setQuality] = useState<ImageQuality | undefined>(undefined);
  const [background, setBackground] = useState<ImageBackground | undefined>(undefined);
  const [style, setStyle] = useState<ImageStyle | undefined>(undefined);
  const [complexity, setComplexity] = useState<ImageComplexity | undefined>(undefined);
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat | undefined>(undefined);
  const [compression, setCompression] = useState<number | undefined>(undefined);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 生图任务的状态与执行逻辑由 ImageJobProvider 托管（挂在 AppProviders 上）。
  // 这样切到别的页面时任务不会中断，切回来还能看到进度和已出的图。
  const job = useImageJob();
  const { generating, partials, works, failure } = job;
  // 队列里还没开始的任务数：让用户知道已经堆了几个在等
  const queued = job.tasks.filter((t) => t.status === 'pending').length;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [override, setOverride] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);

  useEffect(() => {
    void api
      .get<{ packs: PackRow[] }>('/api/packs')
      .then(({ packs: rows }) => setPacks(rows))
      .catch(() => undefined);
  }, []);

  // 作品库「拿去改图」入口：/image?edit=<id> 把作品带成原图并切到改图模式。
  // ref 挡 StrictMode 的双挂载，避免重复拉取与重复提示。
  const editHandled = useRef(false);
  useEffect(() => {
    if (editHandled.current) return;
    editHandled.current = true;
    const id = new URLSearchParams(window.location.search).get('edit');
    if (!id) return;
    api
      .get<{ work: PublicWork }>(`/api/works/${id}`)
      .then(({ work }) => {
        setMode('edit');
        setSource(sourceFromWork(work));
      })
      .catch(() => toast.warning('这张作品已不在作品库，没法拿它当原图'));
  }, [toast]);

  const onChoice = useCallback((v: ModelChoice) => setChoice(v), []);
  const onPolishChoice = useCallback((v: ModelChoice) => setPolishChoice(v), []);

  // 请求只发一个像素 size：由画幅 × 分辨率档位换算（长边取档位值，短边按比例）。
  const effectiveSize = sizeFromAspectResolution(aspect, resolution);
  const effectiveAspect = aspectOf(effectiveSize);

  // 本地 MOSS 的模型上限只有 960 左右，选 2K/4K 不超分就没意义。
  // 服务端提供了 xxx 和 xxx-up 两套模型：带 -up 的会先小图生成再超分到目标尺寸。
  // 这里按勾选框自动切换后缀，不用改 OpenAI 协议。
  const isMossModel = choice?.modelId.startsWith('moss-') ?? false;
  const requestModelId = (() => {
    if (!choice) return '';
    if (!isMossModel) return choice.modelId;
    const base = choice.modelId.replace(/-up$/, '');
    return postUpscale ? `${base}-up` : base;
  })();
  // 预览框与横竖方标签都从有效宽高比推，保证框里画的就是最终会出的形状。
  const [ew, eh] = effectiveAspect ? effectiveAspect.split(':').map(Number) : [0, 0];
  const orientation = !effectiveAspect ? '自动' : ew > eh ? '横版（宽 > 高）' : eh > ew ? '竖版（高 > 宽）' : '方形（宽 = 高）';
  const previewBox = useMemo(() => {
    if (!ew || !eh) return null;
    const scale = 44 / Math.max(ew, eh);
    return { w: Math.max(6, Math.round(ew * scale)), h: Math.max(6, Math.round(eh * scale)) };
  }, [ew, eh]);

  // 表单推导出的请求体，和后端 runImage 组装的那份保持一致。
  // 选中的提示词包按缓存文本追加进 prompt；不选的参数一个字段都不出现。
  const formJson = useMemo(() => {
    const texts = packs.filter((p) => packIds.includes(p.id) && p.content != null).map((p) => p.content);
    const fullPrompt = texts.length ? `${prompt}\n\n${texts.join('\n\n')}` : prompt;
    return JSON.stringify(
      {
        model: choice?.modelId ?? '(未选模型)',
        prompt: fullPrompt,
        n,
        ...(effectiveSize ? { size: effectiveSize } : {}),
        ...(quality ? { quality } : {}),
        ...(background ? { background } : {}),
        ...(style ? { style } : {}),
        ...(complexity ? { complexity } : {}),
        ...(outputFormat ? { output_format: outputFormat } : {}),
        // 压缩率只在 webp/jpeg 下才发，别的格式带上会被供应商拒
        ...(compression !== undefined && (outputFormat === 'jpeg' || outputFormat === 'webp')
          ? { output_compression: compression }
          : {}),
      },
      null,
      2,
    );
  }, [choice, prompt, packIds, packs, n, effectiveSize, quality, background, style, complexity, outputFormat, compression]);

  const overrideBody = useMemo(() => {
    if (override === null) return null;
    try {
      return JSON.parse(override) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, [override]);

  async function uploadSource(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const saved = await api.upload<UploadedSource>('/api/uploads', form);
      setSource({ ...saved, label: file.name });
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function polish() {
    if (!polishChoice) {
      toast.warning('先挑一个对话模型用来润色');
      setDrawerOpen(true);
      return;
    }
    setPolishing(true);
    try {
      const { text } = await api.post<{ text: string }>('/api/polish', {
        providerId: polishChoice.providerId,
        modelId: polishChoice.modelId,
        target: 'image',
        text: prompt,
      });
      setPrompt(text);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    } finally {
      setPolishing(false);
    }
  }

  async function removeWork(id: string) {
    // 删除动作也走 Provider：作品列表在那边，删完要同步更新它
    await job.removeWork(id);
  }

  async function generate() {
    if (!choice) {
      toast.warning('先去供应商页体检拉出模型，再在这里选一个图像模型');
      return;
    }
    if (override === null && !prompt.trim()) {
      toast.warning('先写提示词');
      return;
    }
    if (mode === 'edit' && !source) {
      toast.warning('改图要先上传一张原图');
      return;
    }
    if (override !== null && overrideBody === undefined) return;

    // 任务交给 ImageJobProvider 执行：它挂在 AppProviders 上不随页面卸载，
    // 所以切到别的页面再回来，SSE 读取和进度都还在。
    await job.start({
      providerId: choice.providerId,
      modelId: requestModelId,
      mode,
      prompt,
      packIds,
      n,
      ...(effectiveSize ? { size: effectiveSize } : {}),
      ...(quality ? { quality } : {}),
      ...(background ? { background } : {}),
      ...(style ? { style } : {}),
      ...(complexity ? { complexity } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
      ...(compression !== undefined && (outputFormat === 'jpeg' || outputFormat === 'webp')
        ? { output_compression: compression }
        : {}),
      sourceFileName: mode === 'edit' && !source?.workId ? (source?.fileName ?? null) : null,
      sourceWorkId: mode === 'edit' ? (source?.workId ?? null) : null,
      rawOverride: overrideBody ?? null,
    });
  }

  const uploadButton = (
    <Upload
      accept="image/png,image/jpeg,image/webp,image/gif"
      showUploadList={false}
      multiple={false}
      disabled={uploading}
      beforeUpload={(file) => {
        void uploadSource(file);
        // 返回 false 接管上传：走自己的 /api/uploads，失败时能弹出后端翻译好的人话
        return false;
      }}
    >
      <Button size="small" loading={uploading}>
        {source ? '换一张' : '选择原图'}
      </Button>
    </Upload>
  );

  const partialEntries = Object.entries(partials).sort(([a], [b]) => Number(a) - Number(b));
  // 生成中还没回来的张数：扣掉已成品与半成品，剩下的格子放显影动画
  const pendingCount = generating ? Math.max(0, n - works.length - partialEntries.length) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Image · 生图"
        title="生图"
        description="文生图与改图，一次可出多张。结果自动落到本机作品库，随时回去看参数、重新下载。"
        actions={
          <>
            <Button icon={<PanelRightOpen size={15} />} onClick={() => setDrawerOpen(true)}>
              请求设置
            </Button>
            <Link href="/works">
              <Button icon={<ArrowRight size={15} />}>作品库</Button>
            </Link>
          </>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(360px,5fr)_7fr]">
        {/* ── 左列：请求表单 ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="panel rise p-4">
            <div className="eyebrow mb-3">Request · 请求</div>
            <Segmented
              block
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { label: '文生图', value: 'generate' },
                { label: '改图', value: 'edit' },
              ]}
            />
            <div className="mt-3">
              <ModelPicker kind="image" prefKey="last:image" value={choice} onChange={onChoice} />
            </div>

            {mode === 'edit' ? (
              <div className="mt-3.5">
                <div className="mb-1.5 text-[12.5px] text-bone-dim">原图</div>
                {source ? (
                  <div className="flex items-center gap-3 rounded-lg border border-line-soft bg-ink-950 p-2.5">
                    <img src={source.url} alt="原图" className="size-16 shrink-0 rounded-md object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="mono truncate text-[11px] text-bone-dim" title={source.label}>
                        {source.label}
                      </div>
                      <div className="mono mt-0.5 text-[10.5px] text-bone-faint">
                        {source.mime} · {Math.round(source.bytes / 1024)} KB
                      </div>
                    </div>
                    {uploadButton}
                    <Button size="small" icon={<Images size={13} />} onClick={() => setPickerOpen(true)}>
                      作品库
                    </Button>
                    <Tooltip title="不用这张了">
                      <Button size="small" type="text" danger icon={<X size={13} />} onClick={() => setSource(null)} />
                    </Tooltip>
                  </div>
                ) : (
                  <Upload.Dragger
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    showUploadList={false}
                    multiple={false}
                    disabled={uploading}
                    beforeUpload={(file) => {
                      void uploadSource(file);
                      return false;
                    }}
                  >
                    <div className="px-4 py-5">
                      <ImagePlus size={20} className="mx-auto text-bone-faint" />
                      <p className="mt-2 text-[12.5px] text-bone-dim">
                        {uploading ? '正在存到本机…' : '把原图拖进来，或点击选择'}
                      </p>
                        <p className="mono mt-1 text-[10.5px] text-bone-faint">png / jpeg / webp / gif · 20MB 以内</p>
                    </div>
                  </Upload.Dragger>
                )}
                {!source ? (
                  <div className="mt-2 text-center">
                    <Button size="small" icon={<Images size={13} />} disabled={uploading} onClick={() => setPickerOpen(true)}>
                      或从作品库选一张
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel rise p-4" style={{ animationDelay: '40ms' }}>
            <PromptBox
              value={prompt}
              onChange={setPrompt}
              packs={packs}
              packIds={packIds}
              onPackIdsChange={setPackIds}
              onPolish={() => void polish()}
              polishing={polishing}
              placeholder={mode === 'edit' ? '想怎么改这张图？输入 @ 引用提示词包' : '描述你想要的画面… 输入 @ 引用提示词包'}
              rows={6}
            />
          </section>

          {/* 原始请求接管时，只有这一组参数不参与请求，所以只置灰它 */}
          <section className={`panel rise p-4 ${override !== null ? 'form-locked' : ''}`} style={{ animationDelay: '80ms' }}>
            <div className="eyebrow mb-3">Parameters · 参数</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">张数（n）</div>
                <InputNumber className="!w-full" min={1} max={10} value={n} onChange={(v) => setN(v ?? 1)} />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">画幅（形状 / 宽高比）</div>
                <Select
                  className="!w-full"
                  value={aspect || undefined}
                  onChange={(r) => setAspect(r ?? '')}
                  options={ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
                  placeholder="选比例"
                  allowClear
                />
              </div>
              <div className="col-span-2">
                <div className="mb-1.5 text-[12.5px] text-bone-dim">分辨率（清晰度档位，决定长边像素）</div>
                <Select
                  className="!w-full"
                  value={resolution}
                  onChange={setResolution}
                  options={IMAGE_RESOLUTIONS.map((t) => ({ value: t, label: `${t} · 长边 ${RESOLUTION_LONG_EDGE[t]}` }))}
                />
                {/* 只有本地 MOSS 模型有这个限制：原生上限约 960，不超分就吃不到高分辨率档位 */}
                {isMossModel ? (
                  <div className="mt-2 flex items-start gap-2">
                    <Checkbox
                      checked={postUpscale}
                      onChange={(e) => setPostUpscale(e.target.checked)}
                    >
                      <span className="text-[12.5px]">后超分</span>
                    </Checkbox>
                    <span className="mono pt-0.5 text-[10.5px] leading-relaxed text-bone-faint">
                      {postUpscale
                        ? `先按 1/4 生成再超分到 ${RESOLUTION_LONG_EDGE[resolution]}px（约 +16 秒）`
                        : '不超分：模型上限约 960px，选高档位也不会真正生效'}
                    </span>
                  </div>
                ) : null}
              </div>
              {/* 比例预览框：按有效宽高比画一个矩形，横 / 竖 / 方一眼可辨 */}
              <div className="col-span-2">
                <div className="mb-1.5 text-[12.5px] text-bone-dim">输出预览（形状 + 实际像素）</div>
                <div className="flex items-center gap-3 rounded-lg border border-line-soft bg-ink-950 px-3 py-2.5">
                  <div className="grid size-16 shrink-0 place-items-center rounded-md border border-line-soft" style={{ background: '#0d0b0a' }}>
                    {previewBox ? (
                      <div
                        className="rounded-[3px] border border-amber"
                        style={{ width: previewBox.w, height: previewBox.h, background: 'rgba(224,164,88,0.16)' }}
                      />
                    ) : (
                      <div className="size-9 rounded-[3px] border border-dashed border-bone-faint" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-bone">{orientation}</div>
                    <div className="mono mt-0.5 truncate text-[11px] text-bone-faint">
                      {effectiveAspect ? `${effectiveAspect} · ${resolution} · ${effectiveSize}` : '自动 · 跟随模型默认'}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">质量（quality，渲染精细度）</div>
                <Select
                  className="!w-full"
                  value={quality}
                  onChange={setQuality}
                  options={IMAGE_QUALITIES.map((q) => ({ value: q, label: `${q} · ${QUALITY_LABELS[q]}` }))}
                  placeholder="不传"
                  allowClear
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">规划算力（complexity）</div>
                <Select
                  className="!w-full"
                  value={complexity}
                  onChange={setComplexity}
                  options={IMAGE_COMPLEXITIES.map((c) => ({ value: c, label: `${c} · ${COMPLEXITY_LABELS[c]}` }))}
                  placeholder="不传"
                  allowClear
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">格式（output_format）</div>
                <Select
                  className="!w-full"
                  value={outputFormat}
                  onChange={(f) => {
                    setOutputFormat(f);
                    // 压缩率只对 webp/jpeg 有意义，切到别的格式就清掉，免得发出去被拒
                    if (f !== 'jpeg' && f !== 'webp') setCompression(undefined);
                  }}
                  options={IMAGE_OUTPUT_FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
                  placeholder="不传（默认 png）"
                  allowClear
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">压缩率（%，仅 webp/jpeg）</div>
                <InputNumber
                  className="!w-full"
                  min={0}
                  max={100}
                  value={compression}
                  onChange={(v) => setCompression(v ?? undefined)}
                  placeholder="默认 100"
                  disabled={outputFormat !== 'jpeg' && outputFormat !== 'webp'}
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">背景（background）</div>
                <Select
                  className="!w-full"
                  value={background}
                  onChange={setBackground}
                  options={IMAGE_BACKGROUNDS.map((b) => ({ value: b, label: `${b} · ${BACKGROUND_LABELS[b]}` }))}
                  placeholder="不传"
                  allowClear
                />
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] text-bone-dim">风格（style，仅 dall-e-3）</div>
                <Select
                  className="!w-full"
                  value={style}
                  onChange={setStyle}
                  options={IMAGE_STYLES.map((s) => ({ value: s, label: `${s} · ${STYLE_LABELS[s]}` }))}
                  placeholder="不传"
                  allowClear
                />
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-bone-faint">
              三个概念各管一件事：画幅＝宽高比（形状）；分辨率＝清晰度档位（480p…4K），决定长边像素；质量＝模型渲染精细度，与分辨率无关。最终像素由「画幅 × 分辨率」自动算出，预览框即实际会发出的尺寸。要精确到某个像素值，去「请求设置」改原始请求。
            </p>
          </section>

          <div className="flex items-center gap-2">
            <span className="mono text-[10.5px] text-bone-faint">
              {queued > 0
                ? `队列中 ${queued} 个待处理${generating ? ' · 1 个正在跑' : ''}`
                : generating
                  ? '正在生成，慢的模型一张要几分钟'
                  : override !== null
                    ? '原始请求接管中'
                    : `${n} 张 · ${effectiveSize ? `${effectiveSize} · ${effectiveAspect} · ${resolution}` : '默认尺寸'}`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {generating ? (
                <Button danger icon={<Square size={14} />} onClick={() => job.stop()}>
                  停止当前
                </Button>
              ) : null}
              <Button
                type="primary"
                icon={<Sparkles size={14} />}
                disabled={override !== null && overrideBody === undefined}
                onClick={() => void generate()}
              >
                加入队列
              </Button>
            </div>
          </div>
        </div>

        {/* ── 右列：本次结果 ── */}
        <section className="panel rise flex min-w-0 flex-col overflow-hidden" style={{ animationDelay: '120ms', minHeight: 520 }}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
            <span className="eyebrow">Results · 当前任务</span>
            <Tag variant="filled">{works.length} 张</Tag>
            {queued > 0 ? (
              <Tag variant="filled" style={{ color: '#a79c8c' }}>
                排队 {queued}
              </Tag>
            ) : null}
            {generating ? (
              <Tag variant="filled" style={{ color: '#e0a458', background: 'rgba(224,164,88,0.12)' }}>
                <span className="lamp-live mr-1 inline-block size-1.5 rounded-full bg-amber text-amber" />
                生成中
              </Tag>
            ) : null}
            <Link href="/works" className="mono ml-auto text-[11px] text-bone-faint transition-colors hover:text-amber">
              全部作品 →
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {works.length === 0 && partialEntries.length === 0 && !generating ? (
              <div className="grid h-full min-h-80 place-items-center">
                <div className="text-center">
                  <div className="display text-[17px] text-bone-dim">这里会出现生成的图</div>
                  <p className="mt-1.5 text-[12.5px] text-bone-faint">选好图像模型，写提示词，点「加入队列」</p>
                </div>
              </div>
            ) : (
              <>
                {generating ? <DevelopingStatus pending={pendingCount} /> : null}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {partialEntries.map(([idx, url]) => (
                    <div key={`partial-${idx}`} className="relative overflow-hidden rounded-lg border border-line-soft bg-ink-950">
                      <img src={url} alt={`第 ${Number(idx) + 1} 张半成品`} className="aspect-square w-full object-cover opacity-85" />
                      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2 py-1.5" style={{ background: 'rgba(13,11,10,0.82)' }}>
                        <span className="lamp-live inline-block size-1.5 rounded-full bg-amber text-amber" />
                        <span className="mono text-[10px] text-bone-dim">绘制中 #{Number(idx) + 1}</span>
                      </div>
                    </div>
                  ))}
                  {works.map((w) => (
                    <WorkCard
                      key={w.id}
                      work={w}
                      onDelete={() => void removeWork(w.id)}
                      onEdit={() => {
                        setMode('edit');
                        setSource(sourceFromWork(w));
                        toast.info('已切到改图，原图就绪');
                      }}
                    />
                  ))}
                  {Array.from({ length: pendingCount }, (_, i) => (
                    <DevelopingFrame key={`developing-${i}`} index={works.length + partialEntries.length + i} />
                  ))}
                </div>
              </>
            )}
          </div>

          {failure ? (
            <div className="border-t border-line-soft p-4">
              <FailureNote status={failure.kind} message={failure.message} detail={failure.detail} />
            </div>
          ) : null}
        </section>
      </div>

      {/* ── 改图原图：从作品库挑一张，直接引用不拷贝 ── */}
      <WorkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(w) => setSource(sourceFromWork(w))}
      />

      {/* ── 请求设置抽屉：润色模型 + 原始请求面板 ── */}
      <Drawer
        title="请求设置"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={560}
        styles={{ body: { background: '#100e0c' }, header: { background: '#16130f' } }}
      >
        <div className="mb-5">
          <div className="mb-1.5 text-[12.5px] text-bone-dim">润色用的对话模型</div>
          <ModelPicker kind="chat" prefKey="last:chat" value={polishChoice} onChange={onPolishChoice} />
          <p className="mt-1.5 text-[11.5px] text-bone-faint">
            图像模型不会改写文本，「润色」要借一个对话模型，按生图提示词的写法改。
          </p>
        </div>

        <RawRequestPanel formJson={formJson} override={override} onOverride={setOverride} />
        <p className="mt-2 text-[11.5px] leading-relaxed text-bone-faint">
          这段 JSON 就是表单要发的参数。stream 由后端按供应商与模型自动决定；改图时原图以 multipart 一并发送，不出现在这里。
        </p>
      </Drawer>
    </>
  );
}