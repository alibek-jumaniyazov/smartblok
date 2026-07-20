import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev proxy target.
 *
 * The port follows apps/api/.env (API_PORT) instead of being hard-coded: the two used to
 * drift silently — change API_PORT and every request fails through a proxy still pointing
 * at 4000, which reads as "backend ishlamayapti" with nothing in the API log to explain it.
 * VITE_API_TARGET overrides everything (e.g. point the UI at the :4100 test API).
 *
 * Host is pinned to 127.0.0.1, NOT localhost: Node resolves `localhost` to ::1 first, so
 * an API bound to IPv4 only is unreachable through the proxy while curl to 127.0.0.1
 * works — a confusing split-brain failure worth designing out.
 */
function apiTarget(): string {
  if (process.env.VITE_API_TARGET) return process.env.VITE_API_TARGET;
  let port = '4000';
  try {
    const env = readFileSync(resolve(__dirname, '../api/.env'), 'utf8');
    port = /^\s*API_PORT\s*=\s*"?(\d+)"?/m.exec(env)?.[1] ?? port;
  } catch {
    /* no .env yet (fresh clone) — scripts/ensure-env-db.mjs writes one with 4000 */
  }
  return `http://127.0.0.1:${port}`;
}

const target = apiTarget();

/**
 * Without this, a stopped API surfaces as a raw socket hang-up: axios reports a bare
 * "Network Error" and the UI shows an empty red toast. Answer with a real JSON body that
 * the app's apiError() can read, so the user is told the backend is down.
 */
const onProxyError = (err: Error, _req: unknown, res: unknown) => {
  const r = res as {
    writeHead?: (code: number, headers: Record<string, string>) => void;
    end?: (body: string) => void;
  };
  console.error(`[proxy] ${target} javob bermadi: ${err.message}`);
  if (typeof r?.writeHead !== 'function') return; // websocket upgrade — no HTTP response to write
  r.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
  r.end?.(
    JSON.stringify({
      statusCode: 502,
      error: 'Bad Gateway',
      message: `Backend (${target}) javob bermayapti. «npm run dev» ishlayaptimi va baza ko'tarilganmi — tekshiring.`,
    }),
  );
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        configure: (proxy) => proxy.on('error', onProxyError),
      },
      '/socket.io': {
        target,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => proxy.on('error', onProxyError),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          charts: ['@ant-design/plots'],
        },
      },
    },
  },
});
