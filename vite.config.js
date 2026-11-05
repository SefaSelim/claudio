import { defineConfig } from 'vite';

// Tauri expects the dev server on a fixed port.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2021', outDir: 'dist' },
});
