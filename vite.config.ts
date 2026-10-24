import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:3001' } },
  },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/recharts/')) return 'charts';
    if (id.includes('/node_modules/@supabase/')) return 'supabase';
    if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
  } } } }
});
