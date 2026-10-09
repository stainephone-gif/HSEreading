import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  // Переменные из .env (локально) или из окружения CI. Тесты очищают таблицы,
  // поэтому работают на отдельной базе TEST_DATABASE_URL.
  const env = loadEnv(mode, process.cwd(), "");
  if (env.TEST_DATABASE_URL) env.DATABASE_URL = env.TEST_DATABASE_URL;
  // globalSetup (миграции) идёт в основном процессе: ему нужен тот же адрес базы.
  process.env.DATABASE_URL = env.DATABASE_URL;
  return {
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    test: {
      env,
      // Интеграционные тесты делят одну базу, поэтому файлы идут по очереди.
      fileParallelism: false,
      include: ["tests/**/*.test.ts"],
      globalSetup: ["tests/global-setup.ts"],
    },
  };
});
