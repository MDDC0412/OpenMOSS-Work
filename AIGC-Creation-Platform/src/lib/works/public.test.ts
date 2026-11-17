import { describe, expect, it } from 'vitest';
import { toPublicWork } from './public';
import type { WorkListItem } from './repo';

// source_url 有两种引用：上传目录文件名、work:<id> 指向作品库。
// 解析错会让改图详情里的原图 404，所以两种前缀和空值都要钉死。
function row(over: Partial<WorkListItem> = {}): WorkListItem {
  return {
    id: 'w1',
    provider_id: 'p1',
    model_id: 'm1',
    kind: 'image',
    prompt: '',
    params: '{}',
    file_name: 'w1.png',
    mime_type: 'image/png',
    bytes: 1,
    source_image: null,
    created_at: 0,
    provider_name: null,
    ...over,
  };
}

describe('toPublicWork source_url', () => {
  it('没有原图时 source_url 为 null', () => {
    expect(toPublicWork(row()).source_url).toBeNull();
  });

  it('上传文件名走 /api/uploads', () => {
    expect(toPublicWork(row({ source_image: 'u-123.png' })).source_url).toBe('/api/uploads/u-123.png');
  });

  it('work: 前缀走作品取图口，不带前缀残留', () => {
    expect(toPublicWork(row({ source_image: 'work:abc' })).source_url).toBe('/api/works/abc/file');
  });

  it('file_url 始终指向自己的取图口', () => {
    expect(toPublicWork(row({ source_image: 'work:abc' })).file_url).toBe('/api/works/w1/file');
  });
});