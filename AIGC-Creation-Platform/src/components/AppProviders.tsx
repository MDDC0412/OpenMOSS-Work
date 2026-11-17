'use client';

import { App, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { ImageJobProvider } from '~/components/image/ImageJobProvider';

// AntD 的默认暗色是冷灰蓝，这里整套 token 换成 globals.css 里的暖黑琥珀，
// 保证 AntD 控件和自绘面板看起来是同一台设备上的零件。
const token = {
  colorPrimary: '#e0a458',
  colorInfo: '#7fa8d9',
  colorSuccess: '#79c3a0',
  colorError: '#e2705f',
  colorWarning: '#d9a441',
  colorBgBase: '#100e0c',
  colorBgContainer: '#1c1815',
  colorBgElevated: '#221d19',
  colorBgLayout: '#100e0c',
  colorBorder: '#2e2822',
  colorBorderSecondary: '#241f1a',
  colorText: '#ede6da',
  colorTextSecondary: '#a79c8c',
  colorTextTertiary: '#6f665a',
  colorTextQuaternary: '#544c43',
  borderRadius: 7,
  fontSize: 13,
  controlHeight: 34,
  fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  // 主按钮不要投影：暗色界面上投影会显脏，靠色块本身区分层级
  boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
  boxShadowSecondary: '0 4px 16px rgba(0,0,0,0.4)',
};

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token,
        components: {
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
          Input: { activeShadow: '0 0 0 2px rgba(224,164,88,0.14)', hoverBorderColor: '#4a3f33' },
          InputNumber: { activeShadow: '0 0 0 2px rgba(224,164,88,0.14)' },
          Select: { optionSelectedBg: 'rgba(224,164,88,0.14)', optionSelectedColor: '#f2be79' },
          Table: {
            headerBg: '#16130f',
            headerColor: '#a79c8c',
            rowHoverBg: '#221d19',
            borderColor: '#241f1a',
            headerSplitColor: 'transparent',
          },
          Modal: { contentBg: '#16130f', headerBg: '#16130f', titleColor: '#ede6da' },
          Segmented: { itemSelectedBg: '#2a241e', itemSelectedColor: '#f2be79', trackBg: '#16130f' },
          Tabs: { itemSelectedColor: '#f2be79', inkBarColor: '#e0a458', itemColor: '#a79c8c' },
          Tooltip: { colorBgSpotlight: '#2a241e', colorTextLightSolid: '#ede6da' },
          Message: { contentBg: '#221d19', colorText: '#ede6da' },
          Tag: { defaultBg: '#221d19', defaultColor: '#a79c8c' },
        },
      }}
    >
      {/* App 提供 message/modal 的上下文，子组件用 App.useApp() 弹提示才能继承这套主题 */}
      {/* ImageJobProvider 挂在这里而不是生图页：切到别的页面时它不卸载，
          生图任务和进度才能跨页面保留 */}
      <App>
        <ImageJobProvider>{children}</ImageJobProvider>
      </App>
    </ConfigProvider>
  );
}