import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

function bundleBudgetPlugin() {
  const maxEntryBytes = 650 * 1024;
  const maxChunkBytes = 900 * 1024;

  return {
    name: 'bundle-budget-check',
    generateBundle(_: unknown, bundle: Record<string, { type: string; code?: string; isEntry?: boolean }>) {
      const warnings: string[] = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.code) continue;
        const size = Buffer.byteLength(chunk.code, 'utf8');
        const limit = chunk.isEntry ? maxEntryBytes : maxChunkBytes;
        if (size > limit) {
          warnings.push(`${fileName} ${(size / 1024).toFixed(1)}KB > ${(limit / 1024).toFixed(0)}KB`);
        }
      }

      if (warnings.length > 0) {
        const message = `[bundle-budget] Oversized chunks:\n${warnings.map((line) => `  - ${line}`).join('\n')}`;
        if (process.env.CI === 'true') {
          throw new Error(message);
        }
        console.warn(message);
      }
    }
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), bundleBudgetPlugin()],
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('zustand') || id.includes('dayjs')) return 'vendor-core';
          if (id.includes('@tanstack')) return 'vendor-table';
          if (id.includes('recharts')) return 'vendor-charts';
          if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('xlsx')) return 'vendor-export';
          return undefined;
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  }
});
