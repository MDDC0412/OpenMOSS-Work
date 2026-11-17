import fs from 'node:fs';
import path from 'node:path';
import { closeDb } from './db';
import { ANCHOR_DIR, POINTER_NAME, dataRoot, ensureDirs, writeDataDirPointer } from './paths';

// 同盘 rename 瞬时完成；跨盘 EXDEV 时退化为「拷贝再删源」。
function moveEntry(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    removeSource(from);
  }
}

// Windows 上刚拷完的文件可能被索引器/杀毒短暂占用，删源失败时原地重试几次再放弃。
// 另有一种实测坑：某些卷（Dev Drive/ReFS）上 rmSync 不报错却什么都没删，
// 所以删完必须验尸，还在就退化为 unlink/rmdir 手工递归删。
function removeSource(p: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      if (!fs.existsSync(p)) return;
      removeManual(p);
      if (!fs.existsSync(p)) return;
      throw Object.assign(new Error(`源文件删不掉：${p}`), { code: 'EPERM' });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) throw err;
      // 同步小睡 120ms：迁移全程是同步代码，不能用 await
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
    }
  }
}

function removeManual(p: string): void {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) removeManual(path.join(p, name));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

// 改数据目录：校验 → 关库 → 整体搬 → 写指针，全程即时生效不用重启。
// 目标必须是空文件夹，避免两套数据混在一起；中途失败按已搬清单逆序回滚。
export function changeDataDir(raw: string): string {
  const target = path.resolve(raw.trim());
  const current = dataRoot();
  if (!raw.trim() || !path.isAbsolute(target)) throw new Error('要填绝对路径，比如 D:\\AIGC-Data');
  if (target === current) return current;
  // 新旧目录互相嵌套会让搬迁把自己吞进去，直接拒
  for (const [a, b] of [
    [current, target],
    [target, current],
  ]) {
    const rel = path.relative(a, b);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      throw new Error('新目录不能和旧目录互相嵌套，换一个独立文件夹');
    }
  }
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new Error('目标路径不是文件夹');
    // 指针文件常驻锚点：恢复默认时锚点里只剩它，不能算"非空"把自己拒了
    const leftovers = fs.readdirSync(target).filter((n) => !(target === ANCHOR_DIR && n === POINTER_NAME));
    if (leftovers.length > 0) throw new Error('目标文件夹不是空的，为避免两套数据混在一起，请选空文件夹');
  }

  // 先关库再列清单：SQLite 干净关闭时会删掉 -wal/-shm 旁路文件，
  // 关库前列的清单会包含已消失的文件，搬的时候 ENOENT
  closeDb();
  // 指针文件永远留在锚点，不参与搬迁
  const entries = fs.readdirSync(current).filter((n) => n !== POINTER_NAME);
  fs.mkdirSync(target, { recursive: true });
  const moved: string[] = [];
  try {
    for (const name of entries) {
      moveEntry(path.join(current, name), path.join(target, name));
      moved.push(name);
    }
    writeDataDirPointer(target === ANCHOR_DIR ? null : target);
  } catch (err) {
    // 回滚尽力而为：就算回滚不全，文件也都在盘上，不会丢
    for (const name of [...moved].reverse()) {
      try {
        moveEntry(path.join(target, name), path.join(current, name));
      } catch {
        // 忽略单条回滚失败，继续搬回其余
      }
    }
    throw new Error(`迁移失败，已回滚到原目录：${err instanceof Error ? err.message : String(err)}`);
  }
  ensureDirs();
  return target;
}