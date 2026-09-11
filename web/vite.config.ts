import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

/**
 * 前端构建 / 开发服务器配置。
 *
 * 开发模式（`npm run app:dev`）下，本 dev server 把 `/api` 与 `/ws` 代理回
 * 后端（端口由 `GB_SERVER_PORT` 传入）。
 *
 * **代理必须改写 Host 与 Origin**：后端对命令请求做同源校验（挡 CSRF 与
 * DNS rebinding），而 dev 模式下浏览器发出的 Origin 是 dev server 的
 * `127.0.0.1:5173` —— 不改写就会被后端正确地拒掉。
 * 改写而不是放宽后端校验，是为了让**生产路径保持严格**：
 * 正式运行时前后端同源，压根不需要这条豁免。
 */
const SERVER_PORT = Number(process.env.GB_SERVER_PORT ?? 17800);
const ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 本地应用，不需要为老浏览器降级
    target: 'es2020',
  },
  server: {
    port: 5173,
    // 前端要 import `../src/server/protocol.ts`（前后端共用的线上类型），
    // 它在前端 root 之外，必须显式放行
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': {
        target: ORIGIN,
        changeOrigin: true,
        headers: { Origin: ORIGIN },
      },
      '/ws': {
        target: ORIGIN.replace('http', 'ws'),
        changeOrigin: true,
        ws: true,
        headers: { Origin: ORIGIN },
      },
    },
  },
});
