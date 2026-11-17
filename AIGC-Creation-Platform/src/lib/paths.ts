import path from 'node:path';
import fs from 'node:fs';

// 锚点目录固定不变，只放指针文件 data-dir.json；真实数据目录默认就是锚点，
// 改过之后由指针指向别处。指针放固定位置是为了避免「指向数据目录的配置
// 本身住在数据目录里」的鸡生蛋问题。
function resolveAnchor(): string {
  // 测试缝：单元测试把锚点指到临时目录，迁移逻辑不碰真实用户数据
  if (process.env.AIGC_ANCHOR_DIR) return process.env.AIGC_ANCHOR_DIR;
  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, 'AIGC-Creation-Platform');
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.aigc-creation-platform');
}

export const ANCHOR_DIR = resolveAnchor();
export const POINTER_NAME = 'data-dir.json';
const POINTER_PATH = path.join(ANCHOR_DIR, POINTER_NAME);

export function defaultDataRoot(): string {
  return ANCHOR_DIR;
}

// 每次现读指针：改目录后无需重启，下一个请求就落到新位置。
// 指针不存在或损坏时回退默认目录，路径层不抛错。
export function dataRoot(): string {
  try {
    const dir = (JSON.parse(fs.readFileSync(POINTER_PATH, 'utf8')) as { dir?: unknown }).dir;
    if (typeof dir === 'string' && path.isAbsolute(dir)) return dir;
  } catch {
    // 回退默认
  }
  return ANCHOR_DIR;
}

export function dbPath(): string {
  return path.join(dataRoot(), 'platform.db');
}
// 生成的图片与改图原图分开放：作品库只列 generatedDir，原图属于输入素材
export function generatedDir(): string {
  return path.join(dataRoot(), 'works');
}
export function uploadDir(): string {
  return path.join(dataRoot(), 'uploads');
}

// 首次访问时建目录。放在函数里而不是模块顶层，避免 Next.js 构建阶段就往磁盘写东西。
export function ensureDirs(): void {
  for (const dir of [dataRoot(), generatedDir(), uploadDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 写指针；回到默认目录时删指针，锚点里不留多余状态
export function writeDataDirPointer(dir: string | null): void {
  fs.mkdirSync(ANCHOR_DIR, { recursive: true });
  if (dir === null || dir === ANCHOR_DIR) fs.rmSync(POINTER_PATH, { force: true });
  else fs.writeFileSync(POINTER_PATH, JSON.stringify({ dir }, null, 2));
}

// 只允许落到受控目录内的文件名，挡掉 ../ 之类的路径穿越
export function safeChildPath(dir: string, fileName: string): string {
  const base = path.basename(fileName);
  if (base !== fileName || base === '.' || base === '..') {
    throw new Error(`非法文件名: ${fileName}`);
  }
  return path.join(dir, base);
}