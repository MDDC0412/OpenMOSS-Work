import { countModels } from './repo';
import type { ProviderPublic, ProviderRow } from './types';
import { maskKey } from './types';
import { resolveModelsUrl } from './url';

// ProviderRow 含明文密钥，只能留在服务端。所有接口出口都必须经过这个函数，
// 保证浏览器拿到的永远是打码后的 api_key_masked。
export function toPublic(row: ProviderRow): ProviderPublic {
  const { api_key, ...rest } = row;
  let modelsUrl: string;
  if (!row.models_endpoint.trim()) {
    // 留空 = 没有模型列表接口，模型靠手工加；给一句人话而不是拼出个假地址
    modelsUrl = '（未配置模型列表接口，模型靠手工添加）';
  } else {
    try {
      modelsUrl = resolveModelsUrl(row.base_url, row.models_endpoint);
    } catch {
      // 地址非法时不抛错：列表页要能显示这一行并让用户去改，体检会负责报"地址不对"
      modelsUrl = `${row.base_url} + ${row.models_endpoint}`;
    }
  }
  return {
    ...rest,
    api_key_masked: maskKey(api_key),
    models_url_resolved: modelsUrl,
    model_count: countModels(row.id),
  };
}