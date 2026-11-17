import { z } from 'zod';
import { json, readJson, route } from '~/lib/http';
import { createConversation, listConversations } from '~/lib/chat/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(1).max(80).default('新会话'),
  providerId: z.string().nullable().default(null),
  modelId: z.string().nullable().default(null),
});

export async function GET(): Promise<Response> {
  return route(async () => json({ conversations: listConversations() }));
}

export async function POST(req: Request): Promise<Response> {
  return route(async () => {
    const input = await readJson(req, createSchema);
    return json({ conversation: createConversation(input) }, 201);
  });
}