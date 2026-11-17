'use client';

import { App, Form, Input, Modal, Segmented, Upload } from 'antd';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '~/lib/client/api';
import type { PackRow } from '~/lib/packs/repo';

interface FormValues {
  name: string;
  url: string;
}

// 抓取结论：status 只有 ok/error 两种，message 是后端翻译好的人话
export interface FetchInfo {
  status: 'ok' | 'error';
  message: string;
}

// 与服务端 fetch.ts 的 MAX_BYTES 保持一致（5MB）；前端先挡一道，免得读完一个大文件才被后端拒。
// 不能直接 import 服务端那个常量——它连着 node:sqlite，会被打进浏览器包。
const MAX_BYTES = 5 * 1024 * 1024;

// 本地选中的文件：文本在浏览器就读好，提交时直接随 JSON 发给后端落库。
interface LocalFile {
  fileName: string;
  content: string;
  bytes: number;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// 提示词包的新建/编辑弹窗。两种来源：外链 URL（靠抓取）或本地文件（导入即缓存）。
// 编辑时来源锁定，不允许把外链包改成本地包或反过来，避免语义混乱。
export default function PackForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: PackRow | null;
  onClose: () => void;
  onSaved: (pack: PackRow, fetch: FetchInfo) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [source, setSource] = useState<'url' | 'local'>('url');
  const [localFile, setLocalFile] = useState<LocalFile | null>(null);

  // 打开时回填：来源跟着被编辑的包走，新建默认外链；名字与外链回填，本地待选文件清空
  useEffect(() => {
    if (!open) return;
    setSource(editing?.source ?? 'url');
    setLocalFile(null);
    form.setFieldsValue({ name: editing?.name ?? '', url: editing?.url ?? '' });
  }, [open, editing, form]);

  // 选本地文件：浏览器直接读文本，超限/空文件当场拒，名字空就用文件名兜底
  async function pickFile(file: File) {
    if (file.size > MAX_BYTES) {
      message.error(`文件太大：${formatBytes(file.size)}，超过 ${formatBytes(MAX_BYTES)} 上限`);
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      message.error('这个文件是空的，换一段有内容的文本');
      return;
    }
    const bytes = new TextEncoder().encode(text).byteLength;
    setLocalFile({ fileName: file.name, content: text, bytes });
    if (!form.getFieldValue('name')) {
      form.setFieldValue('name', file.name.replace(/\.[^.]+$/, ''));
    }
  }

  async function submit() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        if (editing.source === 'local') {
          // 本地包编辑：选了新文件就替换文本，没选就只改名
          const body: { name: string; content?: string; fileName?: string } = { name: values.name };
          if (localFile) {
            body.content = localFile.content;
            body.fileName = localFile.fileName;
          }
          const { pack } = await api.patch<{ pack: PackRow }>(`/api/packs/${editing.id}`, body);
          onSaved(pack, { status: 'ok', message: pack.fetch_message ?? '已保存' });
        } else {
          // 改外链会清掉旧缓存（见 repo.updatePack），保存后立刻重抓一次
          await api.patch(`/api/packs/${editing.id}`, { name: values.name, url: values.url });
          const { pack, fetch } = await api.post<{ pack: PackRow; fetch: FetchInfo }>(`/api/packs/${editing.id}/fetch`);
          onSaved(pack, fetch);
        }
      } else if (source === 'local') {
        if (!localFile) {
          message.error('先选一个文本文件');
          return;
        }
        const { pack, fetch } = await api.post<{ pack: PackRow; fetch: FetchInfo }>('/api/packs', {
          name: values.name,
          source: 'local',
          fileName: localFile.fileName,
          content: localFile.content,
        });
        onSaved(pack, fetch);
      } else {
        // 新建外链包：接口本身就会抓一次（见 api/packs POST）
        const { pack, fetch } = await api.post<{ pack: PackRow; fetch: FetchInfo }>('/api/packs', {
          name: values.name,
          source: 'url',
          url: values.url,
        });
        onSaved(pack, fetch);
      }
    } catch (err) {
      // 校验失败（validateFields 抛出）没有 message 字段，交给表单自己显示红字
      if (err instanceof ApiError) message.error(err.message);
      else if (err instanceof Error && err.message) message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const okText = submitting
    ? source === 'local'
      ? '正在保存…'
      : '正在抓取…'
    : editing
      ? editing.source === 'local'
        ? '保存'
        : '保存并抓取'
      : source === 'local'
        ? '导入'
        : '添加并抓取';

  return (
    <Modal
      open={open}
      title={editing ? `编辑「${editing.name}」` : '添加提示词包'}
      onCancel={onClose}
      onOk={submit}
      okText={okText}
      cancelText="取消"
      confirmLoading={submitting}
      // 抓取最长 15 秒，期间不许点遮罩关掉，否则请求还在跑但界面已经没了
      mask={{ closable: !submitting, blur: true }}
      keyboard={!submitting}
      width={560}
      destroyOnHidden
    >
      {/* 来源切换：编辑时锁定，新建可在外链与本地文件之间选 */}
      <div className="pt-2 pb-4">
        <div className="eyebrow pb-2">来源</div>
        <Segmented
          value={source}
          disabled={!!editing}
          onChange={(v) => setSource(v as 'url' | 'local')}
          options={[
            { label: '外链 URL', value: 'url' },
            { label: '本地文件', value: 'local' },
          ]}
        />
      </div>

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="name"
          label="名字"
          rules={[{ required: true, message: '给这个包起个名字' }]}
          extra="在对话或生图里 @ 的就是这个名字。"
        >
          <Input placeholder="例如 电影感运镜" maxLength={60} />
        </Form.Item>

        {source === 'url' ? (
          <Form.Item
            name="url"
            label="外链地址"
            rules={[{ required: true, message: '要填外链地址' }]}
            extra="指向一段纯文本（http/https）。发送时会把抓到的文本追加进 prompt，上限 5MB。"
          >
            <Input placeholder="https://example.com/prompt.txt" className="mono" />
          </Form.Item>
        ) : (
          <Form.Item label="本地文本文件" required extra="纯文本（.txt / .md 等），上限 5MB。导入后文本缓存到本机，@ 一下就能复用。">
            {/* 编辑本地包时先告诉用户当前用的是哪个文件 */}
            {editing?.source === 'local' && editing.file_name ? (
              <div className="mono mb-2 text-[11.5px] text-bone-faint">
                当前文件：{editing.file_name}
                {editing.content_bytes != null ? ` · ${formatBytes(editing.content_bytes)}` : ''}
              </div>
            ) : null}
            <Upload.Dragger
              accept=".txt,.md,.markdown,.text,.log,text/plain,text/markdown"
              showUploadList={false}
              // beforeUpload 返回 false 阻止自动上传：文件只在浏览器读文本，随表单 JSON 提交
              beforeUpload={(file) => {
                void pickFile(file);
                return false;
              }}
            >
              <p className="ant-upload-drag-icon">
                <FileText size={26} className="text-amber" strokeWidth={1.5} />
              </p>
              <p className="ant-upload-text text-[13px]">点选或拖入一个文本文件</p>
              <p className="ant-upload-hint text-[11.5px]">读它的文本存成提示词包，不上传到任何服务器</p>
            </Upload.Dragger>
            {localFile ? (
              <div className="mono mt-2 text-[11.5px] text-jade">
                已选：{localFile.fileName} · {formatBytes(localFile.bytes)}
                {editing ? '，保存后替换当前内容' : ''}
              </div>
            ) : null}
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}