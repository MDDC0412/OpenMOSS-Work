'use client';

import { App, Form, Input, Modal, Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '~/lib/client/api';
import { PROVIDER_PRESETS } from '~/lib/providers/presets';
import type { CheckResult, ProviderInput, ProviderPublic } from '~/lib/providers/types';
import { resolveModelsUrl } from '~/lib/providers/url';

interface FormValues {
  name: string;
  base_url: string;
  api_key: string;
  models_endpoint: string;
  gateway_hint: ProviderInput['gateway_hint'];
}

export default function ProviderForm({
  open,
  editing,
  presetKey,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ProviderPublic | null;
  presetKey: string | null;
  onClose: () => void;
  onSaved: (provider: ProviderPublic, check: CheckResult | null) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);

  // 打开时重置：新建套用预填，编辑回填除密钥外的字段。
  // 密钥故意不回填明文，留空即"不改"，这样明文密钥永远不往浏览器回传。
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        base_url: editing.base_url,
        api_key: '',
        models_endpoint: editing.models_endpoint,
        gateway_hint: editing.gateway_hint,
      });
    } else {
      const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey);
      form.setFieldsValue({
        name: preset?.name ?? '',
        base_url: preset?.base_url ?? '',
        api_key: '',
        models_endpoint: preset?.models_endpoint ?? '/v1/models',
        gateway_hint: preset?.gateway_hint ?? 'auto',
      });
    }
  }, [open, editing, presetKey, form]);

  // 实时回显真正会请求的地址：用户填 /v1/models 还是 models，结果不同，看得见才不用猜
  const baseUrl = Form.useWatch('base_url', form) ?? '';
  const endpoint = Form.useWatch('models_endpoint', form) ?? '';
  const resolved = useMemo(() => {
    if (!baseUrl || !endpoint) return '';
    try {
      return resolveModelsUrl(baseUrl, endpoint);
    } catch {
      return '地址还不合法，补全 Base URL 后再看';
    }
  }, [baseUrl, endpoint]);

  async function submit() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        const { provider } = await api.patch<{ provider: ProviderPublic }>(`/api/providers/${editing.id}`, values);
        // 改完连接信息立刻体检一次，用户不用再去卡片上点按钮
        const { check, provider: fresh } = await api.post<{ check: CheckResult; provider: ProviderPublic }>(
          `/api/providers/${provider.id}/check`,
        );
        onSaved(fresh, check);
      } else {
        const { provider, check } = await api.post<{ provider: ProviderPublic; check: CheckResult }>(
          '/api/providers',
          values,
        );
        onSaved(provider, check);
      }
    } catch (err) {
      // 校验失败（validateFields 抛出）没有 message 字段，交给表单自己显示红字
      if (err instanceof ApiError) message.error(err.message);
      else if (err instanceof Error && err.message) message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? `编辑「${editing.name}」` : '添加供应商'}
      onCancel={onClose}
      onOk={submit}
      okText={submitting ? '正在体检…' : editing ? '保存并体检' : '添加并体检'}
      cancelText="取消"
      confirmLoading={submitting}
      // 体检最长 20 秒，期间不允许点遮罩关掉，否则请求还在跑但界面已经没了。
      // antd 6 用 mask.closable 取代了旧的 maskClosable；blur 让遮罩带一点磨砂，和暗色面板更搭。
      mask={{ closable: !submitting, blur: true }}
      keyboard={!submitting}
      width={620}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
        {!editing ? (
          <div className="mb-5 flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() =>
                  form.setFieldsValue({
                    name: p.name,
                    base_url: p.base_url,
                    models_endpoint: p.models_endpoint,
                    gateway_hint: p.gateway_hint,
                  })
                }
                className="mono rounded-md border border-line bg-ink-800 px-2.5 py-1 text-[11px] text-bone-dim transition-colors hover:border-amber/45 hover:text-amber-bright"
                title={p.note}
              >
                预填 {p.name}
              </button>
            ))}
          </div>
        ) : null}

        <Form.Item name="name" label="名字" rules={[{ required: true, message: '给这家供应商起个名字' }]}>
          <Input placeholder="例如 String AI" maxLength={60} />
        </Form.Item>

        <Form.Item
          name="base_url"
          label="Base URL"
          rules={[{ required: true, message: '要填 Base URL' }]}
          extra="调用用的根地址，通常以 /v1 结尾。末尾多余的斜杠会自动去掉。"
        >
          <Input placeholder="https://www.string.ink/v1" className="mono" />
        </Form.Item>

        <Form.Item
          name="api_key"
          label="API Key"
          rules={editing ? [] : [{ required: true, message: '要填 API Key' }]}
          extra={
            editing
              ? `当前密钥 ${editing.api_key_masked} —— 留空表示不改，要换新的才填。`
              : '明文保存在本机项目目录之外，界面上永远只显示打码后的样子。'
          }
        >
          <Input.Password placeholder={editing ? '留空 = 不修改' : 'sk-…'} autoComplete="off" className="mono" />
        </Form.Item>

        <Form.Item
          name="models_endpoint"
          label="模型列表接口地址"
          extra="体检就打这个地址。可以填绝对网址、以 / 开头的路径，或接在 Base URL 后面的相对路径。留空表示这家供应商没有这个接口，模型全靠手工加。"
        >
          <Input placeholder="/v1/models（没有就留空）" className="mono" />
        </Form.Item>

        {/* 解析结果常驻显示，这是"到底会打哪儿"的唯一真值 */}
        <div className="-mt-2 mb-5 rounded-md border border-line-soft bg-ink-950 px-3 py-2">
          <div className="eyebrow pb-1">实际请求地址</div>
          <div className="mono text-[11.5px] break-all text-amber-bright">
            {!endpoint.trim() ? '留空了，不请求模型列表；模型请在卡片里手工添加' : resolved || '填完上面两项后显示'}
          </div>
        </div>

        <Form.Item
          name="gateway_hint"
          label="网关类型"
          extra="只影响报错怎么解读。两家都走 OpenAI 标准路径，选自动识别通常就够。"
        >
          <Select
            options={[
              { value: 'auto', label: '自动识别' },
              { value: 'string', label: 'String AI（扁平报错）' },
              { value: 'newapi', label: 'New API（error 外壳）' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}