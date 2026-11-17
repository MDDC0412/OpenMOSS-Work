'use client';

import { Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api, loadLastUsed, saveLastUsed } from '~/lib/client/api';
import type { ModelKind } from '~/lib/providers/classify';

export interface ModelChoice {
  providerId: string;
  modelId: string;
}

interface FlatModel {
  provider_id: string;
  provider_name: string;
  model_id: string;
  display_name: string | null;
  kind: ModelKind;
}

// 供应商 + 模型两级选择器，只列出指定用途的模型。
// 选中结果写进 preferences，下次打开同一页自动回到上次用的那家那个模型。
export default function ModelPicker({
  kind,
  prefKey,
  value,
  onChange,
  disabled,
}: {
  kind: ModelKind;
  prefKey: string;
  value: ModelChoice | null;
  onChange: (v: ModelChoice) => void;
  disabled?: boolean;
}) {
  const [all, setAll] = useState<FlatModel[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { models } = await api.get<{ models: FlatModel[] }>(`/api/models?kind=${kind}`);
        if (!alive) return;
        setAll(models);
        // 上次用的优先；它已经不在了（供应商被删/模型下线）就退到第一个候选
        const last = await loadLastUsed(prefKey);
        const usable =
          last && models.some((m) => m.provider_id === last.providerId && m.model_id === last.modelId)
            ? last
            : models[0]
              ? { providerId: models[0].provider_id, modelId: models[0].model_id }
              : null;
        if (usable) onChange(usable);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
    // onChange 由父组件用 useCallback 稳定住；这里只在用途/偏好键变化时重新初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, prefKey]);

  const providers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of all) seen.set(m.provider_id, m.provider_name);
    return [...seen.entries()].map(([id, name]) => ({ value: id, label: name }));
  }, [all]);

  const models = useMemo(
    () =>
      all
        .filter((m) => m.provider_id === value?.providerId)
        .map((m) => ({ value: m.model_id, label: m.display_name ? `${m.model_id}（${m.display_name}）` : m.model_id })),
    [all, value?.providerId],
  );

  function pick(providerId: string, modelId: string) {
    onChange({ providerId, modelId });
    void saveLastUsed(prefKey, { providerId, modelId });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        placeholder="供应商"
        loading={!ready}
        disabled={disabled || providers.length === 0}
        value={value?.providerId}
        options={providers}
        onChange={(pid) => {
          const first = all.find((m) => m.provider_id === pid);
          if (first) pick(pid, first.model_id);
        }}
        style={{ minWidth: 150 }}
        showSearch
        optionFilterProp="label"
      />
      <Select
        placeholder={providers.length === 0 ? '先去供应商页体检拉模型' : '模型'}
        loading={!ready}
        disabled={disabled || models.length === 0}
        value={value?.modelId}
        options={models}
        onChange={(mid) => value && pick(value.providerId, mid)}
        style={{ minWidth: 240, flex: 1 }}
        showSearch
        optionFilterProp="label"
      />
    </div>
  );
}