import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { SNOW_RUSH_PRODUCTION_WORKER_BASE_URL } from './src/games/snow-rush/network/protocol';

function cleanEnvUrl(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveViteSnowRushWsUrl(
  mode: string,
  fileEnvValue?: string,
  processEnvValue?: string
): string {
  return (
    cleanEnvUrl(processEnvValue) ||
    cleanEnvUrl(fileEnvValue) ||
    (mode === 'production' ? SNOW_RUSH_PRODUCTION_WORKER_BASE_URL : '')
  );
}

export default defineConfig(({ mode }) => {
  const rootDir = process.cwd();
  const loadedEnv = loadEnv(mode, rootDir, '');
  const resolvedSnowRushWsUrl = resolveViteSnowRushWsUrl(
    mode,
    loadedEnv.VITE_SNOW_RUSH_WS_URL,
    process.env.VITE_SNOW_RUSH_WS_URL
  );

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __SNOW_RUSH_CONFIGURED_WS_URL__: JSON.stringify(resolvedSnowRushWsUrl),
      'import.meta.env.VITE_SNOW_RUSH_WS_URL': JSON.stringify(resolvedSnowRushWsUrl),
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1600,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
