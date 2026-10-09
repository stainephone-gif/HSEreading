import { execSync } from "node:child_process";

// Перед тестами схема тестовой базы доводится до последней миграции.
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });
}
