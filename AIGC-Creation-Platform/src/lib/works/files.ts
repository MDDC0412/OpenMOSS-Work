import { readFile, unlink, writeFile } from 'node:fs/promises';
import { generatedDir, uploadDir, ensureDirs, safeChildPath } from '../paths';

// 靠文件头判断真实格式，不信供应商给的扩展名或 content-type：
// base64 里可能是 png/jpeg/webp，存错扩展名会让浏览器解码失败。
// 认不出返回 null，由调用方决定是拒收（上传口）还是兜底当 png（生成结果）。
export function detectImage(buf: Uint8Array): { mime: string; ext: string } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 6 && (buf[0] === 0x47 || buf[0] === 0x38) && buf[1] === 0x49 && buf[2] === 0x46) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  return null;
}

export function sniffMime(buf: Uint8Array): { mime: string; ext: string } {
  // 生成结果认不出就当 png 存：浏览器对 png 的容错最好，至少不会下载成一个打不开的文件
  return detectImage(buf) ?? { mime: 'image/png', ext: 'png' };
}

export async function saveGenerated(id: string, buf: Uint8Array): Promise<{ fileName: string; mime: string; bytes: number }> {
  ensureDirs();
  const { mime, ext } = sniffMime(buf);
  const fileName = `${id}.${ext}`;
  await writeFile(safeChildPath(generatedDir(), fileName), buf);
  return { fileName, mime, bytes: buf.byteLength };
}

// 返回类型写死 ArrayBuffer：readFile 给的是 Buffer（可能是 SharedArrayBuffer 视图），
// 复制一份后才是 Response / File 能直接收的 BodyInit。
export async function readGenerated(fileName: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await readFile(safeChildPath(generatedDir(), fileName)));
}

export async function saveUpload(buf: Uint8Array): Promise<{ fileName: string; mime: string; bytes: number }> {
  ensureDirs();
  const { mime, ext } = sniffMime(buf);
  // 不取用户文件名：原名可能带路径或怪字符，落盘一律用随机 id
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await writeFile(safeChildPath(uploadDir(), fileName), buf);
  return { fileName, mime, bytes: buf.byteLength };
}

export async function readUpload(fileName: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await readFile(safeChildPath(uploadDir(), fileName)));
}

export async function removeGenerated(fileName: string): Promise<void> {
  await unlink(safeChildPath(generatedDir(), fileName));
}