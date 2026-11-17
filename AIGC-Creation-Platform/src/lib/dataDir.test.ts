import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// 迁移逻辑会真的搬文件：把锚点指到临时目录，绝不碰用户真实数据。
// db 层只用到 closeDb，mock 掉避免测试打开真库；hoisted 让用例能控制它的行为。
const { closeDbMock } = vi.hoisted(() => ({ closeDbMock: vi.fn() }));
vi.mock('./db', () => ({ closeDb: closeDbMock }));

let root: string;
let anchor: string;
let paths: typeof import('./paths');
let dataDir: typeof import('./dataDir');

// 往锚点里塞一份假数据：库文件 + 作品 + 上传原图，模拟真实落盘结构
function seedFakeData(dir: string): void {
  fs.mkdirSync(path.join(dir, 'works'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'platform.db'), 'fake-db');
  fs.writeFileSync(path.join(dir, 'works', 'a.png'), 'fake-image');
  fs.writeFileSync(path.join(dir, 'uploads', 'b.png'), 'fake-upload');
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-datadir-test-'));
  anchor = path.join(root, 'anchor');
  fs.mkdirSync(anchor);
  // 必须在 import paths 之前设好：ANCHOR_DIR 在模块加载时就定死
  process.env.AIGC_ANCHOR_DIR = anchor;
  paths = await import('./paths');
  dataDir = await import('./dataDir');
  seedFakeData(anchor);
});

afterAll(() => {
  delete process.env.AIGC_ANCHOR_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('changeDataDir', () => {
  it('没改过时数据就在锚点目录', () => {
    expect(paths.dataRoot()).toBe(anchor);
    expect(paths.dbPath()).toBe(path.join(anchor, 'platform.db'));
  });

  it('目标文件夹非空时拒绝，数据原地不动', () => {
    const junk = path.join(root, 'junk');
    fs.mkdirSync(junk);
    fs.writeFileSync(path.join(junk, '别人的文件.txt'), 'x');
    expect(() => dataDir.changeDataDir(junk)).toThrow(/不是空的/);
    expect(paths.dataRoot()).toBe(anchor);
    expect(fs.existsSync(path.join(anchor, 'platform.db'))).toBe(true);
  });

  it('新旧目录互相嵌套时拒绝', () => {
    expect(() => dataDir.changeDataDir(path.join(anchor, 'sub'))).toThrow(/嵌套/);
    expect(paths.dataRoot()).toBe(anchor);
  });

  it('迁移后文件整体搬走，指针留在锚点', () => {
    const target = path.join(root, 'moved-1');
    const result = dataDir.changeDataDir(target);
    expect(result).toBe(target);
    expect(paths.dataRoot()).toBe(target);
    // 数据三件套都到了新目录
    expect(fs.readFileSync(path.join(target, 'platform.db'), 'utf8')).toBe('fake-db');
    expect(fs.existsSync(path.join(target, 'works', 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'uploads', 'b.png'))).toBe(true);
    // 锚点只剩指针文件，内容指向新目录
    expect(fs.readdirSync(anchor)).toEqual([paths.POINTER_NAME]);
    const pointer = JSON.parse(fs.readFileSync(path.join(anchor, paths.POINTER_NAME), 'utf8')) as { dir: string };
    expect(pointer.dir).toBe(target);
  });

  it('恢复默认目录：搬回锚点并删掉指针', () => {
    const result = dataDir.changeDataDir(anchor);
    expect(result).toBe(anchor);
    expect(paths.dataRoot()).toBe(anchor);
    expect(fs.existsSync(path.join(anchor, paths.POINTER_NAME))).toBe(false);
    expect(fs.readFileSync(path.join(anchor, 'platform.db'), 'utf8')).toBe('fake-db');
    expect(fs.existsSync(path.join(anchor, 'works', 'a.png'))).toBe(true);
  });

  it('关库时消失的 WAL 旁路文件不该让迁移失败', () => {
    // 真实 SQLite 干净关闭会删掉 -wal/-shm：让 closeDb 模拟这个行为，
    // 搬迁清单若在关库前读取就会撞上 ENOENT（线上实发过的缺陷）
    fs.writeFileSync(path.join(anchor, 'platform.db-shm'), 'sidecar');
    fs.writeFileSync(path.join(anchor, 'platform.db-wal'), 'sidecar');
    closeDbMock.mockImplementationOnce(() => {
      fs.rmSync(path.join(anchor, 'platform.db-shm'), { force: true });
      fs.rmSync(path.join(anchor, 'platform.db-wal'), { force: true });
    });
    const target = path.join(root, 'moved-sidecar');
    expect(dataDir.changeDataDir(target)).toBe(target);
    expect(fs.readFileSync(path.join(target, 'platform.db'), 'utf8')).toBe('fake-db');
    expect(fs.existsSync(path.join(target, 'platform.db-shm'))).toBe(false);
    // 搬回锚点，恢复后续用例的初始状态
    expect(dataDir.changeDataDir(anchor)).toBe(anchor);
    expect(fs.existsSync(path.join(anchor, 'works', 'a.png'))).toBe(true);
  });

  it('搬到一半失败时逆序回滚，数据不丢', () => {
    const target = path.join(root, 'rollback-target');
    const realRename = fs.renameSync.bind(fs);
    let calls = 0;
    // 第一条搬成功、第二条模拟被占用：验证已搬的那条会被搬回来
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('模拟文件被占用'), { code: 'EACCES' });
      return realRename(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => dataDir.changeDataDir(target)).toThrow(/已回滚/);
    } finally {
      spy.mockRestore();
    }
    expect(paths.dataRoot()).toBe(anchor);
    expect(fs.existsSync(path.join(anchor, 'platform.db'))).toBe(true);
    expect(fs.existsSync(path.join(anchor, 'works', 'a.png'))).toBe(true);
    expect(fs.existsSync(path.join(anchor, paths.POINTER_NAME))).toBe(false);
  });

  it('跨盘 EXDEV 时退化为拷贝再删源', () => {
    const target = path.join(root, 'moved-2');
    const realRename = fs.renameSync.bind(fs);
    // 第一次 rename 抛 EXDEV 触发兜底，其余走真实 rename
    let first = true;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (first) {
        first = false;
        throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
      }
      return realRename(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(dataDir.changeDataDir(target)).toBe(target);
    } finally {
      spy.mockRestore();
    }
    expect(paths.dataRoot()).toBe(target);
    expect(fs.readFileSync(path.join(target, 'platform.db'), 'utf8')).toBe('fake-db');
    expect(fs.existsSync(path.join(anchor, 'platform.db'))).toBe(false);
  });

  it('rmSync 静默无效的卷上靠手工删兜底，源目录必须清空', () => {
    // 实测缺陷：某些 Windows 卷上 rmSync 不报错也不删。
    // 把数据目录上的 rmSync mock 成空操作（锚点上的指针删除照常），
    // 并让所有 rename 抛 EXDEV 强制走拷贝分支，验证兜底真的清掉源。
    const realRm = fs.rmSync.bind(fs);
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(((p: fs.PathLike, opts?: fs.RmOptions) => {
      if (String(p).endsWith(paths.POINTER_NAME)) return realRm(p, opts);
    }) as typeof fs.rmSync);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((() => {
      throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    }) as typeof fs.renameSync);
    try {
      const from = paths.dataRoot();
      const target = path.join(root, 'moved-noop');
      expect(dataDir.changeDataDir(target)).toBe(target);
      // 源目录必须被清空，不能留一份副本
      expect(fs.readdirSync(from)).toEqual([]);
      expect(fs.readFileSync(path.join(target, 'platform.db'), 'utf8')).toBe('fake-db');
      // 再搬回锚点，同样不能留副本
      expect(dataDir.changeDataDir(anchor)).toBe(anchor);
      expect(fs.readdirSync(target)).toEqual([]);
      expect(paths.dataRoot()).toBe(anchor);
      expect(fs.existsSync(path.join(anchor, 'works', 'a.png'))).toBe(true);
    } finally {
      rmSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });
});