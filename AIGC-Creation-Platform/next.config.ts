import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 便携版打包：build 时把服务端运行所需的最小文件集 trace 到 .next/standalone，
  // 拷出去配上 .next/static 就能 node server.js 直接跑，目标机不用装依赖
  output: 'standalone',
  // node:sqlite 是 Node 内置模块，必须留在服务端外部化，否则打包器会尝试解析它而失败
  serverExternalPackages: ['node:sqlite'],
  // 生图返回 base64，改图要上传原图，默认 1MB  body 限制不够用
  experimental: {
    serverActions: {
      bodySizeLimit: '32mb',
    },
  },
};

export default nextConfig;