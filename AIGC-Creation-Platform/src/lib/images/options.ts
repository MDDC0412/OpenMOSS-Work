// 生图参数的可选值。API 边界校验与界面下拉共用这一份，避免两边各写一套对不上。
// 取值范围来自 openai SDK 的 images 参数类型（New API 与 String 都按 OpenAI 格式转发）。

export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'standard', 'hd'] as const;
export const IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
// style 只有 dall-e-3 认，其它模型带上可能被拒；界面默认不选
export const IMAGE_STYLES = ['vivid', 'natural'] as const;
// complexity 是"出图前规划画面的算力"，与 quality（渲染精细度）是两码事；只有 gpt-image 系列认
export const IMAGE_COMPLEXITIES = ['low', 'medium', 'high'] as const;
// 返回图片的格式；output_compression 只对 webp / jpeg 生效
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif'] as const;

export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
export type ImageStyle = (typeof IMAGE_STYLES)[number];
export type ImageComplexity = (typeof IMAGE_COMPLEXITIES)[number];
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

// 画幅＝宽高比（形状）。不是 API 参数：OpenAI 生图只认像素 size，
// 界面上选比例，再和分辨率档位一起换算成像素（见 sizeFromAspectResolution）。
export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '2:1', '1:2'] as const;
export type ImageAspect = (typeof ASPECT_RATIOS)[number];

// 分辨率＝清晰度档位，决定"长边"像素。p 档按 16:9 的长边取值（480p→854、720p→1280），
// K 档按长边取值（1K→1024 … 4K→3840），这样 16:9 下正好落在大家熟悉的 1280x720 / 3840x2160 等分辨率上。
export const IMAGE_RESOLUTIONS = ['480p', '720p', '1K', '1.5K', '2K', '2.5K', '4K'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const RESOLUTION_LONG_EDGE: Record<ImageResolution, number> = {
  '480p': 854,
  '720p': 1280,
  '1K': 1024,
  '1.5K': 1536,
  '2K': 2048,
  '2.5K': 2560,
  '4K': 3840,
};

// 把 "WxH" 像素约分成 "w:h" 画幅；auto / 空 / 非法值返回 ''（界面据此显示占位）。
export function aspectOf(size: string): string {
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return '';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w <= 0 || h <= 0) return '';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

// 画幅 × 分辨率 → 真正发出去的像素 size：长边取档位值，短边按比例换算。
// 宽高都取 16 的倍数（gpt-image 系列的硬约束），并夹在 [16, 3840]；非法输入返回 ''。
export function sizeFromAspectResolution(aspect: string, resolution: string): string {
  const long = RESOLUTION_LONG_EDGE[resolution as ImageResolution];
  const m = /^(\d+):(\d+)$/.exec(aspect);
  if (!long || !m) return '';
  const aw = Number(m[1]);
  const ah = Number(m[2]);
  if (aw <= 0 || ah <= 0) return '';
  // 横版长边是宽、竖版长边是高，方形两边都等于档位值
  const w = aw >= ah ? long : (long * aw) / ah;
  const h = aw >= ah ? (long * ah) / aw : long;
  const r16 = (v: number) => Math.min(3840, Math.max(16, Math.round(v / 16) * 16));
  return `${r16(w)}x${r16(h)}`;
}