'use client';

import { App } from 'antd';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '~/lib/client/api';
import { postSse, readSse } from '~/lib/client/sse';
import type { FailureKind } from '~/lib/errors';
import type { PublicWork } from '~/lib/works/public';

/**
 * 生图 / 超分的任务队列。
 *
 * 为什么要有这一层：
 *  1. 任务状态原本放在页面组件里，切页就丢；提到这里跨页面保留。
 *  2. 加队列是为了批处理——一次丢 N 张进去，不用守着电脑一张张点。
 *
 * 并发恒为 1：服务端 GPU_LOCK 只有一块卡，前端多开只会让请求堆积，
 * 后面的任务还没开始算就把 360 秒超时耗光。所以这里严格串行。
 */

export interface Failure {
  kind: FailureKind;
  message: string;
  detail?: string;
}

export interface ImageJobPayload {
  providerId: string;
  modelId: string;
  mode: 'generate' | 'edit';
  prompt: string;
  packIds: string[];
  n: number;
  size?: string;
  quality?: string;
  background?: string;
  style?: string;
  complexity?: string;
  output_format?: string;
  output_compression?: number;
  sourceFileName?: string | null;
  sourceWorkId?: string | null;
  rawOverride?: Record<string, unknown> | null;
}

export interface UpscalePayload {
  providerId: string;
  sourceWorkId: string | null;
  sourceFileName: string | null;
  targetEdge: number;
}

export type TaskKind = 'image' | 'upscale';
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

export interface QueueTask {
  id: string;
  kind: TaskKind;
  /** 队列里显示的一行说明 */
  label: string;
  status: TaskStatus;
  works: PublicWork[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

type NewTask =
  | { kind: 'image'; label: string; payload: ImageJobPayload }
  | { kind: 'upscale'; label: string; payload: UpscalePayload };

interface QueueValue {
  tasks: QueueTask[];
  /** 当前正在跑的任务（没有就是 null） */
  current: QueueTask | null;
  generating: boolean;
  /** 当前任务的半成品 */
  partials: Record<number, string>;
  /** 当前任务产出的图，兼容原来「本次结果」的展示 */
  works: PublicWork[];
  failure: Failure | null;
  startedAt: number | null;
  /** 兼容旧调用：入队一个生图任务 */
  start: (payload: ImageJobPayload) => Promise<void>;
  enqueueUpscale: (payload: UpscalePayload, label?: string) => void;
  stop: () => void;
  cancel: (taskId: string) => void;
  clearDone: () => void;
  clearFailure: () => void;
  removeWork: (id: string) => Promise<void>;
}

const QueueContext = createContext<QueueValue | null>(null);

export function useImageJob(): QueueValue {
  const value = useContext(QueueContext);
  if (!value) throw new Error('useImageJob 必须在 ImageJobProvider 内使用');
  return value;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `t${Date.now().toString(36)}${seq}`;
}

export function ImageJobProvider({ children }: { children: ReactNode }) {
  const { message: toast } = App.useApp();
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [partials, setPartials] = useState<Record<number, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // 用 ref 存 payload：任务对象进 state 后不再带 payload，避免大对象常驻
  const payloads = useRef(new Map<string, NewTask['payload']>());
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const patch = useCallback((id: string, next: Partial<QueueTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...next } : t)));
  }, []);

  const runTask = useCallback(
    async (task: QueueTask) => {
      const payload = payloads.current.get(task.id);
      if (!payload) {
        patch(task.id, { status: 'failed', error: '任务数据丢失' });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setFailure(null);
      setPartials({});
      setStartedAt(Date.now());
      patch(task.id, { status: 'running', startedAt: Date.now() });

      try {
        if (task.kind === 'image') {
          const res = await postSse('/api/images', payload as ImageJobPayload, controller.signal);
          const collected: PublicWork[] = [];
          for await (const ev of readSse(res)) {
            const data = ev.data as Record<string, unknown>;
            if (ev.event === 'partial') {
              const url = `data:image/${(data.format as string) ?? 'png'};base64,${data.b64 as string}`;
              setPartials((prev) => ({ ...prev, [data.index as number]: url }));
            } else if (ev.event === 'work') {
              const work = data.work as PublicWork;
              collected.push(work);
              setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, works: [...t.works, work] } : t)));
              setPartials((prev) => {
                const keys = Object.keys(prev)
                  .map(Number)
                  .sort((a, b) => a - b);
                if (keys.length === 0) return prev;
                const next = { ...prev };
                delete next[keys[0]];
                return next;
              });
            } else if (ev.event === 'error') {
              throw Object.assign(new Error((data.message as string) ?? '生成失败'), {
                kind: data.kind as FailureKind,
                detail: data.detail as string | undefined,
              });
            }
          }
          if (collected.length === 0) throw new Error('一张图都没返回');
          toast.success(`出图完成，${collected.length} 张已存进作品库`);
          patch(task.id, { status: 'done', finishedAt: Date.now() });
        } else {
          const out = await api.post<{ work: PublicWork; width: number; height: number }>(
            '/api/upscale',
            payload as UpscalePayload,
          );
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, works: [out.work] } : t)),
          );
          toast.success(`超分完成 ${out.width}×${out.height}`);
          patch(task.id, { status: 'done', finishedAt: Date.now() });
        }
      } catch (err) {
        if (controller.signal.aborted) {
          patch(task.id, { status: 'canceled', finishedAt: Date.now() });
          toast.info('已取消当前任务');
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const kind = (err as { kind?: FailureKind }).kind ?? 'error';
          const detail = (err as { detail?: string }).detail;
          setFailure({ kind, message, detail });
          patch(task.id, { status: 'failed', error: message, finishedAt: Date.now() });
          toast.error(`任务失败：${message}`);
        }
      } finally {
        setPartials({});
        setStartedAt(null);
        abortRef.current = null;
        payloads.current.delete(task.id);
      }
    },
    [patch, toast],
  );

  // 调度器：一次只跑一个，跑完自动取下一个
  useEffect(() => {
    if (busyRef.current) return;
    const next = tasks.find((t) => t.status === 'pending');
    if (!next) return;
    busyRef.current = true;
    void runTask(next).finally(() => {
      busyRef.current = false;
      // 用 setTasks 触发一次重渲染，让调度器看到下一条
      setTasks((prev) => [...prev]);
    });
  }, [tasks, runTask]);

  const enqueue = useCallback((task: NewTask) => {
    const row: QueueTask = {
      id: nextId(),
      kind: task.kind,
      label: task.label,
      status: 'pending',
      works: [],
      createdAt: Date.now(),
    };
    payloads.current.set(row.id, task.payload);
    setTasks((prev) => [...prev, row]);
  }, []);

  const start = useCallback(
    async (payload: ImageJobPayload) => {
      const label = payload.prompt.trim().slice(0, 40) || '(无提示词)';
      enqueue({ kind: 'image', label, payload });
    },
    [enqueue],
  );

  const enqueueUpscale = useCallback(
    (payload: UpscalePayload, label?: string) => {
      enqueue({
        kind: 'upscale',
        label: label ?? `超分到 ${payload.targetEdge}px`,
        payload,
      });
    },
    [enqueue],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const cancel = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      if (task.status === 'running') {
        abortRef.current?.abort();
        return;
      }
      if (task.status === 'pending') {
        payloads.current.delete(taskId);
        patch(taskId, { status: 'canceled', finishedAt: Date.now() });
      }
    },
    [tasks, patch],
  );

  const clearDone = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'pending' || t.status === 'running'));
  }, []);

  const clearFailure = useCallback(() => setFailure(null), []);

  const removeWork = useCallback(
    async (id: string) => {
      try {
        await api.del(`/api/works/${id}`);
        setTasks((prev) =>
          prev.map((t) => ({ ...t, works: t.works.filter((w) => w.id !== id) })),
        );
      } catch (err) {
        if (err instanceof ApiError) toast.error(err.message);
      }
    },
    [toast],
  );

  const current = tasks.find((t) => t.status === 'running') ?? null;
  const generating = current !== null;

  // 展示用的结果：有任务在跑就显示它的产物；跑完了则保留最近一次完成的结果，
  // 否则任务一结束 current 变 null，界面会立刻退回「这里会出现生成的图」空状态。
  const lastFinished = [...tasks]
    .reverse()
    .find((t) => t.kind === 'image' && t.status === 'done' && t.works.length > 0);
  const displayWorks = current?.works.length ? current.works : (lastFinished?.works ?? []);

  const value = useMemo<QueueValue>(
    () => ({
      tasks,
      current,
      generating,
      partials,
      works: displayWorks,
      failure,
      startedAt,
      start,
      enqueueUpscale,
      stop,
      cancel,
      clearDone,
      clearFailure,
      removeWork,
    }),
    [
      tasks,
      current,
      generating,
      partials,
      failure,
      startedAt,
      start,
      enqueueUpscale,
      stop,
      cancel,
      clearDone,
      clearFailure,
      removeWork,
    ],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
