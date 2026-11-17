'use client';

import { App, Button, Empty, Form, Input, Modal, Popconfirm, Segmented, Select, Table, Tag } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, ApiError } from '~/lib/client/api';
import { KIND_LABEL, type ModelKind } from '~/lib/providers/classify';
import type { ModelRow } from '~/lib/providers/types';

const KIND_ORDER: ModelKind[] = ['chat', 'image', 'video', 'other'];

const SOURCE_LABEL: Record<ModelRow['kind_source'], { text: string; color: string }> = {
  provider: { text: '供应商给的', color: '#7fa8d9' },
  guess: { text: '按名字猜的', color: '#a79c8c' },
  manual: { text: '你手工指定', color: '#e0a458' },
};

interface AddValues {
  model_id: string;
  kind: ModelKind;
}

// 模型清单：按用途分组筛选，每行都能手工改用途。
// 手工改过的行会标成"你手工指定"，并且之后体检不会再覆盖它。
// 还能手填模型 ID 直接加进来 —— 给没有模型列表接口的供应商兜底。
export default function ModelTable({
  providerId,
  models,
  onModelsChange,
  onKindChange,
  changing,
}: {
  providerId: string;
  models: ModelRow[];
  onModelsChange: (rows: ModelRow[]) => void;
  onKindChange: (modelId: string, kind: ModelKind) => void;
  changing: string | null;
}) {
  const { message } = App.useApp();
  const [filter, setFilter] = useState<ModelKind | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [form] = Form.useForm<AddValues>();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: models.length };
    for (const k of KIND_ORDER) c[k] = models.filter((m) => m.kind === k).length;
    return c;
  }, [models]);

  const rows = useMemo(
    () => (filter === 'all' ? models : models.filter((m) => m.kind === filter)),
    [models, filter],
  );

  async function add() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const { models: fresh } = await api.post<{ models: ModelRow[] }>(`/api/providers/${providerId}/models`, values);
      onModelsChange(fresh);
      message.success(`已加入 ${values.model_id}`);
      setAddOpen(false);
      form.resetFields();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(modelId: string) {
    setRemoving(modelId);
    try {
      const { models: fresh } = await api.del<{ models: ModelRow[] }>(
        `/api/providers/${providerId}/models?model_id=${encodeURIComponent(modelId)}`,
      );
      onModelsChange(fresh);
      message.success(`已移除 ${modelId}`);
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
    } finally {
      setRemoving(null);
    }
  }

  const addButton = (
    <Button size="small" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
      手工加模型
    </Button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {models.length > 0 ? (
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as ModelKind | 'all')}
            options={[
              { value: 'all', label: `全部 ${counts.all}` },
              ...KIND_ORDER.map((k) => ({ value: k, label: `${KIND_LABEL[k]} ${counts[k]}` })),
            ]}
          />
        ) : (
          <span className="text-[12px] text-bone-faint">
            还没有模型清单。体检能拿到列表就用体检，拿不到就在这儿手填模型 ID。
          </span>
        )}
        <div className="ml-auto">{addButton}</div>
      </div>

      {models.length === 0 ? null : (
        <Table<ModelRow>
          dataSource={rows}
          rowKey="model_id"
          size="small"
          pagination={rows.length > 12 ? { pageSize: 12, size: 'small', showSizeChanger: false } : false}
          columns={[
            {
              title: '模型 ID',
              dataIndex: 'model_id',
              render: (v: string) => <span className="mono text-[12px] text-bone">{v}</span>,
            },
            {
              title: '显示名',
              dataIndex: 'display_name',
              width: 160,
              render: (v: string | null) => <span className="text-bone-dim">{v ?? '—'}</span>,
            },
            {
              title: '归属',
              dataIndex: 'owned_by',
              width: 110,
              render: (v: string | null) => <span className="mono text-[11px] text-bone-faint">{v ?? '—'}</span>,
            },
            {
              title: '用途',
              dataIndex: 'kind',
              width: 104,
              render: (kind: ModelKind, row) => (
                <Select<ModelKind>
                  size="small"
                  value={kind}
                  loading={changing === row.model_id}
                  disabled={changing === row.model_id}
                  onChange={(v) => onKindChange(row.model_id, v)}
                  options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                  style={{ width: 84 }}
                />
              ),
            },
            {
              title: '判定来源',
              dataIndex: 'kind_source',
              width: 112,
              render: (s: ModelRow['kind_source']) => (
                <Tag variant="filled" style={{ color: SOURCE_LABEL[s].color, background: `${SOURCE_LABEL[s].color}14` }}>
                  {SOURCE_LABEL[s].text}
                </Tag>
              ),
            },
            {
              title: '',
              width: 44,
              render: (_: unknown, row) => (
                <Popconfirm
                  title={`移除 ${row.model_id}？`}
                  description="只从这份清单里去掉，不影响供应商那边。下次体检如果接口还返回它，会再出现。"
                  okText="移除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove(row.model_id)}
                >
                  <Button size="small" type="text" danger loading={removing === row.model_id} icon={<Trash2 size={13} />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      )}

      <Modal
        open={addOpen}
        title="手工加模型"
        onCancel={() => setAddOpen(false)}
        onOk={add}
        okText={saving ? '正在保存…' : '加入'}
        cancelText="取消"
        confirmLoading={saving}
        mask={{ closable: !saving, blur: true }}
        keyboard={!saving}
        width={480}
        destroyOnHidden
      >
        <p className="mb-4 text-[12.5px] leading-relaxed text-bone-dim">
          供应商的模型列表接口拿不到清单时，直接把模型 ID 填进来就能用。这样加的行归你所有，之后体检不会改它的用途，也不会把它删掉。
        </p>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: 'chat' }}>
          <Form.Item
            name="model_id"
            label="模型 ID"
            rules={[{ required: true, message: '要填模型 ID' }]}
            extra="必须和供应商要求的完全一致，包括大小写和斜杠。"
          >
            <Input placeholder="例如 gpt-4o-mini" className="mono" autoFocus />
          </Form.Item>
          <Form.Item name="kind" label="用途">
            <Select options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
