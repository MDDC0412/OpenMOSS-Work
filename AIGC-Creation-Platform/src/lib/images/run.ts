import type OpenAI from 'openai';
import { makeImageClient } from '../providers/client';
import type { ProviderRow } from '../providers/types';
import { detectGateway } from '../providers/url';
import { readGenerated, readUpload, saveGenerated, sniffMime } from '../works/files';
import { getWork, insertWork, newId, type WorkListItem } from '../works/repo';
import type { ImageBackground, ImageComplexity, ImageOutputFormat, ImageQuality, ImageStyle } from './options';

export interface ImageRunInput {
  provider: ProviderRow;
  modelId: string;
  mode: 'generate' | 'edit';
  prompt: string;
  n: number;
  size?: string;
  quality?: ImageQuality;
  background?: ImageBackground;
  style?: ImageStyle;
  complexity?: ImageComplexity;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  sourceFileName?: string | null;
  sourceWorkId?: string | null;
  rawOverride?: Record<string, unknown> | null;
  signal?: AbortSignal;
}

export type ImageEvent =
  | { type: 'partial'; index: number; b64: string; format: string }
  | { type: 'work'; work: WorkListItem }
  | { type: 'done'; workIds: string[] };

type GenParams = OpenAI.Images.ImageGenerateParamsNonStreaming;
type EditParams = OpenAI.Images.ImageEditParamsNonStreaming;
type StreamEvent = OpenAI.Images.ImageGenStreamEvent | OpenAI.Images.ImageEditStreamEvent;
type FinalItem = { b64_json?: string | null; url?: string | null };

// 把一张最终图落盘并登记进作品库。base64 与 url 两种返回都收：
// String 给 b64，New API 可能给临时 url，url 由服务端下载，作品库永远持有本地副本。
// 记的是 params（真正发出去的那份）而不是 input：用户手改原始请求后，作品库要跟实际请求对得上。
async function persistImage(input: ImageRunInput, params: GenParams, item: FinalItem): Promise<WorkListItem> {
  let buf: Uint8Array;
  if (item.b64_json) {
    buf = new Uint8Array(Buffer.from(item.b64_json, 'base64'));
  } else if (item.url) {
    const res = await fetch(item.url, { signal: input.signal });
    if (!res.ok) throw new Error(`下载生成结果失败（HTTP ${res.status}）：${item.url}`);
    buf = new Uint8Array(await res.arrayBuffer());
  } else {
    throw new Error('供应商返回的条目里既没有 b64_json 也没有 url，拿不到图');
  }

  const id = newId();
  const saved = await saveGenerated(id, buf);
  return insertWork({
    id,
    provider_id: input.provider.id,
    model_id: input.modelId,
    kind: 'image',
    prompt: typeof params.prompt === 'string' ? params.prompt : input.prompt,
    params: JSON.stringify({
      mode: input.mode,
      n: typeof params.n === 'number' ? params.n : input.n,
      size: params.size ?? null,
      quality: params.quality ?? null,
      background: params.background ?? null,
      style: params.style ?? null,
      complexity: params.complexity ?? null,
      output_format: params.output_format ?? null,
      output_compression: params.output_compression ?? null,
    }),
    file_name: saved.fileName,
    mime_type: saved.mime,
    bytes: saved.bytes,
    source_image: input.sourceWorkId ? `work:${input.sourceWorkId}` : (input.sourceFileName ?? null),
  });
}

// 改图原图两个来源：上传目录的文件名，或作品库 id。
// 引用作品时直接读作品文件，不往上传目录拷贝；作品被删则明确报错而不是静默失败。
export async function readEditSource(input: ImageRunInput): Promise<{ buf: Uint8Array<ArrayBuffer>; name: string }> {
  if (input.sourceWorkId) {
    const work = getWork(input.sourceWorkId);
    if (!work) throw new Error('选中的作品已不在作品库，可能刚被删掉，重新选一张');
    return { buf: await readGenerated(work.file_name), name: work.file_name };
  }
  if (input.sourceFileName) {
    return { buf: await readUpload(input.sourceFileName), name: input.sourceFileName };
  }
  throw new Error('改图要先上传一张原图，或从作品库选一张');
}

// 流式与非流式两种响应归一成同一种事件序列，后面的落盘逻辑只写一遍。
// 用带 kind 的包装而不是裸联合类型：'data' in res 在这种联合上收窄不生效。
type Upstream =
  | { kind: 'batch'; res: OpenAI.Images.ImagesResponse }
  | { kind: 'stream'; events: AsyncIterable<StreamEvent> };

async function* readResponse(
  up: Upstream,
): AsyncGenerator<{ type: 'partial'; index: number; b64: string; format: string } | { type: 'final'; item: FinalItem }> {
  if (up.kind === 'batch') {
    for (const item of up.res.data ?? []) yield { type: 'final', item };
    return;
  }
  for await (const ev of up.events) {
    if (ev.type === 'image_generation.partial_image' || ev.type === 'image_edit.partial_image') {
      // 半成品可能是 png/webp/jpeg，带上真实格式，浏览器才不会按错误的 MIME 解码
      yield { type: 'partial', index: ev.partial_image_index, b64: ev.b64_json, format: ev.output_format };
    } else {
      yield { type: 'final', item: { b64_json: ev.b64_json } };
    }
  }
}

export async function* runImage(input: ImageRunInput): AsyncGenerator<ImageEvent> {
  const client = makeImageClient(input.provider);
  const gateway = detectGateway(input.provider.base_url, input.provider.gateway_hint);
  // String 的 gpt-image 系列走 SSE（partial_image → completed）；
  // 同家的 gemini 图像模型明确不能带 stream 参数，带了会报错，所以这里按模型区分。
  const wantStream = gateway === 'string' && /gpt-image/i.test(input.modelId);

  // rawOverride 是用户在原始请求面板里手写的 JSON，边界只校验它是个对象，
  // 字段是否合法交给供应商判定，所以这里断言成 SDK 参数类型。
  const params: GenParams = input.rawOverride
    ? (input.rawOverride as unknown as GenParams)
    : {
        model: input.modelId,
        prompt: input.prompt,
        n: input.n,
        ...(input.size ? { size: input.size } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.style ? { style: input.style } : {}),
        ...(input.complexity ? { complexity: input.complexity } : {}),
        ...(input.output_format ? { output_format: input.output_format } : {}),
        // 0 是合法压缩率，用 !== undefined 判存在，别被 falsy 吞掉
        ...(input.output_compression !== undefined ? { output_compression: input.output_compression } : {}),
      };
  // 读响应的方式必须和真正发出去的 stream 一致，否则会"发了非流式却按流式读"。
  // 原始请求接管时以用户写的为准；表单模式才自动决定。
  const streaming = input.rawOverride ? input.rawOverride.stream === true : wantStream;
  // 表单模式的非流式分支一个 stream 字段都不能带（见上面 gemini 的限制），
  // 流式分支在调用处显式补 true，而不是给非流式补 false。
  if (!input.rawOverride) delete params.stream;

  let up: Upstream;
  if (input.mode === 'edit') {
    const { buf, name } = await readEditSource(input);
    const image = new File([buf], name, { type: sniffMime(buf).mime });
    const editParams = { ...params, image } as EditParams;
    up = streaming
      ? { kind: 'stream', events: await client.images.edit({ ...editParams, stream: true as const }, { signal: input.signal }) }
      : { kind: 'batch', res: await client.images.edit(editParams, { signal: input.signal }) };
  } else {
    up = streaming
      ? { kind: 'stream', events: await client.images.generate({ ...params, stream: true as const }, { signal: input.signal }) }
      : { kind: 'batch', res: await client.images.generate(params, { signal: input.signal }) };
  }

  const workIds: string[] = [];
  for await (const ev of readResponse(up)) {
    if (ev.type === 'partial') {
      yield ev;
      continue;
    }
    const work = await persistImage(input, params, ev.item);
    workIds.push(work.id);
    yield { type: 'work', work };
  }

  // 一张都没拿到时必须报错：上游忽略 stream、或返回了空 data 时，
  // 静默结束会让界面看起来"点了没反应"，用户无从判断。
  if (workIds.length === 0) {
    throw new Error('供应商一张图都没返回。可能是这个模型不收当前的参数组合，或它的流式响应格式与 OpenAI 不一致；去「请求设置」看原始请求，换个参数或自己写 stream 字段再试。');
  }

  yield { type: 'done', workIds };
}