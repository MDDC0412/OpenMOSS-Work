import { z } from 'zod';
import { normalizeError } from '~/lib/errors';
import { HttpError, readJson, route } from '~/lib/http';
import { runImage } from '~/lib/images/run';
import { IMAGE_BACKGROUNDS, IMAGE_COMPLEXITIES, IMAGE_OUTPUT_FORMATS, IMAGE_QUALITIES, IMAGE_STYLES } from '~/lib/images/options';
import { resolvePackTexts } from '~/lib/packs/fetch';
import { getProvider } from '~/lib/providers/repo';
import { toPublicWork } from '~/lib/works/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 生图慢的模型一张要几分钟，n 张更久；上限放宽，中断靠浏览器断开
export const maxDuration = 600;

const schema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  mode: z.enum(['generate', 'edit']),
  prompt: z.string().min(1, '要写提示词'),
  packIds: z.array(z.string()).default([]),
  n: z.number().int().min(1).max(10).default(1),
  size: z.string().optional(),
  quality: z.enum(IMAGE_QUALITIES).optional(),
  background: z.enum(IMAGE_BACKGROUNDS).optional(),
  style: z.enum(IMAGE_STYLES).optional(),
  complexity: z.enum(IMAGE_COMPLEXITIES).optional(),
  output_format: z.enum(IMAGE_OUTPUT_FORMATS).optional(),
  // 压缩率 0-100，只对 webp/jpeg 有意义；边界只挡范围，是否被模型接受交给供应商
  output_compression: z.number().int().min(0).max(100).optional(),
  sourceFileName: z.string().nullable().default(null),
  // 改图原图也可以直接引用作品库；与 sourceFileName 二选一，前端保证不并存
  sourceWorkId: z.string().nullable().default(null),
  rawOverride: z.record(z.string(), z.unknown()).nullable().default(null),
});

const encoder = new TextEncoder();
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, schema);
    const provider = getProvider(input.providerId);
    if (!provider) throw new HttpError(404, '供应商不存在，去供应商页看看是不是被删了');

    const packs = await resolvePackTexts(input.packIds);
    const prompt = packs.length ? `${input.prompt}\n\n${packs.map((p) => p.content).join('\n\n')}` : input.prompt;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: string, data: unknown) => controller.enqueue(sse(event, data));
        try {
          for await (const ev of runImage({
            provider,
            modelId: input.modelId,
            mode: input.mode,
            prompt,
            n: input.n,
            size: input.size,
            quality: input.quality,
            background: input.background,
            style: input.style,
            complexity: input.complexity,
            output_format: input.output_format,
            output_compression: input.output_compression,
            sourceFileName: input.sourceFileName,
            sourceWorkId: input.sourceWorkId,
            rawOverride: input.rawOverride,
            signal: req.signal,
          })) {
            if (ev.type === 'partial') emit('partial', { index: ev.index, b64: ev.b64, format: ev.format });
            else if (ev.type === 'work') emit('work', { work: toPublicWork(ev.work) });
            else emit('done', { workIds: ev.workIds });
          }
        } catch (err) {
          // 用户主动停止不算失败；已经落盘的作品保留
          if (!req.signal.aborted) emit('error', normalizeError(err));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}