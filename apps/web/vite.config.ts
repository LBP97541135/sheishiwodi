import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = Number(process.env['SHEISHIWODI_WEB_PORT'] ?? '9001');
const apiOrigin = process.env['SHEISHIWODI_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    proxy: {
      '/api': apiOrigin,
    },
  },
});
