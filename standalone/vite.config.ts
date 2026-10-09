import path from "node:path";
import { defineConfig } from "vitest/config";

// Конструктор и читалка — один скрипт и один файл стилей без внешних ссылок
// (шрифты встраиваются в CSS). scripts/assemble.mjs кладёт их в один HTML.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../web/src"),
      "~": path.resolve(__dirname, "src"),
    },
    // Общий код лежит в ../web/src: зависимости берутся отсюда, в одном экземпляре.
    dedupe: ["react", "react-dom", "tweetnacl", "pdfjs-dist", "@fontsource-variable/inter"],
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic" },
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: "build",
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    target: "es2020",
    chunkSizeWarningLimit: 8192,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "Polya",
      fileName: () => "app.js",
      cssFileName: "app",
    },
    rollupOptions: {
      // «use client» в общих с приложением компонентах здесь не нужен.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE" && warning.code !== "SOURCEMAP_ERROR") warn(warning);
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
