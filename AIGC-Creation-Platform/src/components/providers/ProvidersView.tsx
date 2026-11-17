'use client';

import { App, Button, Spin } from 'antd';
import { Plus, Server } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '~/components/PageHeader';
import { api, ApiError } from '~/lib/client/api';
import { PROVIDER_PRESETS } from '~/lib/providers/presets';
import type { CheckResult, ProviderPublic } from '~/lib/providers/types';
import ProviderCard from './ProviderCard';
import ProviderForm from './ProviderForm';

export default function ProvidersView() {
  const { message } = App.useApp();
  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderPublic | null>(null);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  // 刚体检完的结果按 id 暂存，卡片优先显示它而不是列表里的旧状态
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});

  const load = useCallback(async () => {
    try {
      const { providers: rows } = await api.get<{ providers: ProviderPublic[] }>('/api/providers');
      setProviders(rows);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(preset: string | null = null) {
    setEditing(null);
    setPresetKey(preset);
    setFormOpen(true);
  }

  function openEdit(p: ProviderPublic) {
    setEditing(p);
    setPresetKey(null);
    setFormOpen(true);
  }

  async function onSaved(provider: ProviderPublic, check: CheckResult | null) {
    setFormOpen(false);
    if (check) setChecks((m) => ({ ...m, [provider.id]: check }));
    await load();
    if (check) {
      if (check.status === 'ok') message.success(check.message);
      else message.warning(check.message);
    } else {
      message.success('已保存');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Providers · 接入"
        title="供应商"
        description="一条记录就是一家供应商：填地址、密钥和模型列表接口。体检会用这个接口验证密钥与连通性，通过后自动列出这把密钥能用的模型，并按对话／图片／视频分好类。"
        actions={
          <Button type="primary" icon={<Plus size={15} />} onClick={() => openCreate()}>
            添加供应商
          </Button>
        }
      />

      {loading ? (
        <div className="panel grid place-items-center py-20">
          <Spin />
        </div>
      ) : providers.length === 0 ? (
        /* 空状态直接给两家已核实供应商的预填入口，用户只需粘密钥 */
        <div className="panel rise px-8 py-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border border-line bg-ink-800">
            <Server size={20} className="text-bone-faint" strokeWidth={1.5} />
          </div>
          <h2 className="display mt-4 text-[19px] text-bone">还没接入任何供应商</h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-[13px] text-bone-dim">
            选一家预填地址，然后把你自己的密钥粘进去。体检通过就能开始对话和生图。
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {PROVIDER_PRESETS.map((p) => (
              <Button key={p.key} onClick={() => openCreate(p.key)} title={p.note}>
                接入 {p.name}
              </Button>
            ))}
            <Button type="primary" icon={<Plus size={15} />} onClick={() => openCreate()}>
              自己填一家
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {providers.map((p, i) => (
            <div key={p.id} style={{ animationDelay: `${i * 60}ms` }} className="rise">
              <ProviderCard
                provider={p}
                freshCheck={checks[p.id] ?? null}
                onEdit={() => openEdit(p)}
                onDeleted={load}
                onChecked={(fresh, check) => {
                  setChecks((m) => ({ ...m, [fresh.id]: check }));
                  setProviders((rows) => rows.map((r) => (r.id === fresh.id ? fresh : r)));
                }}
              />
            </div>
          ))}
        </div>
      )}

      <ProviderForm
        open={formOpen}
        editing={editing}
        presetKey={presetKey}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
      />
    </>
  );
}