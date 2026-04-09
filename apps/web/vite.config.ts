import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const monacoEditorPlugin = require('vite-plugin-monaco-editor').default;

export default defineConfig({
  plugins: [react(), monacoEditorPlugin({})],
  server: {
    port: 5173
  }
});
