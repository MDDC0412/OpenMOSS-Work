import type { WorkListItem } from './repo';

export interface PublicWork {
  id: string;
  provider_id: string;
  provider_name: string | null;
  model_id: string;
  kind: 'image';
  prompt: string;
  params: Record<string, unknown>;
  file_name: string;
  mime_type: string;
  bytes: number | null;
  source_image: string | null;
  created_at: number;
  file_url: string;
  source_url: string | null;
}

// params 在库里存的是 JSON 字符串，出到界面时解开成对象；
// 文件只给本服务的取图地址，不把本机绝对路径暴露到浏览器。
export function toPublicWork(row: WorkListItem): PublicWork {
  return {
    id: row.id,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    model_id: row.model_id,
    kind: row.kind,
    prompt: row.prompt,
    params: JSON.parse(row.params) as Record<string, unknown>,
    file_name: row.file_name,
    mime_type: row.mime_type,
    bytes: row.bytes,
    source_image: row.source_image,
    created_at: row.created_at,
    file_url: `/api/works/${row.id}/file`,
    // 原图引用两种：上传目录文件名，或 work:<id> 指向作品库（改图选了作品当原图）
    source_url: row.source_image
      ? row.source_image.startsWith('work:')
        ? `/api/works/${row.source_image.slice(5)}/file`
        : `/api/uploads/${row.source_image}`
      : null,
  };
}