'use client';

import { App, Button, Drawer, Input, InputNumber, Popconfirm, Typography } from 'antd';
import { MessageSquarePlus, PanelRightOpen, Send, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FailureNote from '~/components/FailureNote';
import Markdown from '~/components/Markdown';
import ModelPicker, { type ModelChoice } from '~/components/ModelPicker';
import PageHeader from '~/components/PageHeader';
import PromptBox from '~/components/PromptBox';
import RawRequestPanel from '~/components/RawRequestPanel';
import type { ConversationRow } from '~/lib/chat/repo';
import { api, ApiError } from '~/lib/client/api';
import { postSse, readSse } from '~/lib/client/sse';
import type { FailureKind } from '~/lib/errors';
import type { PackRow } from '~/lib/packs/repo';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  packIds: string[];
}

interface Failure {
  kind: FailureKind;
  message: string;
  detail?: string;
}

export default function ChatView() {
  const { message: toast } = App.useApp();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [packIds, setPackIds] = useState<string[]>([]);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [system, setSystem] = useState('');
  const [temperature, setTemperature] = useState<number | null>(null);
  const [topP, setTopP] = useState<number | null>(null);
  const [maxTokens, setMaxTokens] = useState<number | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const { conversations: rows } = await api.get<{ conversations: ConversationRow[] }>('/api/conversations');
      setConversations(rows);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    }
  }, [toast]);

  useEffect(() => {
    void loadConversations();
    void api
      .get<{ packs: PackRow[] }>('/api/packs')
      .then(({ packs: rows }) => setPacks(rows))
      .catch(() => undefined);
  }, [loadConversations]);

  // 新字蹦出来时跟着滚到底，但用户往上翻历史时不强行拽回来
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  const onChoice = useCallback((v: ModelChoice) => setChoice(v), []);

  // 表单推导出的请求体：历史 + 本次输入，选中的包按缓存文本追加，和后端发出去的一致
  const formJson = useMemo(() => {
    const append = (content: string, ids: string[]) => {
      const texts = packs.filter((p) => ids.includes(p.id) && p.content != null).map((p) => p.content);
      return texts.length ? `${content}\n\n${texts.join('\n\n')}` : content;
    };
    const msgs: { role: string; content: string }[] = [];
    if (system.trim()) msgs.push({ role: 'system', content: system });
    for (const m of messages) msgs.push({ role: m.role, content: append(m.content, m.packIds) });
    msgs.push({ role: 'user', content: append(input, packIds) });
    return JSON.stringify(
      {
        model: choice?.modelId ?? '(未选模型)',
        messages: msgs,
        stream: true,
        ...(temperature != null ? { temperature } : {}),
        ...(topP != null ? { top_p: topP } : {}),
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      },
      null,
      2,
    );
  }, [system, messages, input, packIds, packs, choice, temperature, topP, maxTokens]);

  const overrideBody = useMemo(() => {
    if (override === null) return null;
    try {
      return JSON.parse(override) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, [override]);

  async function openConversation(id: string) {
    try {
      const { conversation, messages: rows } = await api.get<{
        conversation: ConversationRow;
        messages: { id: string; role: 'user' | 'assistant'; content: string; pack_ids: string | null }[];
      }>(`/api/conversations/${id}`);
      setCurrentId(conversation.id);
      setMessages(
        rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          packIds: m.pack_ids ? (JSON.parse(m.pack_ids) as string[]) : [],
        })),
      );
      setFailure(null);
      setStreamText(null);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    }
  }

  function newConversation() {
    setCurrentId(null);
    setMessages([]);
    setFailure(null);
    setStreamText(null);
  }

  async function removeConversation(id: string) {
    try {
      await api.del(`/api/conversations/${id}`);
      if (currentId === id) newConversation();
      await loadConversations();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    }
  }

  async function rename(title: string) {
    if (!currentId || !title.trim()) return;
    try {
      await api.patch(`/api/conversations/${currentId}`, { title: title.trim() });
      await loadConversations();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    }
  }

  async function polish() {
    if (!choice) {
      toast.warning('先选一个对话模型用来润色');
      return;
    }
    setPolishing(true);
    try {
      const { text } = await api.post<{ text: string }>('/api/polish', {
        providerId: choice.providerId,
        modelId: choice.modelId,
        target: 'chat',
        text: input,
      });
      setInput(text);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
    } finally {
      setPolishing(false);
    }
  }

  async function send() {
    if (!choice) {
      toast.warning('先去供应商页体检拉出模型，再在这里选一个');
      return;
    }
    if (!input.trim()) return;
    if (override !== null && overrideBody === undefined) return;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: input,
      packIds,
    };
    setMessages((m) => [...m, userMessage]);
    setInput('');
    setPackIds([]);
    setFailure(null);
    setStreamText('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';

    try {
      const res = await postSse(
        '/api/chat',
        {
          conversationId: currentId,
          providerId: choice.providerId,
          modelId: choice.modelId,
          content: userMessage.content,
          packIds: userMessage.packIds,
          system,
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { topP } : {}),
          ...(maxTokens != null ? { maxTokens } : {}),
          rawOverride: overrideBody ?? null,
        },
        controller.signal,
      );

      for await (const ev of readSse(res)) {
        const data = ev.data as Record<string, unknown>;
        if (ev.event === 'meta') {
          setCurrentId(data.conversationId as string);
        } else if (ev.event === 'delta') {
          acc += data.text as string;
          setStreamText(acc);
        } else if (ev.event === 'done') {
          setMessages((m) => [...m, { id: data.messageId as string, role: 'assistant', content: acc, packIds: [] }]);
        } else if (ev.event === 'error') {
          if (acc) setMessages((m) => [...m, { id: `err-${Date.now()}`, role: 'assistant', content: acc, packIds: [] }]);
          setFailure({
            kind: (data.kind as FailureKind) ?? 'error',
            message: (data.message as string) ?? '请求失败',
            detail: data.detail as string | undefined,
          });
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // 主动停止：半截回答留在界面上，和服务端落盘的那条一致
        if (acc) setMessages((m) => [...m, { id: `stop-${Date.now()}`, role: 'assistant', content: acc, packIds: [] }]);
      } else if (err instanceof ApiError) {
        setFailure({ kind: err.kind, message: err.message, detail: err.detail });
      } else {
        setFailure({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setSending(false);
      setStreamText(null);
      abortRef.current = null;
      void loadConversations();
    }
  }

  const current = conversations.find((c) => c.id === currentId);

  return (
    <>
      <PageHeader
        eyebrow="Chat · 对话"
        title="对话"
        description="流式输出，会话与消息存在本机，随时回来接着聊。输入 @ 把提示词包的文本追加进 prompt。"
        actions={
          <>
            <Button icon={<PanelRightOpen size={15} />} onClick={() => setDrawerOpen(true)}>
              请求设置
            </Button>
            <Button type="primary" icon={<MessageSquarePlus size={15} />} onClick={newConversation}>
              新会话
            </Button>
          </>
        }
      />

      <div className="flex gap-4" style={{ height: 'calc(100vh - 232px)', minHeight: 460 }}>
        {/* ── 会话列表 ── */}
        <aside className="panel flex w-56 shrink-0 flex-col overflow-hidden">
          <div className="eyebrow border-b border-line-soft px-4 py-3">会话历史</div>
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-bone-faint">还没有会话</div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className="group mb-1 flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-2 transition-colors hover:bg-amber/6"
                  style={c.id === currentId ? { background: 'rgba(224,164,88,0.1)' } : undefined}
                  onClick={() => void openConversation(c.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[12.5px]"
                      style={{ color: c.id === currentId ? '#f2be79' : '#a79c8c' }}
                    >
                      {c.title}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-bone-faint">
                      {new Date(c.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span onClick={(e) => e.stopPropagation()} className="opacity-0 transition-opacity group-hover:opacity-100">
                    <Popconfirm
                      title="删除这个会话？"
                      description="里面的消息会一起删掉，无法恢复。"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void removeConversation(c.id)}
                    >
                      <Button size="small" type="text" danger icon={<Trash2 size={13} />} />
                    </Popconfirm>
                  </span>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── 对话主区 ── */}
        <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
            {current ? (
              <Typography.Text
                className="!mb-0 max-w-40 truncate !text-[13px] !text-bone"
                editable={{ onChange: (v) => void rename(v), tooltip: '重命名会话' }}
              >
                {current.title}
              </Typography.Text>
            ) : (
              <span className="text-[13px] text-bone-faint">新会话</span>
            )}
            <div className="min-w-0 flex-1">
              <ModelPicker kind="chat" prefKey="last:chat" value={choice} onChange={onChoice} disabled={sending} />
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
            {messages.length === 0 && streamText === null ? (
              <div className="grid h-full place-items-center">
                <div className="text-center">
                  <div className="display text-[17px] text-bone-dim">开始一段对话</div>
                  <p className="mt-1.5 text-[12.5px] text-bone-faint">选好模型，在下面写第一句话</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className="max-w-[86%] rounded-lg px-4 py-3 text-[13px] leading-relaxed"
                      style={
                        m.role === 'user'
                          ? { background: 'rgba(224,164,88,0.12)', border: '1px solid rgba(224,164,88,0.22)' }
                          : { background: '#16130f', border: '1px solid #241f1a' }
                      }
                    >
                      {m.role === 'user' ? (
                        <>
                          <div className="whitespace-pre-wrap">{m.content}</div>
                          {m.packIds.length > 0 ? (
                            <div className="mono mt-2 text-[10.5px] text-amber">
                              + {m.packIds.length} 个提示词包已追加进 prompt
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <Markdown text={m.content} />
                      )}
                    </div>
                  </div>
                ))}

                {streamText !== null ? (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-lg border border-line-soft bg-ink-850 px-4 py-3 text-[13px]">
                      {streamText ? (
                        <Markdown text={streamText} />
                      ) : (
                        <span className="text-bone-faint">模型正在想…</span>
                      )}
                      <span className="lamp-live ml-1 inline-block size-1.5 rounded-full bg-amber text-amber" />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {failure ? (
            <div className="px-5 pb-3">
              <FailureNote status={failure.kind} message={failure.message} detail={failure.detail} />
            </div>
          ) : null}

          {/* ── 输入区 ── */}
          <div className="border-t border-line-soft px-4 py-3.5">
            <PromptBox
              value={input}
              onChange={setInput}
              packs={packs}
              packIds={packIds}
              onPackIdsChange={setPackIds}
              onPolish={() => void polish()}
              polishing={polishing}
              rows={3}
              disabled={sending}
            />
            <div className="mt-2.5 flex items-center gap-2">
              <span className="mono text-[10.5px] text-bone-faint">
                {override !== null ? '原始请求接管中' : 'Enter 换行 · 点发送发出'}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {sending ? (
                  <Button danger icon={<Square size={14} />} onClick={() => abortRef.current?.abort()}>
                    停止
                  </Button>
                ) : null}
                <Button
                  type="primary"
                  icon={<Send size={14} />}
                  loading={sending}
                  disabled={!input.trim() || (override !== null && overrideBody === undefined)}
                  onClick={() => void send()}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── 请求设置抽屉：表单 + 原始请求面板 ── */}
      <Drawer
        title="请求设置"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={560}
        styles={{ body: { background: '#100e0c' }, header: { background: '#16130f' } }}
      >
        <div className={override !== null ? 'form-locked' : undefined}>
          <div className="mb-4">
            <div className="mb-1.5 text-[12.5px] text-bone-dim">系统指令（system）</div>
            <Input.TextArea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="留空则不发 system 消息"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="mb-1.5 text-[12.5px] text-bone-dim">temperature</div>
              <InputNumber
                className="!w-full"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(v) => setTemperature(v)}
                placeholder="默认"
              />
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] text-bone-dim">top_p</div>
              <InputNumber
                className="!w-full"
                min={0}
                max={1}
                step={0.05}
                value={topP}
                onChange={(v) => setTopP(v)}
                placeholder="默认"
              />
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] text-bone-dim">max_tokens</div>
              <InputNumber
                className="!w-full"
                min={1}
                max={128000}
                value={maxTokens}
                onChange={(v) => setMaxTokens(v)}
                placeholder="默认"
              />
            </div>
          </div>
          <p className="mt-2 text-[11.5px] text-bone-faint">留空的参数不会出现在请求里，用供应商自己的默认值。</p>
        </div>

        <div className="mt-5">
          <RawRequestPanel formJson={formJson} override={override} onOverride={setOverride} />
        </div>
      </Drawer>
    </>
  );
}