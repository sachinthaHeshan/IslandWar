import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const dashboardSlash = {
  name: 'dashboard-slash',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/dashboard') {
        res.writeHead(302, { Location: '/dashboard/' });
        res.end();
        return;
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/dashboard') {
        res.writeHead(302, { Location: '/dashboard/' });
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [dashboardSlash],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        dashboard: resolve(root, 'dashboard/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } },
  },
});
