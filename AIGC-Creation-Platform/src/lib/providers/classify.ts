// 模型用途分类。两家给的信息量不同：
// String AI 的 /v1/models 每个模型带 type 和 display_name；New API 只给 id/object/created/owned_by。
// 所以优先用供应商给的 type，没有才靠模型名规则猜，猜的结果允许用户手工改且不被体检覆盖。

export type ModelKind = 'chat' | 'image' | 'video' | 'other';
export type KindSource = 'provider' | 'guess' | 'manual';

// 先排除非生成类模型，避免 text-embedding-3 被当成对话模型
const OTHER_PATTERNS = [
  'embedding',
  'rerank',
  'whisper',
  'transcribe',
  'tts',
  'audio',
  'moderation',
  'bge-',
  'bge_',
  'text-embedding',
];

const VIDEO_PATTERNS = [
  'sora',
  'kling',
  'veo',
  'runway',
  'gen-3',
  'gen-4',
  'luma',
  'dream-machine',
  'hailuo',
  'minimax-video',
  'jimeng',
  'seedance',
  'cogvideox',
  'pika',
  'haiper',
  'vidu',
  'ltxv',
  'ltx-video',
  'wan2',
  'wan-2',
  'video',
];

const IMAGE_PATTERNS = [
  'gpt-image',
  'dall-e',
  'dalle',
  'midjourney',
  'mj_',
  'flux',
  'stable-diffusion',
  'sdxl',
  'sd3',
  'sd-xl',
  'nano-banana',
  'imagen',
  'seedream',
  'cogview',
  'wanx',
  'image',
  'playground',
  'ideogram',
  'recraft',
];

function matchesAny(id: string, patterns: string[]): boolean {
  return patterns.some((p) => id.includes(p));
}

// String 的 type 字段取值我没有真实密钥可验证，所以只做宽松映射：
// 认得就用，认不得就退回名字规则，并把原值存进 raw_type 供后续核对。
export function kindFromProviderType(rawType: string | null | undefined): ModelKind | null {
  if (!rawType) return null;
  const t = rawType.trim().toLowerCase();
  if (['chat', 'llm', 'text', 'completion', 'chat-completion', 'language'].includes(t)) return 'chat';
  if (['image', 'images', 'image-generation', 'text-to-image', 't2i', 'drawing'].includes(t)) return 'image';
  if (['video', 'videos', 'video-generation', 'text-to-video', 't2v'].includes(t)) return 'video';
  if (['embedding', 'embeddings', 'audio', 'speech', 'rerank', 'moderation', 'transcription'].includes(t)) return 'other';
  return null;
}

export function guessKind(modelId: string): ModelKind {
  const id = modelId.toLowerCase();
  // embedding/audio 类必须先判：'gpt-4o-audio-preview' 含 audio 应归 other 而不是 chat
  if (matchesAny(id, OTHER_PATTERNS)) return 'other';
  if (matchesAny(id, VIDEO_PATTERNS)) return 'video';
  if (matchesAny(id, IMAGE_PATTERNS)) return 'image';
  return 'chat';
}

export function resolveKind(modelId: string, rawType?: string | null): { kind: ModelKind; source: KindSource } {
  const fromProvider = kindFromProviderType(rawType);
  if (fromProvider) return { kind: fromProvider, source: 'provider' };
  return { kind: guessKind(modelId), source: 'guess' };
}

export const KIND_LABEL: Record<ModelKind, string> = {
  chat: '对话',
  image: '图片',
  video: '视频',
  other: '其他',
};