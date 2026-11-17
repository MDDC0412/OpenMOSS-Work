import OpenAI from 'openai';
import type { ProviderRow } from './types';

// 关掉 SDK 自动重试：生图和视频按次计费，重试会重复扣费，
// 个人自用宁可失败后由用户手动点一次，也不要偷偷重发。
const NO_RETRY = 0;

export function makeClient(provider: ProviderRow, timeoutMs = 120_000): OpenAI {
  return new OpenAI({
    baseURL: provider.base_url,
    apiKey: provider.api_key,
    timeout: timeoutMs,
    maxRetries: NO_RETRY,
  });
}

// 生图可能跑很久，单独给更长的超时。按实测最坏情况算：
//   本地 MOSS-Image 50 步 / 768² 生成 178s
//   + 首次加载模型 20s + LoRA 切换 3s + 编码传输落盘 5s
//   ≈ 206s，留 75% 冗余 => 360s。
// 注意：这只覆盖 n=1。填 n=2 会翻倍（约 384s）超出上限，
// 需要多张就连续点几次，别把 n 调大。
export function makeImageClient(provider: ProviderRow): OpenAI {
  return makeClient(provider, 360_000);
}