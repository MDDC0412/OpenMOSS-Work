'use client';

import { App, Button, Popconfirm, Tag, Tooltip } from 'antd';
import { ChevronDown, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { StatusDot, statusMeta } from '~/components/CheckStatus';
import FailureNote from '~/components/FailureNote';
import { api, ApiError } from '~/lib/client/api';
import type { ModelKind } from '~/lib/providers/classify';
import type { CheckResult, ModelRow, ProviderPublic } from '~/lib/providers/types';
import ModelTable from './ModelTable';

const GATEWAY_LABEL: Record<string, string> = { auto: '自动识别', string: 'String AI', newapi: 'New API' };

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 一家供应商一张卡片：连接信息、体检结论、模型清单三段。
// 模型清单懒加载，只有展开时才请求，避免首屏为每家供应商都拉一遍全量模型。
export default function ProviderCard({
  provider,
  freshCheck,
  onEdit,
  onDeleted,
  onChecked,
}: {
  provider: ProviderPublic;
  freshCheck: CheckResult | null;
  onEdit: () => void;
  onDeleted: () => void;
  onChecked: (provider: ProviderPublic, check: CheckResult) => void;
}) {
  const { message } = App.useApp();
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [localCheck, setLocalCheck] = useState<CheckResult | null>(null);

  // 刚体检完的结果优先于数据库里的旧状态，这样点完按钮立刻能看到结论
  const check = localCheck ?? freshCheck;
  const status = check ? check.status : provider.last_check_status;
  const meta = statusMeta(status);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const { models: rows } = await api.get<{ models: ModelRow[] }>(`/api/providers/${provider.id}/models`);
      setModels(rows);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setLoadingModels(false);
    }
  }, [provider.id, message]);

  // 展开时拉一次；体检成功把模型数刷新后也要重拉，否则清单还是旧的
  useEffect(() => {
    if (expanded) void loadModels();
  }, [expanded, loadModels, provider.model_count]);

  async function runCheck() {
    setChecking(true);
    try {
      const res = await api.post<{ check: CheckResult; provider: ProviderPublic }>(
        `/api/providers/${provider.id}/check`,
      );
      setLocalCheck(res.check);
      onChecked(res.provider, res.check);
      if (res.check.status === 'ok') {
        message.success(res.check.message);
        // 体检通过顺手展开清单，用户下一步就是要挑模型
        setExpanded(true);
      }
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/providers/${provider.id}`);
      message.success(`已删除「${provider.name}」，会话和作品保留`);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    }
  }

  async function changeKind(modelId: string, kind: ModelKind) {
    setChanging(modelId);
    try {
      const { models: rows } = await api.patch<{ models: ModelRow[] }>(`/api/providers/${provider.id}/models`, {
        model_id: modelId,
        kind,
      });
      setModels(rows);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setChanging(null);
    }
  }

  return (
    <section className="panel rise overflow-hidden">
      {/* ── 卡头：状态灯 + 名字 + 动作 ── */}
      <div className="flex items-start gap-4 px-5 pt-4.5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={status} pending={checking} size={9} />
            <h2 className="display text-[18px] leading-none text-bone">{provider.name}</h2>
            <Tag variant="filled" className="mono !text-[10px]">
              {GATEWAY_LABEL[provider.gateway_hint] ?? provider.gateway_hint}
            </Tag>
            <span className="text-[11.5px]" style={{ color: meta.color }}>
              {checking ? '正在体检…' : meta.label}
            </span>
          </div>
          <div className="mono mt-2 truncate text-[11.5px] text-bone-faint" title={provider.base_url}>
            {provider.base_url}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="small" icon={<RefreshCw size={13} />} loading={checking} onClick={runCheck}>
            体检
          </Button>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<Pencil size={14} />} onClick={onEdit} />
          </Tooltip>
          <Popconfirm
            title={`删除「${provider.name}」？`}
            description="只删这条接入配置和它的模型清单，已有的会话与作品会保留。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={remove}
          >
            <Tooltip title="删除">
              <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
            </Tooltip>
          </Popconfirm>
        </div>
      </div>

      {/* ── 三项关键读数：密钥打码、模型数、上次体检 ── */}
      <div className="grid grid-cols-3 gap-px border-y border-line-soft bg-line-soft">
        {[
          { k: 'API KEY', v: provider.api_key_masked || '（空）' },
          { k: '可用模型', v: `${provider.model_count} 个` },
          {
            k: '上次体检',
            v: `${formatTime(provider.last_check_at)}${
              provider.last_check_latency_ms != null ? ` · ${provider.last_check_latency_ms}ms` : ''
            }`,
          },
        ].map((cell) => (
          <div key={cell.k} className="bg-ink-850 px-5 py-3">
            <div className="eyebrow">{cell.k}</div>
            <div className="mono mt-1 truncate text-[12px] text-bone-dim" title={cell.v}>
              {cell.v}
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-4">
        {/* 体检结论：成功只显示一句绿字，失败给出可操作的人话 + 原文。
            判断依据是 status 而不是 check：首次进页面没有 freshCheck，
            但数据库里存着上次的失败状态，同样要按失败渲染。 */}
        {status && status !== 'ok' ? (
          <FailureNote
            status={status}
            message={check?.message ?? provider.last_check_message ?? meta.label}
            detail={check?.detail}
            httpStatus={check?.httpStatus}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className={status === 'ok' ? 'text-jade' : 'text-bone-faint'}>
              {check?.message ?? provider.last_check_message ?? '还没体检过'}
            </span>
          </div>
        )}

        <div className="mono mt-2.5 text-[10.5px] break-all text-bone-faint">
          GET {check?.modelsUrl ?? provider.models_url_resolved}
        </div>

        {/* ── 模型清单折叠区 ── */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 flex w-full items-center gap-2 border-t border-line-soft pt-3.5 text-[12.5px] text-bone-dim transition-colors hover:text-amber-bright"
        >
          <ChevronDown size={14} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
          模型清单
          <span className="mono text-[11px] text-bone-faint">{provider.model_count}</span>
          <span className="ml-auto text-[11px] text-bone-faint">用途可以手工改，改完不会被下次体检覆盖</span>
        </button>

        {expanded ? (
          <div className="pt-4">
            {loadingModels && models.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-bone-faint">正在读取模型清单…</div>
            ) : (
              <ModelTable
                providerId={provider.id}
                models={models}
                onModelsChange={setModels}
                onKindChange={changeKind}
                changing={changing}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}