import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Файлы на локальном диске (в Docker это том). Интерфейс узкий, чтобы потом
// заменить на S3-совместимое хранилище без правок в остальном коде.
function root(): string {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

function resolveKey(key: string): string {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error(`Недопустимый ключ файла: ${key}`);
  return full;
}

export async function saveFile(key: string, data: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function loadFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}
