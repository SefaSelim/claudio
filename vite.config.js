import { defineConfig } from 'vite';

// Tauri dev sunucusunu sabit portta bekler.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2021', outDir: 'dist' },
});
