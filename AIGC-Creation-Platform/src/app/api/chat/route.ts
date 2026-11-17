import type OpenAI from 'openai';
import { z } from 'zod';
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  touchConversation,
} from '~/lib/chat/repo';
import { normalizeError } from '~/lib/errors';
import { HttpError, readJson, route } from '~/lib/http';
import { cachedPackTexts, resolvePackTexts } from '~/lib/packs/fetch';
import { makeClient } from '~/lib/providers/client';
import { getProvider } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 长回答可能跑几分钟，给足上限；真正的中断靠浏览器断开时的 req.signal
export const maxDuration = 300;

const schema = z.object({
  conversationId: z.string().nullable().default(null),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  content: z.string().min(1, '要写点什么再发送'),
  packIds: z.array(z.string()).default([]),
  system: z.string().default(''),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  // 用户在原始请求面板里改过的完整请求体；给了就原样发，表单参数不再参与
  rawOverride: z.record(z.string(), z.unknown()).nullable().default(null),
});

const encoder = new TextEncoder();

// SSE 一帧。JSON.stringify 不会产出裸换行，所以 data 永远只有一行，前端解析可以很简单
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// 把会话历史转成供应商要的 messages。用户消息若带提示词包，
// 用缓存里的包文本补回去，尽量还原当时真正发出去的 prompt。
function historyMessages(conversationId: string, system: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system.trim()) out.push({ role: 'system', content: system });
  for (const m of listMessages(conversationId)) {
    if (m.role === 'system') continue;
    let content = m.content;
    if (m.role === 'user' && m.pack_ids) {
      const ids = JSON.parse(m.pack_ids) as string[];
      const packs = cachedPackTexts(ids);
      if (packs.length) content = `${content}\n\n${packs.map((p) => p.content).join('\n\n')}`;
    }
    out.push({ role: m.role, content });
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, schema);
    const provider = getProvider(input.providerId);
    if (!provider) throw new HttpError(404, '供应商不存在，去供应商页看看是不是被删了');

    // 选中的包在这里解析（没抓过的现抓）：抓失败就直接报错，不发半截 prompt。
    // 文本落进缓存后，下面 historyMessages 组装这条用户消息时会把它追加上去。
    await resolvePackTexts(input.packIds);

    let conversation = input.conversationId ? getConversation(input.conversationId) : null;
    if (input.conversationId && !conversation) throw new HttpError(404, '会话不存在');
    if (!conversation) {
      // 标题取首条消息前 30 字，之后可以在会话列表里改
      conversation = createConversation({
        title: input.content.slice(0, 30) || '新会话',
        providerId: provider.id,
        modelId: input.modelId,
      });
    }
    const convId = conversation.id;

    addMessage({ conversationId: convId, role: 'user', content: input.content, packIds: input.packIds });
    touchConversation(convId, { providerId: provider.id, modelId: input.modelId });

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = input.rawOverride
      ? ({ ...input.rawOverride, stream: true } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)
      : {
          model: input.modelId,
          messages: historyMessages(convId, input.system),
          stream: true,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.topP !== undefined ? { top_p: input.topP } : {}),
          ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        };

    const client = makeClient(provider);
    // 浏览器一断开就把上游请求也掐掉：流式对话按 token 计费，没人看就别继续烧
    const upstream = await client.chat.completions.create(body, { signal: req.signal });

    let assistantId: string | null = null;
    let accumulated = '';

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: string, data: unknown) => controller.enqueue(sse(event, data));
        try {
          emit('meta', { conversationId: convId });
          for await (const chunk of upstream) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              emit('delta', { text: delta });
            }
          }
          const saved = addMessage({ conversationId: convId, role: 'assistant', content: accumulated });
          assistantId = saved.id;
          emit('done', { messageId: saved.id, conversationId: convId });
        } catch (err) {
          // 用户主动停止不算错误：半截回答落盘，前端自己收尾
          if (req.signal.aborted) {
            if (accumulated) addMessage({ conversationId: convId, role: 'assistant', content: accumulated });
          } else {
            if (accumulated) {
              const saved = addMessage({ conversationId: convId, role: 'assistant', content: accumulated });
              assistantId = saved.id;
            }
            const norm = normalizeError(err);
            emit('error', { ...norm, messageId: assistantId });
          }
        } finally {
          controller.close();
        }
      },
      cancel() {
        // 浏览器关掉流时确保上游也停。req.signal 通常已经触发，这里兜底
        upstream.controller.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // nginx 一类反代见到这个头才会关掉缓冲，流式字才能一个个蹦出来
        'X-Accel-Buffering': 'no',
      },
    });
  });
}