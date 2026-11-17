import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../providers/types';
import { readEditSource } from './run';
import { readGenerated, readUpload } from '../works/files';
import { getWork } from '../works/repo';

// 只测来源解析，不碰真库真盘：repo 与文件读写全部 mock。
vi.mock('../works/repo', () => ({
  getWork: vi.fn(),
  insertWork: vi.fn(),
  newId: vi.fn(() => 'id'),
}));
vi.mock('../works/files', () => ({
  readGenerated: vi.fn(),
  readUpload: vi.fn(),
  saveGenerated: vi.fn(),
  sniffMime: vi.fn(() => ({ mime: 'image/png', ext: 'png' })),
}));

const base = {
  provider: {} as ProviderRow,
  modelId: 'm1',
  mode: 'edit' as const,
  prompt: 'x',
  n: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readEditSource', () => {
  it('作品引用：读作品文件，不碰上传目录', async () => {
    vi.mocked(getWork).mockReturnValue({ file_name: 'w9.png' } as ReturnType<typeof getWork>);
    vi.mocked(readGenerated).mockResolvedValue(new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>);
    const { buf, name } = await readEditSource({ ...base, sourceWorkId: 'w9' });
    expect(name).toBe('w9.png');
    expect(buf).toEqual(new Uint8Array([1, 2, 3]));
    expect(readGenerated).toHaveBeenCalledWith('w9.png');
    expect(readUpload).not.toHaveBeenCalled();
  });

  it('作品已被删：明确报错而不是静默回退', async () => {
    vi.mocked(getWork).mockReturnValue(null);
    await expect(readEditSource({ ...base, sourceWorkId: 'gone' })).rejects.toThrow('作品库');
    expect(readGenerated).not.toHaveBeenCalled();
    expect(readUpload).not.toHaveBeenCalled();
  });

  it('上传来源：读上传目录，不碰作品库', async () => {
    vi.mocked(readUpload).mockResolvedValue(new Uint8Array([4]) as Uint8Array<ArrayBuffer>);
    const { name } = await readEditSource({ ...base, sourceFileName: 'u1.png' });
    expect(name).toBe('u1.png');
    expect(readUpload).toHaveBeenCalledWith('u1.png');
    expect(getWork).not.toHaveBeenCalled();
  });

  it('两个来源都没有：报错提示先给原图', async () => {
    await expect(readEditSource(base)).rejects.toThrow('原图');
  });
});