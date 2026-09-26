import { defineConfig } from 'vite';

// GitHub Pages のプロジェクトサイト (https://<user>.github.io/<repo>/) では
// サブパス配下に配置されるため、ワークフローから BASE_PATH を渡して base を切り替える。
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
