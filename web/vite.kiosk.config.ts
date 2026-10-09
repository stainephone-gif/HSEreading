import path from "node:path";
import { defineConfig } from "vite";

// Офлайн-читалка: один скрипт и один файл стилей без внешних ссылок (шрифты
// встраиваются в CSS). Сервер вкладывает их в HTML при скачивании.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic" },
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: "kiosk-dist",
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    target: "es2020",
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // «use client» в общих с приложением компонентах здесь не нужен.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE" && warning.code !== "SOURCEMAP_ERROR") warn(warning);
      },
    },
    lib: {
      entry: path.resolve(__dirname, "src/kiosk/main.tsx"),
      formats: ["iife"],
      name: "PolyaKiosk",
      fileName: () => "kiosk.js",
      cssFileName: "kiosk",
    },
  },
});
