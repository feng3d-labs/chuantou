import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || '';
          if (name.endsWith('.css')) return 'style.css';
          return '[name].[ext]';
        },
      },
    },
  },
  base: './',
});
