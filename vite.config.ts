import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.LOCAL_API_PORT || 3001);
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } },
    },
    build: { rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/node_modules/recharts/')) return 'charts';
      if (id.includes('/node_modules/@supabase/')) return 'supabase';
      if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
    } } } }
  };
});
