'use client';

import { App, Button, Input, Modal } from 'antd';
import { FolderCog, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '~/lib/client/api';

interface DirInfo {
  dir: string;
  defaultDir: string;
}

// 数据目录设置弹窗：展示当前落盘位置，支持整份迁移到新目录或恢复默认。
// 迁移由后端一次性完成（含失败回滚），前端只负责收集路径、转述结果。
export default function DataDirModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [info, setInfo] = useState<DirInfo | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  // 每次打开都现拉：目录可能刚在别处改过，缓存会显示旧位置
  useEffect(() => {
    if (!open) return;
    setTarget('');
    api
      .get<DirInfo>('/api/settings/data-dir')
      .then(setInfo)
      .catch((err) => message.error(err instanceof ApiError ? err.message : String(err)));
  }, [open, message]);

  // 迁移与恢复共用一条成功路径：刷新侧栏显示、通知其他监听者、关窗
  async function submit(dir: string, successText: string) {
    setBusy(true);
    try {
      const res = await api.post<DirInfo>('/api/settings/data-dir', { dir });
      setInfo(res);
      message.success(successText);
      window.dispatchEvent(new Event('aigc-data-dir-changed'));
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="本机数据存放位置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      styles={{ body: { background: '#100e0c' }, header: { background: '#16130f' } }}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="eyebrow pb-1.5">当前目录</div>
          <div className="mono rounded-md border border-line-soft bg-ink-950 px-3 py-2 text-[11.5px] leading-relaxed break-all text-bone-dim">
            {info?.dir ?? '读取中…'}
          </div>
        </div>

        <div>
          <div className="eyebrow pb-1.5">迁移到新目录</div>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="填一个空文件夹的完整路径，例如 D:\AIGC 数据"
            spellCheck={false}
            disabled={busy}
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-bone-faint">
            数据库、作品图片、改图原图会整份搬过去；目标必须是空文件夹（或不存在）。
            中途失败会自动搬回原目录；切换后立即生效，不用重启。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="primary"
            icon={<FolderCog size={14} />}
            loading={busy}
            disabled={!target.trim()}
            onClick={() => submit(target.trim(), '数据已搬到新目录')}
          >
            迁移并切换
          </Button>
          <Button
            icon={<RotateCcw size={14} />}
            disabled={busy || !info || info.dir === info.defaultDir}
            onClick={() => submit(info!.defaultDir, '已恢复默认目录')}
          >
            恢复默认目录
          </Button>
        </div>
      </div>
    </Modal>
  );
}