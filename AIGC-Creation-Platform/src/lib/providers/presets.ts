import type { GatewayHint } from './types';

export interface ProviderPreset {
  key: string;
  name: string;
  base_url: string;
  models_endpoint: string;
  gateway_hint: GatewayHint;
  note: string;
}

// 两家已核实过的供应商做成一键预填：地址和接口路径都是确定的，
// 用户只需要粘自己的密钥，少抄两行就少两次抄错的机会。
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'string',
    name: 'String AI',
    base_url: 'https://www.string.ink/v1',
    models_endpoint: '/v1/models',
    gateway_hint: 'string',
    note: '模型列表带 type 与 display_name；报错是扁平结构',
  },
  {
    key: 'xiaopang',
    name: 'xiaopangAPI',
    base_url: 'http://103.236.98.145:28475/v1',
    models_endpoint: '/v1/models',
    gateway_hint: 'newapi',
    note: 'New API 网关；模型列表只有 id/owned_by，用途靠名字规则猜',
  },
];