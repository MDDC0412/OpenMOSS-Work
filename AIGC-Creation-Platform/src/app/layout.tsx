import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AppProviders from '~/components/AppProviders';
import AppShell from '~/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: '创作台 · 个人 AIGC 平台',
  description: '本机运行的个人 AIGC 创作台：自填供应商地址与密钥，对话、生图、作品库。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {/* AntdRegistry 负责把 cssinjs 样式在服务端抽出来注入，避免首屏闪烁 */}
        <AntdRegistry>
          <AppProviders>
            <AppShell>{children}</AppShell>
          </AppProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}