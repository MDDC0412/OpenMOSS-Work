import { z } from 'zod';
import { normalizeError } from '~/lib/errors';
import { HttpError, json, readJson, route } from '~/lib/http';
import { makeClient } from '~/lib/providers/client';
import { getProvider } from '~/lib/providers/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  // 润色要看目标模态：给生图模型的提示词和给对话模型的消息是两种改法
  target: z.enum(['chat', 'image']),
  text: z.string().min(1, '先写点内容再润色'),
});

// 两条系统指令分别对应两种目标。都要求"只输出改好的文本"，
// 否则模型会附带解释，用户还得手动删。
const SYSTEM: Record<'chat' | 'image', string> = {
  chat:
    '你是提示词编辑。把用户给的草稿改写成一条更清晰、可直接发送给对话模型的消息：保留原意、所有事实与约束，补全含糊的指代，必要时分点。只输出改好的消息本身，不要解释、不要加引号、不要使用 markdown 代码块。',
  image:
    '你是文生图提示词工程师。把用户给的草稿改写成一条可直接喂给图像生成模型的提示词：保留主体与意图，补全风格、光线、构图、材质与画质等维度，语言与用户草稿保持一致。只输出提示词本身，不要解释、不要加引号、不要使用 markdown 代码块。',
};

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, schema);
    const provider = getProvider(input.providerId);
    if (!provider) throw new HttpError(404, '供应商不存在，去供应商页看看是不是被删了');

    try {
      const client = makeClient(provider);
      const res = await client.chat.completions.create({
        model: input.modelId,
        messages: [
          { role: 'system', content: SYSTEM[input.target] },
          { role: 'user', content: input.text },
        ],
        // 润色是短文本改写，不需要流式；一次拿完整结果直接回填输入框
        stream: false,
        max_tokens: 1200,
      });
      const text = res.choices?.[0]?.message?.content?.trim();
      if (!text) throw new HttpError(502, '润色模型返回了空内容，换个模型再试');
      return json({ text });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const norm = normalizeError(err);
      throw new HttpError(502, norm.message);
    }
  });
}