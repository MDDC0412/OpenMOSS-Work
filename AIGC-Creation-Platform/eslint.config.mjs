import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next 16 的扁平配置：core-web-vitals 带 React Hooks 规则，typescript 补 TS 专用规则。
// 构建产物与自动生成的类型声明不参与检查。
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 图片全来自本机 API 或流式 base64 的 data URL：next/image 不收 data URL，
      // 还要为本地单用户服务多绕一层优化器，这里直接用 <img>
      '@next/next/no-img-element': 'off',
      // 挂载时向本机 API 取数、await 之后 setState 是有意为之；
      // 这条规则不区分 await 前后，会把所有取数 effect 一律判红
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;